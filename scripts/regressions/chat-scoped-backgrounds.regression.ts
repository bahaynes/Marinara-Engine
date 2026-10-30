import assert from "node:assert/strict";
import { normalizeBackgroundMeta } from "../../packages/server/src/routes/backgrounds.routes.js";
import { backgroundsVisibleToChat } from "../../packages/server/src/services/backgrounds/background-ownership.js";

// A generated background records the chat it was made for, so other stories' background agents don't pick
// it. Every tag edit rewrites meta.json through normalizeBackgroundMeta; it must keep that owner.
const meta = normalizeBackgroundMeta({
  "generated-cellar.png": { tags: ["cellar"], chatId: "chat-1" },
  "library.jpg": { tags: ["library"] },
  "generated-bad-owner.png": { tags: [], chatId: 7 },
});
assert.equal(meta["generated-cellar.png"]?.chatId, "chat-1");
assert.equal(meta["library.jpg"]?.chatId, undefined, "uploaded backgrounds stay in the shared library");
assert.equal(meta["generated-bad-owner.png"]?.chatId, undefined);

// Visibility follows the story: a game's sessions share a groupId, a scene names its origin chat.
const chats = {
  "session-1": { id: "session-1", groupId: "campaign" },
  "session-2": { id: "session-2", groupId: "campaign" },
  "other-game": { id: "other-game", groupId: "other" },
  parent: { id: "parent", groupId: "branches" },
  scene: { id: "scene", metadata: JSON.stringify({ sceneOriginChatId: "parent" }) },
  "parent-branch": { id: "parent-branch", groupId: "branches" },
  loner: { id: "loner" },
} as const;
const getChat = async (id: string) => chats[id as keyof typeof chats] ?? null;
const files = ["library.jpg", "session-1.png", "scene.png", "parent-branch.png", "gone.png"];
const owners = {
  "session-1.png": { chatId: "session-1" },
  "scene.png": { chatId: "scene" },
  "parent-branch.png": { chatId: "parent-branch" },
  "gone.png": { chatId: "deleted-chat" },
};
const visible = async (chatId: keyof typeof chats) => backgroundsVisibleToChat(files, owners, chats[chatId], getChat);
assert.deepEqual(await visible("session-2"), ["library.jpg", "session-1.png"], "a later session sees earlier ones");
assert.deepEqual(await visible("other-game"), ["library.jpg"], "another story sees only the library");
assert.deepEqual(
  await visible("scene"),
  ["library.jpg", "scene.png", "parent-branch.png"],
  "a scene sees its origin's story",
);
assert.deepEqual(
  await visible("parent"),
  ["library.jpg", "scene.png", "parent-branch.png"],
  "the origin sees its scenes",
);
assert.deepEqual(await visible("loner"), ["library.jpg"], "a deleted owner's background is hidden");
process.stdout.write("Chat-scoped backgrounds regression passed.\n");
