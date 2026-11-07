import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { injectConnectedConversationPromptBlocks } from "../../packages/server/src/routes/generate/connected-conversation-injections.js";
import {
  applyContextWindow,
  postProcessMessages,
} from "../../packages/server/src/routes/generate/generate-route-utils.js";
import { pullHistoryInjectionsIntoInstruction } from "../../packages/server/src/services/prompt/impersonate-tail.js";
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

console.log("Volatile prompt blocks stay out of the cached prefix.");
