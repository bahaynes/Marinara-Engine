import {
  DEFAULT_STARTING_INSPIRATION,
  MAX_INSPIRATION_CAP,
  getRoleplayCommandActivity,
  getRoleplayCommandContentOffset,
  type DiceRollResult,
  type RoleplayCommandActivity,
} from "@marinara-engine/shared";
import type { ChatMessage } from "../llm/base-provider.js";
import { parseRollDiceToolResult } from "./dice.service.js";
import { executeToolCalls } from "../tools/tool-executor.js";

export function readInspiration(meta: Record<string, unknown>): number {
  return typeof meta.gameInspiration === "number" ? meta.gameInspiration : DEFAULT_STARTING_INSPIRATION;
}

/** The capped total after an award, or null when the award changes nothing. */
export function nextInspirationAfterAward(meta: Record<string, unknown>, amount: number): number | null {
  const current = readInspiration(meta);
  const next = Math.min(MAX_INSPIRATION_CAP, current + Math.max(0, amount));
  return next === current ? null : next;
}

export interface FailedRoleplayRoll {
  index: number;
  activity: RoleplayCommandActivity;
  roll: DiceRollResult & { dc: number };
  reason: string;
}

/** The last roll on a swipe that declared a DC and missed it. A roll without a DC has no failure to reroll. */
export function findLatestFailedRoleplayRoll(extra: Record<string, unknown>): FailedRoleplayRoll | null {
  const activity = getRoleplayCommandActivity(extra);
  for (let index = activity.length - 1; index >= 0; index--) {
    const item = activity[index]!;
    if (item.command.type !== "roll" || item.deleted || item.error || !item.result) continue;
    const roll = parseRollDiceToolResult(item.result);
    if (!roll || roll.dc === undefined || roll.total >= roll.dc) continue;
    let reason = item.command.reason;
    try {
      const payload = JSON.parse(item.result) as { reason?: unknown };
      if (typeof payload.reason === "string" && payload.reason) reason = payload.reason;
    } catch {
      /* parseRollDiceToolResult already proved the JSON is readable. */
    }
    return { index, activity: item, roll: { ...roll, dc: roll.dc }, reason };
  }
  return null;
}

/**
 * Roll the same final notation again. The saved notation already carries the ability, proficiency and
 * situational modifiers, so nothing about the character sheet is re-read.
 */
export async function rerollRoleplayRoll(
  failed: FailedRoleplayRoll,
): Promise<{ result: string; roll: DiceRollResult }> {
  const [executed] = await executeToolCalls([
    {
      id: "inspiration-reroll",
      type: "function",
      function: {
        name: "roll_dice",
        arguments: JSON.stringify({ notation: failed.roll.notation, reason: failed.reason, dc: failed.roll.dc }),
      },
    },
  ]);
  const roll = executed?.success ? parseRollDiceToolResult(executed.result) : null;
  if (!executed || !roll) throw new Error(executed?.result || "The reroll could not be made.");
  return { result: executed.result, roll };
}

/** Split a swipe at the roll: what came before stays verbatim, what came after gets rewritten. */
export function splitAtRoll(content: string, failed: FailedRoleplayRoll): { before: string; after: string } {
  const offset = getRoleplayCommandContentOffset(content, failed.activity);
  // An unlocatable roll reports the end of the text; rewrite everything rather than append a second outcome.
  if (!content.slice(offset).trim()) return { before: "", after: content };
  return { before: content.slice(0, offset), after: content.slice(offset) };
}

// ponytail: the rewrite sees the character name, the last few messages and the passage itself, not the
// full RP prompt, so voice can drift on long scenes. Upgrade path: run it through the normal generation
// pipeline with the roll result pinned.
export function buildRoleplayRerollMessages(args: {
  characterName: string;
  personaName: string;
  context: ChatMessage[];
  before: string;
  after: string;
  failed: FailedRoleplayRoll;
  roll: DiceRollResult;
}): ChatMessage[] {
  const { failed, roll } = args;
  const success = roll.total >= failed.roll.dc;
  return [
    {
      role: "system",
      content: `You are ${args.characterName} in an ongoing roleplay. Continue in exactly the voice, perspective, tense and formatting of the passage you are given.`,
    },
    ...args.context,
    {
      role: "user",
      content: [
        `[Inspiration reroll] ${args.personaName} spent Inspiration to reroll a failed roll${failed.reason ? ` (${failed.reason})` : ""}.`,
        `The first roll was ${failed.roll.total} against DC ${failed.roll.dc}: a failure. The new roll is ${roll.total} against DC ${failed.roll.dc}: ${success ? "a SUCCESS" : "still a failure, but play out a different failure"}.`,
        "",
        "The passage up to the roll, which stays as written:",
        `<before>\n${args.before}\n</before>`,
        "",
        "What followed the first roll:",
        `<after>\n${args.after}\n</after>`,
        "",
        "Rewrite only what follows the roll so it reflects the new result. Keep roughly the same length. Do not repeat the text before the roll, mention dice, numbers or Inspiration, or write bracket commands. Return only the rewritten continuation.",
      ].join("\n"),
    },
  ];
}

/** The rerolled swipe's records: activity up to and including the rerolled roll, dice cards likewise. */
export function buildRerolledSwipeExtra(
  extra: Record<string, unknown>,
  failed: FailedRoleplayRoll,
  rerolled: { result: string; roll: DiceRollResult },
): Record<string, unknown> {
  const activity = getRoleplayCommandActivity(extra)
    .slice(0, failed.index + 1)
    .map((item, index) => (index === failed.index ? { ...item, result: rerolled.result } : item))
    // An interruption's restore state belongs to the swipe that made it; addSwipe already reconciled it.
    .filter((item) => item.command.type !== "interrupt");
  const previousRolls = Array.isArray(extra.diceRollResults) ? (extra.diceRollResults as DiceRollResult[]) : [];
  const rollIndex = previousRolls.findIndex(
    (roll) => roll?.notation === failed.roll.notation && roll.total === failed.roll.total && roll.dc === failed.roll.dc,
  );
  const diceRollResults =
    rollIndex >= 0 ? [...previousRolls.slice(0, rollIndex), rerolled.roll] : [...previousRolls, rerolled.roll];
  return { roleplayCommandActivity: activity, diceRollResults, diceRollResult: rerolled.roll };
}

/** Add an award to the chat's stored Inspiration, capped. Returns the new total, or null when nothing changed. */
export async function applyInspirationAward(
  chats: {
    getById(id: string): Promise<{ metadata?: unknown } | null | undefined>;
    updateMetadata(id: string, metadata: Record<string, unknown>): Promise<unknown>;
  },
  chatId: string,
  amount: number,
): Promise<number | null> {
  const chat = await chats.getById(chatId);
  const raw = chat?.metadata;
  const meta = (typeof raw === "string" ? JSON.parse(raw || "{}") : (raw ?? {})) as Record<string, unknown>;
  const next = nextInspirationAfterAward(meta, amount);
  if (next !== null) await chats.updateMetadata(chatId, { ...meta, gameInspiration: next });
  return next;
}
