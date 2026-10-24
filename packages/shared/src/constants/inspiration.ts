/** Default starting Inspiration points for a player in Game Mode. */
export const DEFAULT_STARTING_INSPIRATION = 1;

/** Maximum Inspiration points a player can hold at once. */
export const MAX_INSPIRATION_CAP = 4;

/** Matches [inspiration: +1], [inspiration: 1], [inspiration: +2], etc. */
export const INSPIRATION_TAG_REGEX = /\[inspiration:\s*\+?(\d+)[^\]]*\]/gi;

export function parseInspirationAwards(content: string): number {
  if (!content) return 0;
  const regex = new RegExp(INSPIRATION_TAG_REGEX.source, "gi");
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const amount = parseInt(match[1] ?? "0", 10);
    if (!Number.isNaN(amount) && amount > 0) {
      total += amount;
    }
  }
  return total;
}

export function stripInspirationTags(content: string): string {
  if (!content) return "";
  return content.replace(new RegExp(INSPIRATION_TAG_REGEX.source, "gi"), "").trim();
}
