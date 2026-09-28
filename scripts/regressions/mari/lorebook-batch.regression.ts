// custom-mods: Professor Mari's lorebook bulk path. A 190-entry reorganization used to take one model
// round trip per entry, and the entry index silently stopped at ~40 entries.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const previousDirectory = process.env.FILE_STORAGE_DIR;
const directory = mkdtempSync(join(tmpdir(), "mari-lorebook-batch-"));
process.env.FILE_STORAGE_DIR = directory;
const { createFileNativeDB } = await import("../../../packages/server/src/db/file-backed-store.js");
const { lorebookEntryActivationStats } = await import("../../../packages/server/src/db/schema/index.js");
const { MariDbService } = await import("../../../packages/server/src/services/mari-db/mari-db.service.js");
const { isMutatingWorkspaceCommand } =
  await import("../../../packages/server/src/services/professor-mari/workspace-agent.service.js");

// Stored booleans come back as the strings the table holds.
type EntrySummary = { id: string; name: string; enabled: string | boolean };
type EntryPage = { items: EntrySummary[]; total: number; offset: number; nextOffset: number | null };
type EntryBatch = { items: Array<{ id: string; content: string }>; missingIds: string[]; remainingIds: string[] };

// ── Permissions Mode sees reads as reads and the batch as a change ──
const appData = (action: string) => ({ id: action, name: "app_data" as const, arguments: { action } });
assert.equal(isMutatingWorkspaceCommand(appData("lorebook.getEntries")), false, "getEntries is a read");
assert.equal(isMutatingWorkspaceCommand(appData("lorebook.entries")), false, "entries is a read");
assert.equal(isMutatingWorkspaceCommand(appData("lorebook.batch")), true, "batch is a change");

