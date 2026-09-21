import { parseDiceNotation, type RPGStatsConfig } from "@marinara-engine/shared";
import { normalizeCharacterLookupName } from "../game/name-normalization.js";
import { attributeModifier, getGoverningAttribute, mapSheetAttributesToRPG } from "../game/skill-check.service.js";

/** Resolve a participant's assigned attribute or skill without guessing another character or stat. */
export function prepareRoleplayRoll(
  args: Record<string, unknown>,
  characters: readonly { id: string; name: string; rpgStats?: RPGStatsConfig }[],
  fallbackCharacterId: string | null,
): Record<string, unknown> {
  if (args.character !== undefined && typeof args.character !== "string")
    throw new Error("The roll character must be a participant name.");
  const requested = typeof args.character === "string" ? args.character.trim() : "";
  const matches = requested
    ? characters.filter(
        (character) =>
          character.id === requested ||
          normalizeCharacterLookupName(character.name) === normalizeCharacterLookupName(requested),
      )
    : characters.filter((character) => character.id === fallbackCharacterId);
  if (requested && matches.length !== 1) throw new Error(`The roll must name one chat participant: ${requested}`);
  const character = matches[0];
  const requestedSkill = typeof args.skill === "string" ? args.skill.trim() : "";
  const rawAttribute = typeof args.attribute === "string" ? args.attribute.trim() : "";
  const parsed = typeof args.notation === "string" ? parseDiceNotation(args.notation) : null;
  if (!parsed || !character) return args;
  const stats = character.rpgStats;
  let bonus = 0;

  // Resolve skill and governing attribute using the same service as Game Mode. A name already on
  // the sheet (including homebrew abilities like "Luck") always wins over the skill table - only
  // reroute through getGoverningAttribute when the name isn't a stat the character actually has.
  const isBareAbility = /^(str(ength)?|dex(terity)?|con(stitution)?|int(elligence)?|wis(dom)?|cha(risma)?)$/i.test(
    rawAttribute,
  );
  const isSheetAttribute = stats?.attributes.some(
    (item) => item.name.trim().toLowerCase() === rawAttribute.toLowerCase(),
  );
  const skillName = requestedSkill || (!isBareAbility && !isSheetAttribute && rawAttribute ? rawAttribute : "");
  const attributeToLookup = skillName ? getGoverningAttribute(skillName) : rawAttribute;

  if (stats?.enabled && attributeToLookup) {
    const exact = stats.attributes.find((item) => item.name.trim().toLowerCase() === attributeToLookup.toLowerCase());
    // This mapper omits unrecognized names; an unknown attribute must not pick a default stat.
    const canonical = Object.keys(mapSheetAttributesToRPG([{ name: attributeToLookup, value: 0 }]))[0];
    const score =
      exact?.value ??
      (canonical
        ? mapSheetAttributesToRPG(stats.attributes)[canonical as keyof ReturnType<typeof mapSheetAttributesToRPG>]
        : undefined);
    if (typeof score === "number" && Number.isFinite(score)) bonus = attributeModifier(score);
  }
  const modifier = parsed.modifier + bonus;
  const notation = bonus ? `${parsed.dice}${modifier > 0 ? "+" : ""}${modifier || ""}` : parsed.notation;
  if (!parseDiceNotation(notation)) throw new Error("The attribute-adjusted roll exceeds the supported numeric range.");

  const displayLabel = skillName ? `${skillName} (${attributeToLookup.toUpperCase()})` : attributeToLookup;

  return {
    ...args,
    character: character.name,
    notation,
    reason: [character.name, displayLabel, typeof args.reason === "string" ? args.reason : ""]
      .filter(Boolean)
      .join(" · "),
  };
}
