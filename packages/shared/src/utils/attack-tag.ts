// ──────────────────────────────────────────────
// custom-mods: `[attack: ...]`, a weapon attack written into a Roleplay reply
//
// A Roleplay chat pinned to a ruleset with a `combat` block has no battle screen, so an attack the
// narrator tells (an opportunity attack, a swing at a rat) used to be asked for as the nearest skill
// check. The narrator writes this tag instead; the Engine settles it with Game Mode's own combat
// resolver and rewrites it with the result. This file only reads and writes the tag.
// ──────────────────────────────────────────────
import type { SkillCheckResult } from "../types/game.js";
import { readGmTagAttributes } from "./skill-check-tag.js";

export function createAttackTagRegex(): RegExp {
  return /\[attack:\s*([^\]]+)\]/gi;
}

/** The tag's attributes by lower-cased key, values unquoted. */
export function readAttackTagAttributes(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attribute of readGmTagAttributes(body)) {
    const raw = attribute.rawValue.trim();
    const quoted = raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0];
    out[attribute.key.toLowerCase()] = (quoted ? raw.slice(1, -1) : raw).trim();
  }
  return out;
}

export function writeAttackTag(attributes: Record<string, string | number | undefined>): string {
  const parts = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${String(value).replace(/"/g, "'")}"`);
  return `[attack: ${parts.join(" ")}]`;
}

/** A settled attack as the dice card a check shows: the defense in the DC's place, a hit as a success.
 *  ponytail: the card still labels the defense "DC" and shows no damage; the narration carries the
 *  damage. The upgrade path is an attack card of its own. */
export function attackTagCardResult(attributes: Record<string, string>): SkillCheckResult | null {
  const rolls = (attributes.rolls ?? "")
    .split(",")
    .map((roll) => Number(roll.trim()))
    .filter((roll) => Number.isFinite(roll));
  const total = Number(attributes.total);
  const defense = Number(attributes.defense);
  const result = attributes.result;
  if (!rolls.length || !Number.isFinite(total) || !Number.isFinite(defense) || !result) return null;
  const mode = attributes.mode === "advantage" || attributes.mode === "disadvantage" ? attributes.mode : "normal";
  const usedRoll = Number(attributes.kept ?? rolls[0]);
  const damage = attributes.damage
    ? `${attributes.damage}${attributes.damage_type ? ` ${attributes.damage_type}` : ""}`
    : "";
  return {
    skill: `${attributes.weapon || "Attack"} vs ${attributes.target}`,
    dc: defense,
    rolls,
    usedRoll,
    modifier: Number(attributes.modifier) || 0,
    total,
    success: result !== "miss",
    criticalSuccess: result === "critical",
    criticalFailure: false,
    rollMode: mode,
    resolution: "sum",
    dice: "1d20",
    ...(attributes.who ? { who: attributes.who } : {}),
    ...(damage ? { purpose: damage } : {}),
  };
}
