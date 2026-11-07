// Fork: a chat made through the real route starts on the cache-safe settings, an Individual group's first reply is not
// stopped to ask who knows what when there is no earlier story, and someone joining later is still asked.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "marinara-new-chat-defaults-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.NODE_ENV = "test";
process.env.MARINARA_LITE = "true";
process.env.LOG_LEVEL = "silent";

const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { chatsRoutes } = await import("../../packages/server/src/routes/chats.routes.js");
const { createAdvancedMemoryService } = await import("../../packages/server/src/services/advanced-memory.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createCharactersStorage } = await import("../../packages/server/src/services/storage/characters.storage.js");
const { characterDataSchema, normalizeAdvancedMemorySettings } = await import("../../packages/shared/src/index.js");

const db = await getDB();
const app = Fastify();
app.decorate("db", db);
await app.register(chatsRoutes, { prefix: "/api/chats" });
const chats = createChatsStorage(db);

try {
  const characters = createCharactersStorage(db);
  const [first, second, late] = await Promise.all(
    ["First", "Second", "Late"].map((name) => characters.create(characterDataSchema.parse({ name }))),
  );
  const post = async (payload: Record<string, unknown>) => {
    const response = await app.inject({ method: "POST", url: "/api/chats", payload });
    assert.equal(response.statusCode, 200, response.body);
    const chat = JSON.parse(response.body) as { id: string };
    const stored = await chats.getById(chat.id);
    const metadata = typeof stored!.metadata === "string" ? JSON.parse(stored!.metadata) : stored!.metadata;
    return { id: chat.id, metadata: metadata as Record<string, unknown> };
  };

  const roleplay = await post({ name: "New", mode: "roleplay", characterIds: [first!.id, second!.id] });
  assert.equal(normalizeAdvancedMemorySettings(roleplay.metadata.advancedMemory).enabled, true);
  assert.equal(roleplay.metadata.enableMemoryRecall, false);
  assert.equal(roleplay.metadata.impersonateUseChatPrompt, true);

  const game = await post({ name: "New", mode: "game", characterIds: [] });
  assert.equal(normalizeAdvancedMemorySettings(game.metadata.advancedMemory).enabled, true);
  assert.equal(game.metadata.impersonateUseChatPrompt, undefined);

  const conversation = await post({ name: "New", mode: "conversation", characterIds: [first!.id] });
  assert.equal(conversation.metadata.advancedMemory, undefined);

  const imported = await post({
    name: "Imported",
    mode: "roleplay",
    characterIds: [first!.id],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(imported.metadata.advancedMemory, undefined, "an import keeps its own settings");

  // An Individual group with a first message: nothing to confirm for the starting cast.
  await chats.patchMetadata(roleplay.id, { groupChatMode: "individual" });
  await chats.createMessage({ chatId: roleplay.id, role: "user", characterId: null, content: "Hello" });
  const memory = createAdvancedMemoryService(db);
  assert.deepEqual((await memory.status(roleplay.id)).missingKnowledgeCharacterIds, []);

  // Someone added once the story began goes through the route's roster bookkeeping and is still asked about.
  const added = await app.inject({
    method: "PATCH",
    url: `/api/chats/${roleplay.id}`,
    payload: { characterIds: [first!.id, second!.id, late!.id] },
  });
  assert.equal(added.statusCode, 200, added.body);
  assert.deepEqual((await memory.status(roleplay.id)).missingKnowledgeCharacterIds, [late!.id]);

  console.info("New chats start on cache-safe settings without asking about an empty past.");
} finally {
  await app.close();
  await closeDB();
  rmSync(dataDir, { recursive: true, force: true });
}
