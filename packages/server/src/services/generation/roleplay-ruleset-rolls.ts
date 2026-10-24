import {
  evaluateRulesetSheetLive,
  matchRulesetCheckTarget,
  readRulesetSheetEnvelope,
  rulesetCheckModifier,
  type RulesetDefinition,
} from "@marinara-engine/shared";

/** Skill, save and ability names the pinned ruleset answers to, for the roll command's hint line. */
export function rulesetCheckNames(definition: RulesetDefinition): string[] {
  const { skills, saves, abilities } = definition.sheet;
  return [...skills, ...saves, ...abilities].map((entry) => entry.label);
}

/**
 * The modifier a participant's ruleset sheet gives a named check, or null when the participant has no
 * sheet for this ruleset or the ruleset has no such check (the roll then stays plain dice).
 *
 * ponytail: only the check's modifier is used, so `dice-sum` rulesets roll as written and other
 * resolution kinds (pools, roll-against) still get plain notation plus their modifier. Upgrade by
 * reusing the roll* functions in sheet-math.ts if an RP chat needs a pool ruleset.
 */
export function rulesetRollModifier(
  definition: RulesetDefinition,
  rulesetSheets: unknown,
  checkName: string,
): { label: string; modifier: number } | null {
  const stored = (rulesetSheets as Record<string, unknown> | undefined)?.[definition.id];
  const envelope = readRulesetSheetEnvelope(definition, stored);
  if (!envelope) return null;
  const target = matchRulesetCheckTarget(definition, checkName, undefined, envelope.build);
  if (!target) return null;
  const evaluated = evaluateRulesetSheetLive(definition, envelope.build);
  return { label: target.label, modifier: rulesetCheckModifier(evaluated, target) };
}
