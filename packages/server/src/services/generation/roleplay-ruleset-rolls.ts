import {
  evaluateRulesetSheetLive,
  rulesetDifficultyStepDc,
  matchRulesetCheckTarget,
  readRulesetSheetEnvelope,
  rulesetCheckModifier,
  type RulesetDefinition,
} from "@marinara-engine/shared";
import {
  buildSkillCheckRulesetContext,
  type SkillCheckRulesetContext,
} from "../game/skill-check-resolution.service.js";

/** Skill, save and ability names the pinned ruleset answers to, for the roll command's hint line. */
export function rulesetCheckNames(definition: RulesetDefinition): string[] {
  const { skills, saves, abilities } = definition.sheet;
  return [...skills, ...saves, ...abilities].map((entry) => entry.label);
}

/** The ruleset's own difficulty scale, for the roll command's hint: a pool or symbol ruleset's `dc` is
 *  not a d20 target, so the model must read it off the ladder. */
export function rulesetDifficultyHint(definition: RulesetDefinition): string {
  const steps = definition.resolution.difficultyLadder as Parameters<typeof rulesetDifficultyStepDc>[0][];
  if (!steps.length) return "";
  return `This ruleset rolls ${definition.resolution.kind} checks, so the engine rolls them by its own rules and ignores notation and modifier. Set dc from its difficulty scale: ${steps.map((step) => `${step.label} ${rulesetDifficultyStepDc(step)}`).join(", ")}.`;
}

/** Every participant's sheet evaluated once, so a turn's rolls all read the same sheets. */
export function roleplayRulesetContext(
  definition: RulesetDefinition,
  participants: readonly { id: string; name: string; rulesetSheets?: unknown }[],
  playerId: string | null,
): SkillCheckRulesetContext {
  const cards = participants.map((entry) => ({
    name: entry.name,
    rulesetSheet: (entry.rulesetSheets as Record<string, unknown> | undefined)?.[definition.id],
  }));
  const playerIndex = participants.findIndex((entry) => entry.id === playerId);
  return buildSkillCheckRulesetContext(definition, cards, playerIndex >= 0 ? cards[playerIndex] : undefined);
}

/**
 * The modifier a participant's ruleset sheet gives a named check, or null when the participant has no
 * sheet for this ruleset or the ruleset has no such check (the roll then stays plain dice).
 *
 * Only the legacy fallback now: a named check with a dc rolls through the ruleset's own resolver
 * (`resolveSkillCheckWithContext`), so every resolution kind works. This still serves a dice-sum
 * roll that names no dc.
 */
export function rulesetRollModifier(
  definition: RulesetDefinition,
  rulesetSheets: unknown,
  checkName: string,
): { label: string; modifier: number; ability?: string; abilityModifier?: number } | null {
  const stored = (rulesetSheets as Record<string, unknown> | undefined)?.[definition.id];
  const envelope = readRulesetSheetEnvelope(definition, stored);
  if (!envelope) return null;
  const target = matchRulesetCheckTarget(definition, checkName, undefined, envelope.build);
  if (!target) return null;
  const evaluated = evaluateRulesetSheetLive(definition, envelope.build);
  const abilityId = target.type === "ability" ? target.id : target.ability;
  const ability = definition.sheet.abilities.find((entry) => entry.id === abilityId);
  return {
    label: target.label,
    modifier: rulesetCheckModifier(evaluated, target),
    ...(ability
      ? { ability: ability.short ?? ability.label, abilityModifier: evaluated.abilityMods[ability.id] ?? 0 }
      : {}),
  };
}
