// fork: chat.cacheReport — Professor Mari's per-reply prompt-cache numbers. Pins the Claude prompt
// normalization (cached input added back), post numbers matching chat.messages, gaps, the
// skip of replies with no saved usage, and that it reads as read-only and never returns text.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileNativeDB } from "../../../packages/server/src/db/file-backed-store.js";
import { MariDbService } from "../../../packages/server/src/services/mari-db/mari-db.service.js";
import {
  PROFESSOR_MARI_APP_DATA_ACTIONS,
  appDataActionLooksReadOnly,
} from "../../../packages/server/src/services/professor-mari/workspace-agent.service.js";
import { createConnectionsStorage } from "../../../packages/server/src/services/storage/connections.storage.js";
import { createChatsStorage } from "../../../packages/server/src/services/storage/chats.storage.js";

const previousFileStorageDir = process.env.FILE_STORAGE_DIR;
const dir = mkdtempSync(join(tmpdir(), "marinara-mari-cache-report-"));
process.env.FILE_STORAGE_DIR = dir;

try {
  const db = await createFileNativeDB();
  try {
    const chats = createChatsStorage(db);
    const connection = await createConnectionsStorage(db).create({
      name: "Claude",
      provider: "claude_subscription",
      model: "m",
    } as never);
    assert.ok(connection);
    const chat = await chats.create({
      name: "Cache report regression",
      mode: "roleplay",
      characterIds: ["c"],
      connectionId: connection.id,
    });
    assert.ok(chat);
    const at = (minute: number) => ({ createdAt: new Date(Date.UTC(2026, 9, 23, 12, minute)).toISOString() });
    // createMessage clears generationInfo; generation writes it afterwards, as here.
    const reply = async (
      targetChat: { id: string },
      content: string,
      minute: number,
      provider: string,
      tokensPrompt: number,
      tokensCachedPrompt: number | null,
      written: number | null,
      { model = "m", requestCount = 1 }: { model?: string; requestCount?: number } = {},
    ) => {
      const message = await chats.createMessage({ chatId: targetChat.id, role: "assistant", content }, at(minute));
      await chats.updateMessageExtra(message!.id, {
        generationInfo: {
          model,
          provider,
          tokensPrompt,
          tokensCachedPrompt,
          tokensCacheWritePrompt: written,
          requestCount,
        },
      });
    };

    await chats.createMessage({ chatId: chat.id, role: "user", content: "hi" }, at(0));
    // Claude reports only uncached input: 100 + 900 cached + 0 written = 1000. First reply: nothing to compare.
    await reply(chat, "secret one", 1, "claude_subscription", 100, 900, 0);
    // 3 minutes later: counted, and it could hit all 1000 of the previous prompt.
    await reply(chat, "secret two", 4, "claude_subscription", 100, 900, 0, { requestCount: 2 });
    // 16 minutes later on the 5-minute cache: expired, not a miss.
    await reply(chat, "secret three", 20, "claude_subscription", 0, 0, 1000);
    // A different model has its own cache: left out.
    await reply(chat, "secret four", 21, "claude_subscription", 0, 0, 1000, { model: "other" });
    // An imported reply with no usage is skipped but still counts for post numbers and gaps.
    await chats.createMessage({ chatId: chat.id, role: "assistant", content: "secret five" }, at(25));

    const mari = new MariDbService(db);
    assert.ok(PROFESSOR_MARI_APP_DATA_ACTIONS.includes("chat.cacheReport"));
    assert.equal(appDataActionLooksReadOnly("chat.cacheReport"), true);

    const result = await mari.executeAction({ action: "chat.cacheReport", chatId: chat.id });
    assert.equal(result.ok, true);
    type Output = {
      replies: Array<Record<string, unknown>>;
      overall: Record<string, unknown>;
      findings: string[];
    };
    const output = result.output as Output;
    assert.deepEqual(
      output.replies.map((row) => [row.post, row["Prompt tokens"], row["Cached tokens"], row.Status]),
      [
        [2, 1000, 900, "first reply"],
        [3, 1000, 900, "counted"],
        [4, 1000, 0, "cache expired between replies"],
        [5, 1000, 0, "model changed"],
      ],
    );
    assert.equal(output.replies[0]!["Minutes since previous reply"], null);
    assert.equal(output.replies[1]!["Minutes since previous reply"], 3);
    assert.equal(output.replies[1]!["Should have hit"], 1000);
    assert.equal(output.replies[1]!["Hit of should-have"], "90%");
    assert.equal(output.replies[1]!.requests, 2, "a tool-call turn says its tokens are summed");
    assert.equal(output.replies[0]!.requests, undefined, "a single-request reply carries no requests count");
    assert.deepEqual(output.overall, {
      replies: 4,
      "Counted replies": 1,
      "Should have hit": 1000,
      "Cached tokens": 900,
      "Hit of should-have": "90%",
      "Left out": { "cache expired between replies": 1, "model changed": 1, swipe: 0, "first reply": 1 },
    });
    assert.equal(output.findings.length, 1);
    assert.match(output.findings[0]!, /extended \(1h\) cache would have kept them/);
    assert.ok(!JSON.stringify(result.output).includes("secret"), "never returns message text");

    const lastOne = await mari.executeAction({ action: "chat.cacheReport", chatId: chat.id, last: 1 });
    assert.deepEqual(
      (lastOne.output as { replies: Array<{ post: number }> }).replies.map((row) => row.post),
      [5],
    );

    // A stuck hit names the chat setting that explains it; a gap on an unknown cache lifetime is counted.
    const stuck = await chats.create({
      name: "Stuck hit",
      mode: "roleplay",
      characterIds: ["c"],
    });
    assert.ok(stuck);
    await chats.updateMetadata(stuck.id, { enableMemoryRecall: true, authorNotes: "note", authorNotesDepth: 4 });
    await reply(stuck, "a", 1, "nanogpt", 1000, 100, null);
    await reply(stuck, "b", 90, "nanogpt", 1100, 100, null);
    await reply(stuck, "c", 95, "nanogpt", 1200, 100, null);
    const stuckOutput = (await mari.executeAction({ action: "chat.cacheReport", chatId: stuck.id })).output as Output;
    assert.deepEqual(
      stuckOutput.replies.map((row) => row.Status),
      ["first reply", "counted", "counted"],
    );
    assert.equal(stuckOutput.overall["Hit of should-have"], "10%");
    assert.equal(stuckOutput.findings.length, 3);
    assert.match(stuckOutput.findings[1]!, /Memory Recall is on/);
    assert.match(stuckOutput.findings[2]!, /Author's Note is at depth 4/);

    const missing = await mari.executeAction({ action: "chat.cacheReport", chatId: "no-such-chat" });
    assert.equal(missing.ok, false);
  } finally {
    await db._fileStore.close();
  }
} finally {
  if (previousFileStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousFileStorageDir;
  rmSync(dir, { recursive: true, force: true });
}

console.log("cache-report regression passed");
