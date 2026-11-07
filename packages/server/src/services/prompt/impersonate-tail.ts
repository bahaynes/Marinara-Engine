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

/**
 * Fork: an impersonate has no new user message, so the history wrapper marked the last reply as `last_message`. The
 * next narrator turn sees that same reply as plain history, so the reply the Claude cache marker sits on differed
 * between the two: after a cache miss, what one wrote the other could not read. Closing the history on that reply
 * gives it the text a narrator turn gives it, so the two share the prefix.
 */
export function closeHistoryOnLastMessage<T extends TailMessage>(messages: T[]): T[] {
  const last = messages
    .map((message) => {
      const content = message.content ?? "";
      return (
        (content.startsWith("<last_message>\n") && content.endsWith("\n</last_message>")) ||
        content.startsWith("## Last Message\n")
      );
    })
    .lastIndexOf(true);
  if (last < 0) return messages;
  const result = [...messages];
  const content = result[last]!.content!;
  if (content.startsWith("## Last Message\n")) {
    const text = content.slice("## Last Message\n".length);
    const opened = result.slice(0, last).some((message) => message.content?.startsWith("## Chat History\n"));
    result[last] = { ...result[last]!, content: opened ? text : `## Chat History\n${text}` };
    return result;
  }
  const text = content.slice("<last_message>\n".length, -"\n</last_message>".length);
  const closeTag = "\n</chat_history>";
  const closed = result
    .slice(0, last)
    .map((message) => message.content?.endsWith(closeTag) === true)
    .lastIndexOf(true);
  if (closed >= 0) {
    result[closed] = { ...result[closed]!, content: result[closed]!.content!.slice(0, -closeTag.length) };
  }
  result[last] = { ...result[last]!, content: `${closed >= 0 ? "" : "<chat_history>\n"}${text}${closeTag}` };
  return result;
}
