// custom-mods: shorten an image prompt to the length a provider says it accepts.
// The Illustrator appends each present character's appearance after the scene, so the tail is the least
// important part: cut there, at the nearest paragraph, sentence or comma break that keeps most of the room.
export function fitPromptToLimit(prompt: string, limit: number): string {
  if (!Number.isFinite(limit) || limit < 1 || prompt.length <= limit) return prompt;
  const head = prompt.slice(0, limit);
  const floor = Math.floor(limit * 0.7);
  for (const breaker of ["\n\n", "\n", ". ", ", "]) {
    const at = head.lastIndexOf(breaker);
    if (at >= floor) return head.slice(0, at + (breaker.startsWith(".") ? 1 : 0)).trimEnd();
  }
  return head.trimEnd();
}
