// custom-mods: an impersonated message accepts the reply before it, like a typed one. Without this a chat
// played by impersonate commits nothing, and everything reading committed tracker state finds it empty.
import { logger } from "../../lib/logger.js";

type TurnMessage = { id: string; role: string; activeSwipeIndex?: number | null };

/** Commits the visible snapshot of the assistant reply before `messageId`. A failure only logs: the message stands. */
export async function commitStateBeforeImpersonatedMessage(args: {
  chatId: string;
  messageId: string;
  listMessages: (chatId: string) => Promise<TurnMessage[]>;
  store: {
    getByChatAndMessage: (chatId: string, messageId: string, swipeIndex?: number) => Promise<{ id: string } | null>;
    commit: (id: string, chatId?: string) => Promise<void>;
  };
}): Promise<void> {
  try {
    const messages = await args.listMessages(args.chatId);
    const end = messages.findIndex((message) => message.id === args.messageId);
    const reply = messages
      .slice(0, end < 0 ? messages.length : end)
      .reverse()
      .find((message) => message.role === "assistant");
    if (!reply) return;
    const snapshot = await args.store.getByChatAndMessage(args.chatId, reply.id, reply.activeSwipeIndex ?? 0);
    if (snapshot) await args.store.commit(snapshot.id, args.chatId);
  } catch (err) {
    logger.warn(err, "[generate] Could not commit game state before the impersonated message in chat %s", args.chatId);
  }
}
