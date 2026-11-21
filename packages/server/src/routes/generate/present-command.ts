// custom-mods: the narrator opens each reply with [present: ...]; the Engine owns presentCharacters from it.
// Plan: minecraftdocker docs/llm/story-threads-plan.md, "Presence design".
import {
  applyTrackerFieldLocksToGameStatePatch,
  decodeEncodedSpeakerTags,
  normalizeTextForMatch,
  type RoleplayCommandActivity,
} from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import type { createGameStateStorage } from "../../services/storage/game-state.storage.js";
import { applyTrackerCharacterCardIdentity, parseGameStateRow, parseJsonField } from "./generate-route-utils.js";

type Row = Record<string, unknown>;

/**
 * Who is in the scene after this reply. The line is trusted as written: it describes the scene at the end of
 * the reply, so people who spoke and then left stay out. Without a line, the previous list carries over plus
 * anyone who spoke (someone who left silently stays one more turn). The persona is never listed.
 */
export function resolvePresentNames(args: {
  activity: readonly RoleplayCommandActivity[];
  content: string;
  previousNames: readonly string[];
  personaName: string;
}): { names: string[]; fromLine: boolean } {
  const line = args.activity
    .filter((item) => item.command.type === "present" && !item.deleted && !item.error)
    .at(-1)?.command;
  const candidates =
    line?.type === "present"
      ? line.names
      : [
          ...args.previousNames,
          ...[...decodeEncodedSpeakerTags(args.content).matchAll(/<speaker="([^"]+)">/gu)].map((m) => m[1]!.trim()),
        ];
  const persona = normalizeTextForMatch(args.personaName);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of candidates) {
    const key = normalizeTextForMatch(name);
    if (!key || key === persona || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return { names, fromLine: line?.type === "present" };
}

/** Rows for these names. Someone already present keeps their whole row (outfit, avatar, fields); a newcomer starts empty. */
export function buildPresentRows(
  names: readonly string[],
  previous: readonly Row[],
  fallbackPrevious?: readonly Row[],
): Row[] {
  const byName = new Map<string, Row>();
  for (const row of previous) {
    const key = normalizeTextForMatch(row.name);
    if (key && !byName.has(key)) byName.set(key, { ...row });
  }
  if (fallbackPrevious) {
    for (const row of fallbackPrevious) {
      const key = normalizeTextForMatch(row.name);
      if (!key) continue;
      const existing = byName.get(key);
      if (!existing) {
        byName.set(key, { ...row });
      } else {
        for (const field of ["appearance", "outfit", "avatarPath", "avatarCrop", "emoji"] as const) {
          if (!existing[field] && row[field]) {
            existing[field] = row[field];
          }
        }
        if ((!existing.customFields || Object.keys(existing.customFields as object).length === 0) && row.customFields) {
          existing.customFields = { ...(row.customFields as object) };
        }
      }
    }
  }
  // ponytail: newcomers get no avatar/appearance enrichment (the tracker's NPC avatar lookup); card identity
  // still comes from applyTrackerCharacterCardIdentity at the call site. Upgrade: share the tracker's enrichment.
  return names.map((name) => {
    const kept = byName.get(normalizeTextForMatch(name));
    // A newcomer gets the full PresentCharacter shape. A card-less NPC's id is its name, as the tracker stores it;
    // applyTrackerCharacterCardIdentity swaps in the card id for card characters.
    return kept
      ? { ...kept }
      : {
          characterId: name,
          name,
          emoji: "",
          mood: "",
          appearance: null,
          outfit: null,
          thoughts: null,
          customFields: {},
          stats: [],
        };
  });
}

/** This turn's roster: who the reply says is present, as tracker rows with card identity. */
export function resolvePresentForTurn(args: {
  activity: readonly RoleplayCommandActivity[];
  content: string;
  previous: unknown;
  fallbackPrevious?: unknown;
  personaName: string;
  cards: Parameters<typeof applyTrackerCharacterCardIdentity>[1];
}): { names: string[]; fromLine: boolean; rows: Row[] } {
  const previous = parseJsonField<Row[]>(args.previous, []);
  const fallback = parseJsonField<Row[]>(args.fallbackPrevious, []);
  const { names, fromLine } = resolvePresentNames({
    activity: args.activity,
    content: args.content,
    previousNames:
      previous.length > 0
        ? previous.map((row) => String(row.name ?? ""))
        : fallback.map((row) => String(row.name ?? "")),
    personaName: args.personaName,
  });
  const rows = buildPresentRows(names, previous, fallback);
  applyTrackerCharacterCardIdentity(rows, args.cards, { previousCharacters: [...previous, ...fallback] });
  return { names, fromLine, rows };
}

/** Saves the roster on the reply's swipe, honouring field locks. A failure only logs: the reply stands. */
export async function writePresentForTurn(args: {
  store: ReturnType<typeof createGameStateStorage>;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  baseSnapshot: NonNullable<
    Parameters<ReturnType<typeof createGameStateStorage>["updateByMessage"]>[5]
  >["baseSnapshot"];
  resolve: (currentCharacters?: unknown) => { names: string[]; fromLine: boolean; rows: Row[] };
  onPersisted?: (rows: Row[]) => void;
}): Promise<void> {
  try {
    const current = await args.store.getByChatAndMessage(args.chatId, args.messageId, args.swipeIndex);
    const { names, fromLine, rows } = args.resolve(current?.presentCharacters);
    const locks = current ?? args.baseSnapshot;
    const patch = applyTrackerFieldLocksToGameStatePatch(
      // Rows are tracker-shaped records, typed loosely like the tracker's own merge.
      { presentCharacters: rows as any[] },
      locks ? parseGameStateRow(locks as Record<string, unknown>) : null,
    );
    await args.store.updateByMessage(args.messageId, args.swipeIndex, args.chatId, patch, undefined, {
      baseSnapshot: args.baseSnapshot ?? null,
    });
    if (args.onPersisted) {
      args.onPersisted(rows);
    }
    logger.info(
      "[present] chat %s msg %s swipe %d: %s (%s)",
      args.chatId,
      args.messageId,
      args.swipeIndex,
      names.join(", ") || "nobody",
      fromLine ? "line" : "fallback",
    );
  } catch (err) {
    logger.warn(err, "[present] Could not write presentCharacters from the [present] line");
  }
}

/** Added to the prompt tail when the Illustrator's interval says a picture is due. */
export const PICTURE_DUE_INSTRUCTION =
  'A picture is due with this reply. Use [illustrate: subject="..." characters="..."] once. The subject names one visible action at one instant, and characters lists only people physically in that moment.';

/** Whether the reply carries a live [illustrate], which replaces the automatic Illustrator run for that reply. */
export function replyAskedForPicture(activity: readonly RoleplayCommandActivity[]): boolean {
  return activity.some((item) => item.command.type === "illustrate" && !item.deleted && !item.error);
}
