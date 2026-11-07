import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { injectConnectedConversationPromptBlocks } from "../../packages/server/src/routes/generate/connected-conversation-injections.js";
import {
  applyContextWindow,
  postProcessMessages,
} from "../../packages/server/src/routes/generate/generate-route-utils.js";
import { newChatCacheDefaults } from "../../packages/server/src/services/generation/new-chat-cache-defaults.js";
import {
  closeHistoryOnLastMessage,
  pullHistoryInjectionsIntoInstruction,
} from "../../packages/server/src/services/prompt/impersonate-tail.js";
import {
  ADVANCED_MEMORY_MARKER_TYPES,
  createAdvancedMemoryPlacement,
  insertAdvancedMemoryFallbacks,
} from "../../packages/server/src/services/prompt/advanced-memory-prompt.js";

// Fork: a prompt is only cheap if the next turn starts with everything up to this turn's last reply. These build two
// consecutive turns through the real placement and post-processing code and check exactly that.
type Msg = {
  role: "system" | "user" | "assistant";
  content: string;
  contextKind?: "prompt" | "history" | "injection";
};
const history = (length: number): Msg[] =>
  Array.from({ length }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `post ${i}`,
    contextKind: "history",
  }));
const system: Msg = { role: "system", content: "system prompt", contextKind: "prompt" };

/** Everything up to and including the last reply, which is what the next turn reads from the cache. */
function cachedPrefix(messages: Msg[]) {
  return messages.slice(0, messages.map((m) => m.role).lastIndexOf("assistant") + 1);
}
function assertAppendOnly(first: Msg[], second: Msg[], label: string) {
  const prefix = cachedPrefix(first);
  assert.ok(prefix.length > 1, `${label}: setup has a cached prefix`);
  assert.deepEqual(
    second.slice(0, prefix.length).map((m) => [m.role, m.content]),
    prefix.map((m) => [m.role, m.content]),
    `${label}: the next turn starts with this turn's cached prefix`,
  );
}

function memoryTurn(length: number, impersonate: boolean) {
  const messages = [system, ...history(length)];
  const placements = ADVANCED_MEMORY_MARKER_TYPES.map((type) => createAdvancedMemoryPlacement(type, "xml"));
  insertAdvancedMemoryFallbacks(messages, placements);
  let built: Msg[] = messages;
  if (impersonate) {
    const pulled = pullHistoryInjectionsIntoInstruction(messages, "Write as the persona.");
    built = [...pulled.messages, { role: "user", content: pulled.instruction }];
  }
  // Recall changes every turn; the slower summaries stay put until Advanced Memory re-cuts.
  const resolved = built.map((message) => {
    let content = message.content;
    for (const placement of placements) {
      const recall = placement.markerType === "recalled_scenes" || placement.markerType === "recalled_messages";
      content = content.replace(placement.token, recall ? `recall ${randomUUID()}` : `stable ${placement.markerType}`);
    }
    return { ...message, content };
  });
  return postProcessMessages(resolved as never[], { strictRoleFormatting: true }) as unknown as Msg[];
}

// A chat ends on a user message on a normal turn and on a reply on an impersonate.
assertAppendOnly(memoryTurn(5, false), memoryTurn(7, false), "memory blocks without preset markers");
assertAppendOnly(memoryTurn(6, true), memoryTurn(8, true), "memory blocks without preset markers, impersonate");

// A connected chat's durable note was folded into the persona's or user's earlier post, so it moved every turn.
async function connectedTurn(length: number, impersonate: boolean) {
  const finalMessages = [system, ...history(length)];
  await injectConnectedConversationPromptBlocks({
    chatMode: "roleplay",
    connectedChatId: "connected",
    isSceneChat: false,
    chatId: "chat",
    chats: {
      listPendingInfluences: async () => [],
      markInfluenceConsumed: async () => null,
      listNotes: async () => [{ content: "A durable note." }],
      getById: async () => ({ mode: "conversation", name: "Connected" }),
    },
    finalMessages: finalMessages as never[],
  });
  let built: Msg[] = finalMessages;
  if (impersonate) {
    const pulled = pullHistoryInjectionsIntoInstruction(finalMessages, "Write as the persona.");
    built = [...pulled.messages, { role: "user", content: pulled.instruction }];
  }
  assert.ok(
    built.some((m) => m.content.includes("A durable note.")),
    "setup: the note is in the prompt",
  );
  return postProcessMessages(built as never[], { strictRoleFormatting: true }) as unknown as Msg[];
}
assertAppendOnly(await connectedTurn(5, false), await connectedTurn(7, false), "connected chat notes");
assertAppendOnly(await connectedTurn(6, true), await connectedTurn(8, true), "connected chat notes, impersonate");

