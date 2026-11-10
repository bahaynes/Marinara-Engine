// custom-mods: inline Peek Prompt copies (written before prompt-sidecar.ts) move to files when their chat loads,
// on assistant rows and on impersonated user rows alike, and Peek Prompt keeps showing the same request.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "marinara-prompt-sidecar-"));
process.env.DATA_DIR = dir;
process.env.FILE_STORAGE_DIR = join(dir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";
const requireServer = createRequire(new URL("../../packages/server/package.json", import.meta.url));
const Fastify = requireServer("fastify") as typeof import("fastify").default;
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { chatsRoutes } = await import("../../packages/server/src/routes/chats.routes.js");
const { createChatsStorage, settlePromptSidecarMigrations } =
  await import("../../packages/server/src/services/storage/chats.storage.js");
const { PROMPT_SIDECAR_DIR, readPromptSidecar } =
  await import("../../packages/server/src/services/storage/prompt-sidecar.js");

const db = await getDB();
const chats = createChatsStorage(db);
const app = Fastify({ logger: false });
app.decorate("db", db);
await app.register(chatsRoutes, { prefix: "/api/chats" });
await app.ready();

try {
  const chat = await chats.create({ name: "Legacy prompts", mode: "roleplay", characterIds: [] });
  assert.ok(chat);
  const promptA = [
    { role: "system", content: "LEGACY_SYSTEM_A" },
    { role: "user", content: "hello" },
  ];
  const promptB = [{ role: "system", content: "LEGACY_SYSTEM_B" }];
  const promptUser = [{ role: "system", content: "LEGACY_IMPERSONATION" }];

  await chats.createMessage({ chatId: chat.id, role: "user", content: "start" });
  const impersonated = await chats.createMessage({
    chatId: chat.id,
    role: "user",
    content: "an impersonated turn",
    extra: { isGenerated: true, cachedPrompt: promptUser },
  });
  const reply = await chats.createMessage({
    chatId: chat.id,
    role: "assistant",
    content: "first swipe",
    extra: { cachedPrompt: promptA },
  });
  assert.ok(impersonated && reply);
  await chats.addSwipe(reply.id, "second swipe");
  await chats.setActiveSwipe(reply.id, 0);
  await chats.updateSwipeExtra(reply.id, 0, { cachedPrompt: promptA });
  await chats.updateSwipeExtra(reply.id, 1, { cachedPrompt: promptB });
  const fixtureSwipes = await chats.getSwipes(reply.id);
  assert.ok(
    fixtureSwipes.every((swipe) => (swipe.extra as string).includes('"cachedPrompt":[')),
    "fixture: every swipe starts with an inline prompt",
  );

  // Loading the chat schedules the move.
  await chats.listMessagesPaginated(chat.id, 50);
  await settlePromptSidecarMigrations();

  for (const id of [impersonated.id, reply.id]) {
    const extra = JSON.parse((await chats.getMessage(id))!.extra as string);
    assert.equal(extra.cachedPrompt, null, "the row no longer holds the prompt inline");
    assert.ok(extra.cachedPromptStored, "the row points at its file");
  }
  const impersonatedExtra = JSON.parse((await chats.getMessage(impersonated.id))!.extra as string);
  assert.deepEqual(await readPromptSidecar(impersonatedExtra.cachedPromptStored), promptUser);
  for (const swipe of await chats.getSwipes(reply.id)) {
    const extra = JSON.parse(swipe.extra as string);
    assert.equal(extra.cachedPrompt, null, "each swipe no longer holds its prompt inline");
    assert.deepEqual(await readPromptSidecar(extra.cachedPromptStored), swipe.index === 0 ? promptA : promptB);
  }

  const peek = async () =>
    app.inject({ method: "POST", url: `/api/chats/${chat.id}/peek-prompt`, payload: { messageId: reply.id } });
  const first = await peek();
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json().messages, promptA, "Peek Prompt reads the active swipe's file");
  await chats.setActiveSwipe(reply.id, 1);
  assert.deepEqual((await peek()).json().messages, promptB, "Peek Prompt follows the active swipe");

  // Deleting the chat removes its files.
  const chatFiles = readdirSync(PROMPT_SIDECAR_DIR);
  assert.equal(chatFiles.length, 1, "one folder of prompt files for the one chat");
  await chats.remove(chat.id);
  assert.equal(existsSync(join(PROMPT_SIDECAR_DIR, chatFiles[0]!)), false, "a deleted chat's prompt files go with it");
  console.log("prompt-sidecar-migration: ok");
} finally {
  await app.close();
  await closeDB();
  rmSync(dir, { recursive: true, force: true });
}
