import type { DB } from "../../db/connection.js";
import { findTrackerContextInsertIndex } from "../../routes/generate/generate-route-utils.js";
import {
  collectCapabilityPromptContext,
  type CapabilityPromptContextRequest,
} from "../capability-packages/capability-prompt-context.service.js";
import { collectRoleplayEventContext } from "../capability-packages/capability-roleplay-events.service.js";
import { replaceRuntimeAgentSection, type RuntimeAgentSectionTokens } from "./runtime-agent-sections.js";

/** The same read-only package placement for generation and Peek Prompt. */
export async function injectCapabilityContexts(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string; contextKind?: string }>,
  request: CapabilityPromptContextRequest,
  db: DB,
  sectionTokens: ReadonlyMap<string, RuntimeAgentSectionTokens>,
) {
  const promptContext = await collectCapabilityPromptContext(request);
  const blocks = promptContext.packageBlocks.flatMap((block) => {
    const tokens = sectionTokens.get(block.packageId);
    return tokens && replaceRuntimeAgentSection(messages, tokens, block.text) ? [] : [block.text];
  });
  const eventBlock = await collectRoleplayEventContext(db, request.chatId, request.targetCharacterIds ?? []);
  if (eventBlock) blocks.push(eventBlock);
  if (blocks.length > 0) {
    // Fork: unplaced package context changes most turns, so it goes beside the committed tracker
    // context just before the last message; upstream appends it to the first system message,
    // which rewrites the whole prompt cache from there on every change. When the last message is
    // an assistant reply (impersonate), it goes after it: the provider caches history up to the
    // last assistant message, so anything volatile must stay past that point.
    const at = findTrackerContextInsertIndex(messages);
    messages.splice(messages[at]?.role === "assistant" ? at + 1 : at, 0, {
      role: "user",
      content: blocks.join("\n\n"),
      contextKind: "injection",
    });
  }
  return promptContext;
}