// A message limit moved the first message every turn. A Roleplay now holds it while warm and stays within the limit.
const now = Date.parse("2026-11-06T12:00:00Z");
const stored = (length: number, minutesAgo: number) =>
  Array.from({ length }, (_, i) => ({
    id: `m${i}`,
    role: i % 2 ? "assistant" : "user",
    content: `post ${i}`,
    createdAt: new Date(now - minutesAgo * 60_000).toISOString(),
    extra: i === 0 ? { pinnedToContext: true } : {},
  }));
const roleplay = (length: number, headId: string | null, minutesAgo = 1, chatMode = "roleplay") =>
  applyContextWindow(stored(length, minutesAgo), {
    chatMode,
    limit: 30,
    chatMeta: { gameWindowHeadId: headId },
    cacheTtlMs: 5 * 60_000,
    now,
  });
const firstCut = roleplay(31, null);
const unpinned = (result: { messages: Array<{ id: string }> }) => result.messages.filter((m) => m.id !== "m0");
assert.equal(unpinned(firstCut).length, 22, "an overflow re-cuts to 75% of the limit");
const held = roleplay(38, firstCut.headId);
assert.equal(held.headId, firstCut.headId, "the head holds while the cache is warm");
assert.equal(unpinned(held)[0]!.id, firstCut.headId);
assert.ok(unpinned(held).length <= 30, "a held window stays within the limit");
assert.notEqual(roleplay(40, firstCut.headId).headId, firstCut.headId, "past the limit it re-cuts");
assert.notEqual(roleplay(32, firstCut.headId, 6).headId, firstCut.headId, "a lapsed cache re-cuts");
assert.equal(roleplay(31, null, 1, "conversation").headId, null, "other chats keep the plain limit");

// New chats start on the cache-safe settings; there is no Advanced Memory to turn on in Conversation.
const newRoleplay = newChatCacheDefaults("roleplay") as {
  advancedMemory: { enabled: boolean };
  [key: string]: unknown;
};
assert.equal(newRoleplay.advancedMemory.enabled, true);
assert.equal(newRoleplay.enableMemoryRecall, false);
assert.equal(newRoleplay.impersonateUseChatPrompt, true);
const newGame = newChatCacheDefaults("game") as typeof newRoleplay;
assert.equal(newGame.advancedMemory.enabled, true);
assert.equal(newGame.impersonateUseChatPrompt, undefined);
assert.deepEqual(newChatCacheDefaults("conversation"), {});

// An impersonate marked the last reply as last_message, so its cache entry and a narrator turn's never matched. Wrapped
// as the assembler wraps them, the turn after an impersonate must start with everything up to that reply.
function wrapped(contents: string[], format: "xml" | "markdown"): Msg[] {
  const messages: Msg[] = contents.map((content, i) => ({
    role: i % 2 ? "assistant" : "user",
    content,
    contextKind: "history",
  }));
  const last = messages.length - 1;
  if (format === "xml") {
    if (last > 0) {
      messages[0]!.content = `<chat_history>\n${messages[0]!.content}`;
      messages[last - 1]!.content = `${messages[last - 1]!.content}\n</chat_history>`;
    }
    messages[last]!.content = `<last_message>\n${messages[last]!.content}\n</last_message>`;
  } else {
    if (last > 0) messages[0]!.content = `## Chat History\n${messages[0]!.content}`;
    messages[last]!.content = `## Last Message\n${messages[last]!.content}`;
  }
  return messages;
}
for (const format of ["xml", "markdown"] as const) {
  for (const posts of [
    ["one", "two", "three", "four"],
    ["one", "two"],
  ]) {
    const impersonate = [
      ...closeHistoryOnLastMessage(wrapped(posts, format)),
      { role: "user", content: "Write as the persona." } as Msg,
    ];
    const narrator = wrapped([...posts, "the impersonated post"], format);
    assertAppendOnly(impersonate, narrator, `impersonate then narrator (${format}, ${posts.length} posts)`);
    assert.ok(!impersonate.some((m) => /last_message|Last Message/u.test(m.content)), "nothing is marked last");
  }
}
// A greeting alone still opens the history, and a chat with no wrapper is left as it is.
assert.equal(closeHistoryOnLastMessage(wrapped(["one"], "xml"))[0]!.content, "<chat_history>\none\n</chat_history>");
const plain: Msg[] = [{ role: "assistant", content: "plain", contextKind: "history" }];
assert.equal(closeHistoryOnLastMessage(plain), plain);

console.log("Volatile prompt blocks stay out of the cached prefix.");
