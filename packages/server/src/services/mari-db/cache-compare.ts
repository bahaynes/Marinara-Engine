// fork: chat.cacheCompare — Professor Mari's prompt-cache prediction for a chat. Assembles the chat's
// next prompt through the read-only dryRun route (returnPrompt, no decision debug, so no model call)
// for a few made-up next messages, then reports how much of the prompt is identical before the first
// change. Numbers and positions only: prompt text never reaches Mari.
import type { FastifyInstance } from "fastify";
import { estimateTextTokens } from "@marinara-engine/shared";
import { createChatsStorage } from "../storage/chats.storage.js";
import { androidLocalAuthInjectHeaders } from "../../middleware/android-local-auth.js";

type PromptMessage = { role: string; content: unknown; images?: unknown[]; files?: unknown[] };

// Claude matches whole blocks, so a message counts as reused only when all of it is identical.
const messageKey = (message: PromptMessage) =>
  JSON.stringify([message.role, message.content, message.images ?? null, message.files ?? null]);
const messageTokens = (message: PromptMessage) =>
  estimateTextTokens(typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""));

/** How much of `next` the cache could reuse from `previous`: the messages identical from the start. */
export function comparePromptMessages(previous: PromptMessage[], next: PromptMessage[]) {
  let prefix = 0;
  while (
    prefix < next.length &&
    prefix < previous.length &&
    messageKey(previous[prefix]!) === messageKey(next[prefix]!)
  )
    prefix++;
  const tokens = next.map(messageTokens);
  const total = tokens.reduce((sum, value) => sum + value, 0);
  const reused = tokens.slice(0, prefix).reduce((sum, value) => sum + value, 0);
  const changed = prefix < next.length ? next[prefix]! : null;
  return {
    "Prompt tokens (estimated)": total,
    "Reusable tokens": reused,
    "Would hit": total ? `${Math.round((reused / total) * 100)}%` : null,
    "First change": changed
      ? {
          message: prefix + 1,
          of: next.length,
          role: changed.role,
          "Messages from the end": next.length - prefix,
          "Changed message tokens": tokens[prefix],
        }
      : null,
  };
}

const ASSUMED_NEXT_MESSAGES = ["Understood. What happens next?", "Let's keep going."];

async function assemble(app: FastifyInstance, payload: Record<string, unknown>): Promise<PromptMessage[]> {
  // Same read-only call and flags as Peek Prompt (forwardPromptPreview); returnPrompt keeps it from
  // reaching the model.
  const response = await app.inject({
    method: "POST",
    url: "/api/generate/dryRun",
    headers: { "content-type": "application/json", ...androidLocalAuthInjectHeaders() },
    payload: {
      ...payload,
      returnPrompt: true,
      streaming: false,
      wrapLastMessage: true,
      injectLorebook: true,
      injectTrackers: true,
      injectChatSummary: true,
    },
  });
  const body = response.json<{ prompt?: { messages?: PromptMessage[] }; error?: string }>();
  if (response.statusCode >= 400 || !body.prompt?.messages)
    throw new Error(body.error ?? `The prompt could not be assembled (HTTP ${response.statusCode}).`);
  return body.prompt.messages;
}

/**
 * Two comparisons, both against the chat as it stands: no next message vs a made-up one (the history
 * grows by a turn, which moves anything placed a few messages from the end), and two different
 * made-up ones (anything that follows the new message's wording).
 */
export async function runCacheCompare(app: FastifyInstance, args: Record<string, unknown>) {
  const chatId = typeof args.chatId === "string" ? args.chatId : "";
  const chat = chatId ? await createChatsStorage(app.db).getById(chatId) : null;
  if (!chat) throw new Error(`No chat has the id "${chatId}". Use chat.list to find it.`);
  const base = {
    chatId,
    ...(chat.connectionId ? { connectionId: chat.connectionId } : {}),
    ...(typeof args.presetId === "string" && args.presetId ? { presetId: args.presetId } : {}),
  };
  const [current, first, second] = [
    await assemble(app, base),
    await assemble(app, { ...base, userMessage: ASSUMED_NEXT_MESSAGES[0] }),
    await assemble(app, { ...base, userMessage: ASSUMED_NEXT_MESSAGES[1] }),
  ];
  return {
    chatId,
    ...(base.presetId ? { presetId: base.presetId } : {}),
    "After a new turn is added": comparePromptMessages(current, first),
    "Between two different next messages": comparePromptMessages(first, second),
    note: "Estimated from an assembled prompt, no model was called. Time macros, tracker and game state change only partly in this comparison.",
  };
}
