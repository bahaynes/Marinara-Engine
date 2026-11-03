type TailMessage = { content?: string | null; contextKind?: string };

/**
 * Fork-only: an impersonate has no new user message, so blocks that a normal reply carries in its tail land
 * inside the history instead: depth injections (Author's Note, depth lorebook entries, character depth prompts)
 * and the tracker "Context:" block, which attaches to the last user message (the persona's previous post).
 * They move forward every turn, and on Claude the cache marker sits on the last history message, so each
 * impersonate rewrote the whole history to the cache. Pulling those blocks out of the history and prepending
 * them to the impersonate instruction keeps the history append-only.
 *
 * Only blocks after the first history message move: anything before it does not shift between turns.
 */
export function pullHistoryInjectionsIntoInstruction<T extends TailMessage>(
  messages: T[],
  instruction: string,
): { messages: T[]; instruction: string } {
  const firstHistory = messages.findIndex((message) => message.contextKind === "history");
  if (firstHistory < 0) return { messages, instruction };
  const moved: string[] = [];
  const kept = messages.filter((message, index) => {
    if (index <= firstHistory || message.contextKind !== "injection") return true;
    if (message.content?.trim()) moved.push(message.content.trim());
    return false;
  });
  if (kept.length === messages.length) return { messages, instruction };
  return { messages: kept, instruction: [...moved, instruction].join("\n\n") };
}
