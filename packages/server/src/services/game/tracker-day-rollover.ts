/**
 * World-state trackers often wrap the clock past midnight (e.g. "14:30" -> "00:00") but keep the
 * old date. Date arithmetic is the engine's job, not the model's: when the date text is unchanged
 * and the clock went back by at least MIN_ROLLBACK_MINUTES, advance a "Day N" date by one.
 * Smaller backward steps are treated as the model correcting its own clock, not a night passing.
 *
 * ponytail: only "Day N" dates advance. Calendar dates ("September 10th", "3 Frostmoon") pass
 * through unchanged; parse them here if a chat needs it. A deliberate flashback of 6+ hours on the
 * same date also advances, so fix such a turn in the tracker panel or lock the date field.
 */
const MIN_ROLLBACK_MINUTES = 6 * 60;

function parseClockMinutes(value: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?\s*$/i.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  }
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function advanceDateOnClockRollover(
  prevDate: string | null | undefined,
  prevTime: string | null | undefined,
  nextDate: string | null,
  nextTime: string | null,
): string | null {
  if (!prevDate || !prevTime || !nextDate || !nextTime || nextDate !== prevDate) return nextDate;
  const before = parseClockMinutes(prevTime);
  const after = parseClockMinutes(nextTime);
  if (before === null || after === null || before - after < MIN_ROLLBACK_MINUTES) return nextDate;
  return nextDate.replace(/\b(day\s+)(\d+)\b/i, (_, label: string, n: string) => label + (Number(n) + 1));
}
