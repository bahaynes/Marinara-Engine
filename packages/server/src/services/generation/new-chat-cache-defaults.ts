import { DEFAULT_ADVANCED_MEMORY_SETTINGS, type AdvancedMemorySettings } from "@marinara-engine/shared";

/**
 * Fork: the prompt-cache settings a new chat starts with, so they need no remembering. They are written when the chat
 * is created instead of being schema defaults, because a chat with nothing saved would otherwise switch modes on its
 * next turn, and Advanced Memory's first pass over a long history blocks that turn. Conversation mode has no Advanced
 * Memory, and scene chats and imports are left alone.
 */
export function newChatCacheDefaults(mode: string): Record<string, unknown> {
  if (mode !== "roleplay" && mode !== "game") return {};
  const advancedMemory: AdvancedMemorySettings = {
    ...DEFAULT_ADVANCED_MEMORY_SETTINGS,
    knowledgeStarts: {},
    enabled: true,
  };
  return {
    advancedMemory,
    enableMemoryRecall: false,
    // Game turns build the GM prompt in the Engine, so this choice only exists for a preset-built prompt. A Game also
    // never has Individual replies, the only chats that ask who knows what.
    ...(mode === "roleplay" ? { impersonateUseChatPrompt: true, advancedMemoryFreshStart: true } : {}),
  };
}