try {
  const db = await createFileNativeDB();
  try {
    let mari = new MariDbService(db);
    const bookId = "batch-book";
    const entryCount = 190; // the size of the lorebook this was found on
    const contentFor = (index: number) => `Revelation ${index + 1}. `.repeat(60).trim();
    const created = await mari.executeAction({
      action: "lorebook.create",
      lorebookId: bookId,
      data: {
        name: "Batch",
        entries: Array.from({ length: entryCount }, (_, index) => ({
          name: `Session ${index + 1}`,
          content: contentFor(index),
          order: index,
        })),
      },
      apply: true,
    });
    assert.equal(created.ok, true, JSON.stringify(created).slice(0, 500));
    await mari.keepAppliedReview(created.approval?.id ?? "");
    await mari.executeAction({
      action: "lorebook.create",
      lorebookId: "other-book",
      data: { name: "Other", entries: [{ name: "Foreign", content: "not in the batch book" }] },
      apply: true,
    });

    // Every read result must arrive whole: the read bound elides the largest field when over budget.
    const read = async (args: Record<string, unknown>) => {
      const result = await mari.executeAction(args);
      assert.equal(result.ok, true, JSON.stringify(result).slice(0, 500));
      assert.ok(
        !result.truncation?.truncated,
        `${String(args.action)} output was cut: ${JSON.stringify(result.truncation)}`,
      );
      return result.output;
    };
    const listAll = async (lorebookId = bookId): Promise<EntrySummary[]> => {
      const all: EntrySummary[] = [];
      let offset: number | null = 0;
      let pages = 0;
      while (offset !== null) {
        const page = (await read({ action: "lorebook.entries", lorebookId, offset })) as EntryPage;
        all.push(...page.items);
        offset = page.nextOffset;
        pages += 1;
        assert.ok(pages <= entryCount, "paging terminates");
      }
      return all;
    };
    const foreignId = (await listAll("other-book"))[0]!.id;

    // ── The index pages instead of silently stopping ──
    const first = (await read({ action: "lorebook.entries", lorebookId: bookId })) as EntryPage;
    assert.equal(first.total, entryCount);
    assert.ok(first.items.length < entryCount, "a large lorebook does not fit in one page");
    assert.equal(first.nextOffset, first.items.length);
    const indexed = await listAll();
    assert.equal(new Set(indexed.map((entry) => entry.id)).size, entryCount, "every entry is reachable by paging");

    // ── getEntries reads many full entries per call and says what is left ──
    const ids = indexed.map((entry) => entry.id);
    const fullEntries: EntryBatch["items"] = [];
    const missing: string[] = [];
    let remaining = [...ids, "missing-entry", foreignId];
    while (remaining.length > 0) {
      const batch = (await read({
        action: "lorebook.getEntries",
        lorebookId: bookId,
        entryIds: remaining,
      })) as EntryBatch;
      assert.ok(batch.items.length > 0 || batch.remainingIds.length === 0, "each call makes progress");
      fullEntries.push(...batch.items);
      missing.push(...batch.missingIds);
      remaining = batch.remainingIds;
    }
    assert.equal(fullEntries.length, entryCount, "every entry is read in full");
    const fullContent = new Set(Array.from({ length: entryCount }, (_, index) => contentFor(index)));
    assert.ok(
      fullEntries.every((entry) => fullContent.has(entry.content)),
      "full content, not the index's 200-character previews",
    );
    assert.deepEqual(missing.sort(), ["missing-entry", foreignId].sort(), "unknown and foreign ids are reported");
    const tooMany = await mari.executeAction({
      action: "lorebook.getEntries",
      entryIds: Array.from({ length: 201 }, (_, i) => `id-${i}`),
    });
    assert.equal(tooMany.ok, false);
    assert.match(String(tooMany.error), /at most 200/);

    // Entries that have fired carry an activation stats row, a cascade child of the entry.
    const merged = ids.slice(0, 20);
    const firedSingle = ids[40]!;
    for (const entryId of [merged[0]!, firedSingle]) {
      await db.insert(lorebookEntryActivationStats).values({ entryId, lorebookId: bookId, count: 3 });
    }
    const statsFor = async (entryId: string) =>
      (await db.select().from(lorebookEntryActivationStats)).filter((row) => row.entryId === entryId).length;

    // ── A merge is one batch: one change, one review, undone together ──
    const disabled = ids[20]!;
    const plan = {
      action: "lorebook.batch",
      lorebookId: bookId,
      add: [{ name: "Master: Sessions 1-20", content: "Everything from sessions 1 to 20." }],
      update: [{ entryId: disabled, enabled: false }],
      delete: merged,
    };
    const dryRun = await mari.executeAction(plan);
    assert.equal(dryRun.mode, "dry-run", "a batch without apply:true only previews");
    assert.equal(dryRun.summary?.insertedRows, 1);
    assert.equal(dryRun.summary?.deletedRows, 21, "20 entries plus one entry's activation stats");
    assert.equal((await listAll()).length, entryCount, "the preview changed nothing");

    const applied = await mari.executeAction({ ...plan, apply: true });
    assert.equal(applied.ok, true, JSON.stringify(applied).slice(0, 500));
    assert.equal(applied.summary?.updatedRows, 1);
    const after = await listAll();
    assert.equal(after.length, entryCount - 20 + 1);
    assert.ok(!after.some((entry) => merged.includes(entry.id)), "merged originals are gone");
    assert.equal(String(after.find((entry) => entry.id === disabled)?.enabled), "false");
    assert.ok(after.some((entry) => entry.name === "Master: Sessions 1-20"));
    assert.equal(await statsFor(merged[0]!), 0, "a deleted entry's stats go with it");

    // Restore works from a fresh service, as after an Engine restart.
    const reviewId = applied.approval?.id;
    assert.ok(reviewId, "the batch is one reviewable change");
    mari = new MariDbService(db);
    const restored = await mari.restoreAppliedReview(reviewId);
    assert.ok(restored && "history" in restored, JSON.stringify(restored).slice(0, 500));
    const back = await listAll();
    assert.equal(back.length, entryCount, "Restore undoes the whole batch");
    assert.ok(!back.some((entry) => entry.name === "Master: Sessions 1-20"));
    assert.equal(String(back.find((entry) => entry.id === disabled)?.enabled), "true");
    assert.equal(await statsFor(merged[0]!), 1, "Restore brings the stats back too");

    // ── Single-entry delete of an entry that has fired ──
    const single = await mari.executeAction({ action: "lorebook.deleteEntry", entryId: firedSingle, apply: true });
    assert.equal(single.ok, true, JSON.stringify(single).slice(0, 500));
    assert.equal(await statsFor(firedSingle), 0);

    // ── Scope and consistency guards ──
    const refused = async (args: Record<string, unknown>) => {
      try {
        return (
          (await mari.executeAction({ action: "lorebook.batch", lorebookId: bookId, apply: true, ...args })).ok ===
          false
        );
      } catch {
        return true;
      }
    };
    const before = (await listAll()).length;
    assert.ok(await refused({ delete: [foreignId] }), "an entry from another lorebook is refused");
    assert.ok(
      await refused({ update: [{ entryId: ids[30], enabled: false }], delete: [ids[30]] }),
      "one row, one change",
    );
    assert.ok(await refused({}), "an empty batch is refused");
    assert.equal((await listAll()).length, before, "refused batches changed nothing");
    assert.equal((await listAll("other-book")).length, 1, "the other lorebook is untouched");
  } finally {
    await db.close?.();
  }
} finally {
  if (previousDirectory === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
}
