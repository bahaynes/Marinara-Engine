import { defaultRulesetSheetBuild } from "../features/rulesets/sheet-math.js";
import { readRulesetLive } from "../features/rulesets/live-state.js";
import type { RulesetDefinition } from "../schemas/ruleset.schema.js";
import { normalizeCharacterLookupName } from "./character-lookup-name.js";

/** The live pool a ruleset declares to give its characters Inspiration in roleplay chats. */
export const RP_INSPIRATION_POOL_ID = "inspiration";

export interface RpInspiration {
  value: number;
  max: number;
}

/**
 * One character's Inspiration in a roleplay chat under a ruleset that declares the pool, or null
 * when it does not (the chat's single `gameInspiration` counter then applies). Counts are kept per
 * character in `metadata.gameRpInspiration`; one never stored starts where the pool starts.
 *
 * ponytail: the pool's start and maximum are read off the ruleset's default sheet, so a maximum
 * that depends on a sheet field reads at its default for every character. Upgrade by passing the
 * character's own sheet build to `readRulesetLive`.
 */
export function rpInspirationOf(
  metadata: Record<string, unknown>,
  definition: RulesetDefinition | null | undefined,
  characterName: string,
): RpInspiration | null {
  if (!definition) return null;
  const pool = readRulesetLive(definition, defaultRulesetSheetBuild(definition), undefined).pools.find(
    (entry) => entry.key === RP_INSPIRATION_POOL_ID,
  );
  if (!pool) return null;
  const stored = (metadata.gameRpInspiration as Record<string, unknown> | undefined)?.[
    normalizeCharacterLookupName(characterName)
  ];
  const value = typeof stored === "number" && Number.isFinite(stored) ? stored : pool.value;
  return { value: Math.max(0, Math.min(pool.max, Math.trunc(value))), max: pool.max };
}

/** The `gameRpInspiration` map after changing one character's count by `delta`, clamped to the pool, or
 *  null when the ruleset has no pool or nothing would change. */
export function rpInspirationAfter(
  metadata: Record<string, unknown>,
  definition: RulesetDefinition | null | undefined,
  characterName: string,
  delta: number,
): { gameRpInspiration: Record<string, number>; value: number; max: number } | null {
  const current = rpInspirationOf(metadata, definition, characterName);
  if (!current) return null;
  const value = Math.max(0, Math.min(current.max, current.value + delta));
  if (value === current.value) return null;
  const stored = (metadata.gameRpInspiration as Record<string, number> | undefined) ?? {};
  return {
    gameRpInspiration: { ...stored, [normalizeCharacterLookupName(characterName)]: value },
    value,
    max: current.max,
  };
}
