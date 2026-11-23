// custom-mods: Phase 1 Foundry VTT -> Marinara bridge helpers (combat recap + rulesetLive sync).
import { normalizeCharacterLookupName, type RulesetLiveState, type RulesetLiveStates } from "@marinara-engine/shared";
import { z } from "zod";
import { cardNames } from "./roleplay-attack.service.js";

const FOE_PREFIX = "foe:";

export const foundryCombatResultSchema = z.object({
  rounds: z.number().int().min(0).max(999).optional(),
  sceneName: z.string().max(200).optional(),
  summary: z.string().max(8000).optional(),
  postMessage: z.boolean().optional(),
  clearFoes: z.boolean().optional(),
  combatants: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        disposition: z.enum(["friendly", "neutral", "hostile", "secret"]).optional(),
        hp: z.number().int().optional(),
        maxHp: z.number().int().optional(),
        defeated: z.boolean().optional(),
      }),
    )
    .max(100)
    .optional(),
  actors: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        hp: z.object({ value: z.number().int(), max: z.number().int().optional() }).optional(),
        spells: z
          .record(z.string(), z.object({ value: z.number().int().min(0), max: z.number().int().min(0).optional() }))
          .optional(),
        concentration: z.string().max(200).nullable().optional(),
      }),
    )
    .max(40)
    .optional(),
  log: z.array(z.string().max(500)).max(60).optional(),
});

export type FoundryCombatResultInput = z.infer<typeof foundryCombatResultSchema>;

function matchPartyMemberKey(names: string[], actorName: string): string {
  const key = normalizeCharacterLookupName(actorName);
  if (!key) return "";
  const exact = names.find((name) => normalizeCharacterLookupName(name) === key);
  if (exact) return normalizeCharacterLookupName(exact);
  const starts = names.filter((name) => {
    const memberKey = normalizeCharacterLookupName(name);
    return memberKey.startsWith(`${key} `) || key.startsWith(`${memberKey} `);
  });
  return starts.length === 1 ? normalizeCharacterLookupName(starts[0]!) : key;
}

function foundrySpellPoolId(foundryKey: string): string | null {
  if (foundryKey === "pact") return "pact_slots";
  const match = /^spell([1-9])$/.exec(foundryKey);
  return match ? `slots_${match[1]}` : null;
}

/** Merge Foundry post-combat actor HP, spell slots and concentration into Marinara's `rulesetLive`. */
export function applyFoundryActorsToRulesetLive(
  current: RulesetLiveStates | null | undefined,
  cards: unknown,
  input: Pick<FoundryCombatResultInput, "actors" | "clearFoes">,
): { live: RulesetLiveStates; updatedMembers: string[] } {
  const next: RulesetLiveStates = {};
  for (const [key, state] of Object.entries(current ?? {})) {
    if (input.clearFoes !== false && key.startsWith(FOE_PREFIX)) continue;
    next[key] = structuredClone(state);
  }
  const names = cardNames(cards);
  const updatedMembers: string[] = [];

  for (const actor of input.actors ?? []) {
    const key = matchPartyMemberKey(names, actor.name);
    if (!key) continue;
    const prev: RulesetLiveState = next[key] ? structuredClone(next[key]!) : {};
    const pools = { ...(prev.pools ?? {}) };
    let changed = false;

    if (actor.hp) {
      pools.hp = { value: Math.max(0, actor.hp.value) };
      changed = true;
    }
    if (actor.spells) {
      for (const [spellKey, slot] of Object.entries(actor.spells)) {
        const poolId = foundrySpellPoolId(spellKey);
        if (!poolId) continue;
        pools[poolId] = { value: Math.max(0, slot.value) };
        changed = true;
      }
    }

    const text = { ...(prev.text ?? {}) };
    if (actor.concentration !== undefined) {
      if (actor.concentration) text.concentration = actor.concentration;
      else delete text.concentration;
      changed = true;
    }

    if (!changed) continue;
    next[key] = {
      ...prev,
      ...(Object.keys(pools).length > 0 ? { pools } : {}),
      ...(Object.keys(text).length > 0 ? { text } : {}),
    };
    if (Object.keys(text).length === 0) delete next[key]!.text;
    updatedMembers.push(key);
  }

  return { live: next, updatedMembers };
}

/** Format a concise OOC recap for the Roleplay narrator from a Foundry combat payload. */
export function formatFoundryCombatRecap(input: FoundryCombatResultInput): string {
  if (input.summary?.trim()) {
    return `[ooc: Foundry VTT Combat Recap${input.sceneName ? ` (${input.sceneName})` : ""}\n${input.summary.trim()}]`;
  }
  const lines: string[] = [];
  const header = [
    "Foundry VTT Combat Recap",
    input.sceneName ? `Scene: ${input.sceneName}` : "",
    input.rounds !== undefined ? `Rounds: ${input.rounds}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  lines.push(header);

  const foes = (input.combatants ?? []).filter((c) => c.disposition === "hostile");
  if (foes.length > 0) {
    const defeated = foes.filter((c) => c.defeated || (c.hp !== undefined && c.hp <= 0)).map((c) => c.name);
    const standing = foes
      .filter((c) => !c.defeated && (c.hp === undefined || c.hp > 0))
      .map((c) => (c.hp !== undefined && c.maxHp !== undefined ? `${c.name} (${c.hp}/${c.maxHp} HP)` : c.name));
    if (defeated.length > 0) lines.push(`Defeated foes: ${defeated.join(", ")}`);
    if (standing.length > 0) lines.push(`Surviving foes: ${standing.join(", ")}`);
  }

  if ((input.actors ?? []).length > 0) {
    const partySummary = input.actors!.map((actor) => {
      const parts: string[] = [];
      if (actor.hp) {
        parts.push(actor.hp.max !== undefined ? `${actor.hp.value}/${actor.hp.max} HP` : `${actor.hp.value} HP`);
      }
      if (actor.spells) {
        const slots = Object.entries(actor.spells)
          .filter(([, v]) => (v.max ?? v.value) > 0)
          .map(([k, v]) => `${k.replace("spell", "L")}:${v.value}${v.max !== undefined ? `/${v.max}` : ""}`);
        if (slots.length > 0) parts.push(`slots ${slots.join(" ")}`);
      }
      if (actor.concentration) parts.push(`conc: ${actor.concentration}`);
      return `${actor.name} (${parts.join(", ") || "unchanged"})`;
    });
    lines.push(`Party state: ${partySummary.join("; ")}`);
  }

  if ((input.log ?? []).length > 0) {
    lines.push(`Highlights:\n${input.log!.map((entry) => `- ${entry}`).join("\n")}`);
  }

  return `[ooc: ${lines.join("\n")}]`;
}
