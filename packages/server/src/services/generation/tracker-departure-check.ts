/**
 * Drops Character Tracker rows the Decision model judges to have left the scene (custom-mods).
 *
 * The tracker writes its present list inside one batched JSON reply and tends to copy last
 * turn's rows forward, so a character who walked off stays listed for many turns. Each
 * tracked character gets one yes/no question about leaving, asked on the turn it happens,
 * while the departure is still in the transcript. Asking "has left" rather than "is here"
 * keeps someone who is present but unnamed in the latest reply: removal needs evidence.
 */
import type { DecisionBackend } from "../decision/decision-default.js";
import { buildDecisionState, type DecisionMessage } from "./agent-activation-questions.js";
import { SCENE_PRESENCE_TRANSCRIPT_DEPTH } from "./scene-presence-decision.js";

export interface TrackedCharacter {
  name?: unknown;
  characterId?: unknown;
}

export function trackerDepartureQuestion(name: string): string {
  return `${name} has left the scene, or the scene has moved away from ${name}. A character who is still there but not mentioned recently has not left.`;
}

/**
 * The rows to keep, and the names dropped. Rows `skip` returns true for (manual rows) are
 * never asked. Every asked row needs an answer, or nobody is dropped: a missing answer is
 * silence, not departure.
 */
export async function dropDepartedTrackerCharacters<T extends TrackedCharacter>(args: {
  characters: T[];
  backend: DecisionBackend;
  messages: DecisionMessage[];
  skip: (character: T) => boolean;
}): Promise<{ kept: T[]; dropped: string[] }> {
  const asked = args.characters
    .map((character, index) => ({ character, id: String(index), name: String(character.name ?? "").trim() }))
    .filter(({ character, name }) => name && !args.skip(character));
  if (asked.length === 0) return { kept: args.characters, dropped: [] };
  const state = buildDecisionState(args.messages, SCENE_PRESENCE_TRANSCRIPT_DEPTH, args.backend.maxStateTokens);
  const answers = await args.backend.ask(
    state,
    asked.map(({ id, name }) => ({ id, instructions: trackerDepartureQuestion(name) })),
  );
  if (!answers || !asked.every(({ id }) => answers.has(id))) return { kept: args.characters, dropped: [] };
  const threshold = args.backend.calibration.defaultThreshold;
  const departed = new Set(asked.filter(({ id }) => answers.get(id)! >= threshold).map(({ character }) => character));
  return {
    kept: args.characters.filter((character) => !departed.has(character)),
    dropped: [...departed].map((character) => String(character.name)),
  };
}
