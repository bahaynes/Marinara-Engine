// custom-mods: Professor Mari's lorebook bulk path. A 190-entry reorganization used to take one model
// round trip per entry, and the entry index silently stopped at ~40 entries.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileNativeDB } from "../../../packages/server/src/db/file-backed-store.js";
import { MariDbService } from "../../../packages/server/src/services/mari-db/mari-db.service.js";

const previousDirectory = process.env.FILE_STORAGE_DIR;
const directory = mkdtempSync(join(tmpdir(), "mari-lorebook-batch-"));
process.env.FILE_STORAGE_DIR = directory;

// Stored booleans come back as the strings the table holds.
type EntrySummary = { id: string; name: string; enabled: string | boolean };
type EntryPage = { items: EntrySummary[]; total: number; offset: number; nextOffset: number | null };
type EntryBatch = { items: Array<{ id: string; content: string }>; missingIds: string[]; remainingIds: string[] };

try {
  const db = await createFileNativeDB();
  try {
    const mari = new MariDbService(db);
    const bookId = "batch-book";
    const entryCount = 60;
    const created = await mari.executeAction({
      action: "lorebook.create",
      lorebookId: bookId,
      data: {
        name: "Batch",
        entries: Array.from({ length: entryCount }, (_, index) => ({
          name: `Session ${index + 1}`,
          content: `Revelation ${index + 1}. `.repeat(60),
          order: index,
        })),
      },
      apply: true,
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    await mari.keepAppliedReview(created.approval?.id ?? "");
    await mari.executeAction({
      action: "lorebook.create",
      lorebookId: "other-book",
      data: { name: "Other" },
      apply: true,
    });
    const foreign = await mari.executeAction({
      action: "lorebook.addEntry",
      lorebookId: "other-book",
      data: { name: "Foreign", content: "not in the batch book" },
      apply: true,
    });
    const foreignId = String((foreign.summary?.preview?.[0] as { id?: string } | undefined)?.id ?? "");
    assert.ok(foreignId, "fixture entry in another lorebook");

    const listAll = async (): Promise<EntrySummary[]> => {
      const all: EntrySummary[] = [];
      let offset: number | null = 0;
      let pages = 0;
      while (offset !== null) {
        const page = (await mari.executeAction({ action: "lorebook.entries", lorebookId: bookId, offset }))
          .output as EntryPage;
        all.push(...page.items);
        offset = page.nextOffset;
        pages += 1;
        assert.ok(pages <= entryCount, "paging terminates");
      }
      return all;
    };

    // ── The index pages instead of silently stopping ──
    const first = (await mari.executeAction({ action: "lorebook.entries", lorebookId: bookId })).output as EntryPage;
    assert.equal(first.total, entryCount);
    assert.ok(first.items.length < entryCount, "a large lorebook does not fit in one page");
    assert.equal(first.nextOffset, first.items.length);
    const indexed = await listAll();
    assert.equal(new Set(indexed.map((entry) => entry.id)).size, entryCount, "every entry is reachable by paging");

    // ── getEntries reads many full entries per call and says what is left ──
    const ids = indexed.map((entry) => entry.id);
    const read: EntryBatch["items"] = [];
    let remaining = [...ids, "missing-entry", foreignId];
    const missing: string[] = [];
    while (remaining.length > 0) {
      const batch = (
        await mari.executeAction({ action: "lorebook.getEntries", lorebookId: bookId, entryIds: remaining })
      ).output as EntryBatch;
      assert.ok(batch.items.length > 0 || batch.remainingIds.length === 0, "each call makes progress");
      read.push(...batch.items);
      missing.push(...batch.missingIds);
      remaining = batch.remainingIds;
    }
    assert.equal(read.length, entryCount, "every entry is read in full");
    const fullContent = new Set(
      Array.from({ length: entryCount }, (_, index) => `Revelation ${index + 1}. `.repeat(60).trim()),
    );
    assert.ok(
      read.every((entry) => fullContent.has(entry.content)),
      "full content, not the index's 200-character previews",
    );
    assert.deepEqual(missing.sort(), ["missing-entry", foreignId].sort(), "unknown and foreign ids are reported");

    // ── A merge is one batch: one change, one review, undone together ──
    const merged = ids.slice(0, 20);
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
    assert.equal(dryRun.summary?.affectedRows, 22);
    assert.equal((await listAll()).length, entryCount, "the preview changed nothing");

    const applied = await mari.executeAction({ ...plan, apply: true });
    assert.equal(applied.ok, true, JSON.stringify(applied));
    assert.equal(applied.summary?.insertedRows, 1);
    assert.equal(applied.summary?.updatedRows, 1);
    assert.equal(applied.summary?.deletedRows, 20);
    const after = await listAll();
    assert.equal(after.length, entryCount - 20 + 1);
    assert.ok(!after.some((entry) => merged.includes(entry.id)), "merged originals are gone");
    assert.equal(String(after.find((entry) => entry.id === disabled)?.enabled), "false");
    assert.ok(after.some((entry) => entry.name === "Master: Sessions 1-20"));

    const reviewId = applied.approval?.id;
    assert.ok(reviewId, "the batch is one reviewable change");
    const restored = await mari.restoreAppliedReview(reviewId);
    assert.ok(restored && "history" in restored, JSON.stringify(restored));
    const back = await listAll();
    assert.equal(back.length, entryCount, "Restore undoes the whole batch");
    assert.ok(!back.some((entry) => entry.name === "Master: Sessions 1-20"));
    assert.equal(String(back.find((entry) => entry.id === disabled)?.enabled), "true");

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
    assert.ok(await refused({ delete: [foreignId] }), "an entry from another lorebook is refused");
    assert.ok(
      await refused({ update: [{ entryId: ids[30], enabled: false }], delete: [ids[30]] }),
      "one row, one change",
    );
    assert.ok(await refused({}), "an empty batch is refused");
    assert.equal((await listAll()).length, entryCount, "refused batches changed nothing");
    const other = (await mari.executeAction({ action: "lorebook.entries", lorebookId: "other-book" }))
      .output as EntryPage;
    assert.equal(other.total, 1, "the other lorebook is untouched");
  } finally {
    await db.close?.();
  }
} finally {
  if (previousDirectory === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousDirectory;
  rmSync(directory, { recursive: true, force: true });
}
