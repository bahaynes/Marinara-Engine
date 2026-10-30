/**
 * Drops Character Tracker rows the Decision model judges to have left the scene (custom-mods).
 *
 * The tracker writes its present list inside one batched JSON reply and tends to copy last
 * turn's rows forward, so a character who walked off stays listed for many turns. Each
 * tracked character gets one yes/no question about leaving, asked on the turn it happens,
 * while the departure is still in the transcript. Asking "has left" rather than "is here"
 * keeps someone who is present but unnamed in the latest reply: removal needs evidence.
 */
import { logger } from "../../lib/logger.js";
import {
  DECISION_SETTINGS_KEYS,
  resolveDecisionBackend,
  type DecisionBackend,
  type DecisionDefaultDeps,
} from "../decision/decision-default.js";
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

/** The turn's departure check, from the generate route. Any failure keeps the tracker's list. */
export async function applyTrackerDepartureCheck<T extends TrackedCharacter>(args: {
  characters: T[];
  appSettings: { get(key: string): Promise<string | null> };
  connections: {
    getDefaultForDecision: DecisionDefaultDeps["getDefaultConnection"];
    getWithKey: DecisionDefaultDeps["getConnectionWithKey"];
  };
  debugMode: boolean;
  signal: AbortSignal;
  recentMessages: ReadonlyArray<{ role: string; content: string }>;
  personaName: string;
  impersonate?: boolean;
  response: string | null | undefined;
  skip: (character: T) => boolean;
}): Promise<T[]> {
  try {
    const backend = await resolveDecisionBackend(
      {
        getLocalDefault: () => args.appSettings.get(DECISION_SETTINGS_KEYS.localDefault),
        getThinkingPreGeneration: async () =>
          (await args.appSettings.get(DECISION_SETTINGS_KEYS.thinkingPreGeneration)) === "true",
        getDefaultConnection: () => args.connections.getDefaultForDecision(),
        getConnectionWithKey: (id) => args.connections.getWithKey(id),
        debugMode: args.debugMode,
      },
      args.signal,
    );
    if (!backend) return args.characters;
    const speaker = (role: string) => (role === "user" ? args.personaName : "the narrator");
    const latestRole = args.impersonate ? "user" : "assistant";
    const { kept, dropped } = await dropDepartedTrackerCharacters({
      characters: args.characters,
      backend,
      messages: [
        ...args.recentMessages.map((message) => ({
          role: message.role,
          name: speaker(message.role),
          content: message.content,
        })),
        { role: latestRole, name: speaker(latestRole), content: args.response ?? "" },
      ],
      skip: args.skip,
    });
    if (dropped.length === 0) return args.characters;
    logger.info("[generate] character-tracker: Decision model removed departed %s", dropped.join(", "));
    return kept;
  } catch (err) {
    logger.warn(err, "[generate] character-tracker departure check failed; keeping the tracker's list");
    return args.characters;
  }
}
