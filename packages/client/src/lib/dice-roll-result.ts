import {
  getRoleplayCommandActivity,
  getRoleplayCommandContentOffset,
  type DiceRollResult,
} from "@marinara-engine/shared";

/**
 * Narrow an untrusted payload — a stored message extra or a `tool_result` SSE frame — to a
 * roll the dice card can actually draw. Lives outside the card component so hooks can reuse
 * it without pulling the renderer in.
 */
export function isDiceRollResult(value: unknown): value is DiceRollResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DiceRollResult>;
  return (
    typeof candidate.notation === "string" &&
    Array.isArray(candidate.rolls) &&
    candidate.rolls.every((roll) => Number.isFinite(roll)) &&
    Number.isFinite(candidate.modifier) &&
    Number.isFinite(candidate.total) &&
    (candidate.dc === undefined || Number.isSafeInteger(candidate.dc))
  );
}

/** Read current plural records and legacy single rolls through the same card guard. */
export function readDiceRollResults(value: unknown): DiceRollResult[] {
  return (Array.isArray(value) ? value : [value]).filter(isDiceRollResult);
}

/** An edited/legacy message keeps its dice at the end when its original position is unavailable. */
export function readRoleplayDiceRolls(text: string, extra: Record<string, unknown>) {
  return getRoleplayCommandActivity(extra)
    .flatMap((item, index) => {
      if (item.command.type !== "roll" || item.error || item.deleted || typeof item.result !== "string") return [];
      try {
        if (!isDiceRollResult(JSON.parse(item.result))) return [];
      } catch {
        return [];
      }
      return [{ index, offset: getRoleplayCommandContentOffset(text, item), result: item.result }];
    })
    .sort((a, b) => a.offset - b.offset || a.index - b.index);
}

/** The activity index of the last roll that missed its DC — the one an Inspiration reroll targets. */
export function latestFailedRoleplayRollIndex(extra: Record<string, unknown>): number | null {
  const activity = getRoleplayCommandActivity(extra);
  for (let index = activity.length - 1; index >= 0; index--) {
    const item = activity[index]!;
    if (item.command.type !== "roll" || item.error || item.deleted || typeof item.result !== "string") continue;
    try {
      const roll: unknown = JSON.parse(item.result);
      if (isDiceRollResult(roll) && roll.dc !== undefined && roll.total < roll.dc) return index;
    } catch {
      /* An unreadable record draws no card either. */
    }
  }
  return null;
}
