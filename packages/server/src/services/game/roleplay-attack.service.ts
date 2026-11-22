// ──────────────────────────────────────────────
// custom-mods: `[attack: ...]` in a Roleplay reply, settled by Game Mode's combat resolver
//
// Each tag becomes a throwaway one-swing fight: `createRulesetFight` builds the party member from
// their sheet and the foe from the ruleset's bestiary, the attacker is given the turn, and
// `applyRulesetCombatChoice` throws the attack and its damage. No 5e arithmetic lives here.
//
// What lasts is written into the turn's live sheet state, so a swipe rolls it back with the rest:
// a party member's sheet as the fight left it, and a foe's health under a `foe:` key. Party code
// reads live state by card name, so those keys are inert to it.
// ──────────────────────────────────────────────
import { randomInt } from "node:crypto";
import {
  RULESET_PASS_OPTION,
  applyRulesetCombatChoice,
  createAttackTagRegex,
  findRulesetCreature,
  normalizeCharacterLookupName,
  readAttackTagAttributes,
  rulesetCombatOptions,
  rulesetCombatRoller,
  writeAttackTag,
  type InventoryTrackerRow,
  type RulesetCatalogEntriesById,
  type RulesetCombatEvent,
  type RulesetDefinition,
  type RulesetItemBook,
  type RulesetLiveStates,
  type RulesetSheetItem,
} from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { loadRulesetCatalogEntries } from "./ruleset-catalog.service.js";
import {
  createRulesetFight,
  rulesetFightLiveStates,
  type RulesetFightState,
} from "./ruleset-combat-director.service.js";

const FOE_PREFIX = "foe:";
const PARTY_ID = "attack-party";
const FOE_ID = "attack-foe";

export function hasAttackTags(content: string): boolean {
  return /\[attack:/i.test(content);
}

/** Foes this chat has wounded and not yet felled, for the narrator's reminder. */
export function woundedFoeLines(live: RulesetLiveStates | null | undefined): string[] {
  return Object.entries(live ?? {}).flatMap(([key, state]) => {
    const hp = state.tracks?.hp;
    const max = state.tracks?.max;
    if (!key.startsWith(FOE_PREFIX) || hp === undefined || max === undefined || hp <= 0) return [];
    return [`${state.text?.name ?? key.slice(FOE_PREFIX.length)}: ${hp}/${max} health`];
  });
}

/**
 * The player's equipped weapons from the Inventory Tracker that the ruleset's items know, as sheet items
 * a fight offers beside the sheet's own attacks (a quarterstaff picked up in the story).
 * Weapons only: an equipped item's worn effects (armour, a ring) would change a sheet the card already sets.
 */
export function equippedTrackerWeapons(
  book: Pick<RulesetItemBook, "itemNamed">,
  rows: readonly InventoryTrackerRow[] | null | undefined,
): RulesetSheetItem[] {
  return (rows ?? []).flatMap((row) => {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    const item = name ? book.itemNamed(name)?.entry.item : undefined;
    return item?.attack ? [{ item, quantity: 1, worn: true, name }] : [];
  });
}

export interface RoleplayAttackInput {
  definition: RulesetDefinition;
  packageId: string | null;
  /** The chat's `gameCharacterCards`. */
  cards: unknown;
  playerName: string | null;
  /** The turn's live sheet state so far (start of turn plus what checks spent). */
  live: RulesetLiveStates | null;
  partyCatalogs: RulesetCatalogEntriesById;
  /** The ruleset's creature catalogs; read from the package when left out. */
  bestiary?: RulesetCatalogEntriesById;
  /** The player's equipped weapons (`equippedTrackerWeapons`), read only when the player attacks. */
  playerWeapons?: () => Promise<RulesetSheetItem[]>;
}

export interface RoleplayAttackOutcome {
  content: string;
  /** Changed live entries (whole states), to fold over the turn's live state; null when none. */
  live: RulesetLiveStates | null;
  /** One line per settled or refused attack, for the narrator's rewrite. */
  summary: string[];
  resolved: number;
}

function cardNames(cards: unknown): string[] {
  return (Array.isArray(cards) ? cards : [])
    .map((card) => (typeof card?.name === "string" ? card.name.trim() : ""))
    .filter(Boolean);
}

/** A party member by name: exact, else the one card whose name starts with it ("Nadia" for "Nadia Vey"). */
function partyMember(names: string[], said: string): string | undefined {
  const key = normalizeCharacterLookupName(said);
  if (!key) return undefined;
  const exact = names.find((name) => normalizeCharacterLookupName(name) === key);
  if (exact) return exact;
  const starts = names.filter((name) => normalizeCharacterLookupName(name).startsWith(`${key} `));
  return starts.length === 1 ? starts[0] : undefined;
}

/** "Goblin 2" and "Goblin B" are Goblins. */
const creatureName = (name: string) => name.replace(/\s+(\d+|[A-Z])$/, "").trim();

async function loadBestiary(
  definition: RulesetDefinition,
  packageId: string | null,
): Promise<RulesetCatalogEntriesById> {
  const bestiary: RulesetCatalogEntriesById = {};
  if (!packageId) return bestiary;
  for (const catalog of definition.catalogs ?? []) {
    if (catalog.holds !== "creatures") continue;
    const read = await loadRulesetCatalogEntries(packageId, definition, catalog).catch(() => null);
    if (read?.ok) bestiary[catalog.id] = read.entries;
  }
  return bestiary;
}

export async function resolveRoleplayAttackTags(
  content: string,
  input: RoleplayAttackInput,
): Promise<RoleplayAttackOutcome> {
  const none: RoleplayAttackOutcome = { content, live: null, summary: [], resolved: 0 };
  if (!hasAttackTags(content) || !input.definition.combat) return none;
  const names = cardNames(input.cards);
  let bestiary: RulesetCatalogEntriesById | null = input.bestiary ?? null;
  const playerKey = normalizeCharacterLookupName(input.playerName ?? "");
  let playerWeapons: RulesetSheetItem[] | null = null;
  const live: RulesetLiveStates = { ...(input.live ?? {}) };
  const changed: RulesetLiveStates = {};
  const summary: string[] = [];
  let resolved = 0;

  const settle = async (attributes: Record<string, string>): Promise<Record<string, string | number | undefined>> => {
    const refuse = (reason: string) => {
      summary.push(`Attack by ${attributes.who || "?"} on ${attributes.target || "?"} was not rolled: ${reason}`);
      return { ...attributes, reason };
    };
    const who = attributes.who ?? "";
    const target = attributes.target ?? "";
    if (!who || !target) return refuse("an attack needs who= and target=.");
    const whoMember = partyMember(names, who);
    const targetMember = partyMember(names, target);
    if (!!whoMember === !!targetMember)
      return refuse("one side must be a party member and the other a creature from the bestiary.");
    const member = (whoMember ?? targetMember)!;
    const foeName = whoMember ? target : who;
    bestiary ??= await loadBestiary(input.definition, input.packageId);
    if (!findRulesetCreature(bestiary, creatureName(foeName)))
      return refuse(`"${creatureName(foeName)}" is not in the bestiary; name the creature as the bestiary does.`);

    const playerAttacks = !!whoMember && !!playerKey && normalizeCharacterLookupName(member) === playerKey;
    if (playerAttacks && input.playerWeapons) playerWeapons ??= await input.playerWeapons();
    const held = playerAttacks && playerWeapons?.length ? playerWeapons : null;
    const foeKey = `${FOE_PREFIX}${normalizeCharacterLookupName(foeName)}`;
    const stored = live[foeKey]?.tracks;
    const seeded = createRulesetFight({
      definition: input.definition,
      seed: randomInt(1, 2 ** 31 - 1),
      party: [{ id: PARTY_ID, name: member }],
      enemies: [
        {
          id: FOE_ID,
          name: foeName,
          creature: creatureName(foeName),
          ...(stored?.max !== undefined ? { adjust: { maxHp: stored.max } } : {}),
        },
      ],
      positioned: false,
      cards: input.cards,
      playerName: input.playerName,
      live,
      partyCatalogs: input.partyCatalogs,
      bestiary,
      ...(held ? { items: () => held } : {}),
    });
    if (!seeded.ok) return refuse(seeded.error);
    const encounter = structuredClone(seeded.fight.encounter);
    const actorId = whoMember ? PARTY_ID : FOE_ID;
    const targetId = whoMember ? FOE_ID : PARTY_ID;
    const actor = encounter.combatants.find((one) => one.id === actorId);
    const victim = encounter.combatants.find((one) => one.id === targetId);
    if (!actor || !victim) return refuse(`${whoMember ? foeName : member} could not be set up for the attack.`);
    if (targetId === FOE_ID && stored?.hp !== undefined && victim.health) victim.health.value = stored.hp;
    // The attacker takes the turn: a one-swing fight has no initiative to wait on.
    encounter.turn = Math.max(0, encounter.order.indexOf(actorId));
    // The narrator's advantage rides on flags the resolver already reads (help, dodging), for this swing only.
    if (attributes.mode === "advantage") actor.flags.helped = true;
    if (attributes.mode === "disadvantage") victim.flags.dodging = true;

    const weapon = normalizeCharacterLookupName(attributes.weapon ?? "");
    const attacks = rulesetCombatOptions(input.definition, encounter, actorId).filter(
      // A sheet's weapon is an "attack"; a bestiary creature's own action is a "block".
      (option) => (option.kind === "attack" || option.kind === "block") && !option.futile,
    );
    const option =
      attacks.find((one) => normalizeCharacterLookupName(one.label) === weapon) ??
      (weapon ? attacks.find((one) => normalizeCharacterLookupName(one.label).includes(weapon)) : attacks[0]);
    if (!attacks.length)
      return refuse(`${whoMember ? member : foeName} cannot attack right now (down, or no attack to make).`);
    if (!option)
      return refuse(
        `${whoMember ? member : foeName} has no attack named "${attributes.weapon ?? ""}"${
          attacks.length ? `; their attacks are ${attacks.map((one) => one.label).join(", ")}` : ""
        }.`,
      );

    const events: RulesetCombatEvent[] = [];
    let step = applyRulesetCombatChoice(
      input.definition,
      encounter,
      { actorId, optionId: option.id, targetIds: [targetId] },
      rulesetCombatRoller(encounter.seed, encounter.cursor),
    );
    events.push(...step.events);
    // ponytail: every reaction or spend window is passed (no Shield, no Smite). Upgrade path: offer
    // the party member's answers to the narrator.
    for (let guard = 0; step.state.window && guard < 10; guard++) {
      const window = step.state.window;
      step = applyRulesetCombatChoice(
        input.definition,
        step.state,
        { actorId: window.waiting[0]!, optionId: RULESET_PASS_OPTION, targetIds: [], window: window.id },
        rulesetCombatRoller(step.state.seed, step.state.cursor),
      );
      events.push(...step.events);
    }
    const refused = events.find((event) => event.type === "refused");
    const swings = events.filter(
      (event): event is Extract<RulesetCombatEvent, { type: "attack" }> =>
        event.type === "attack" && event.actorId === actorId,
    );
    const hits = events.filter(
      (event): event is Extract<RulesetCombatEvent, { type: "damage" }> =>
        event.type === "damage" && event.targetId === targetId,
    );
    // A creature's action with no attack roll (a breath, a save) still counts when it did harm.
    if (!swings.length && !hits.length)
      return refuse(refused ? `the attack was refused (${JSON.stringify(refused)}).` : "no attack was made.");
    const dealt = hits.reduce((sum, hit) => sum + hit.dealt, 0);
    const last = hits.at(-1);
    const after = step.state.combatants.find((one) => one.id === targetId)?.health;
    const health = last?.health ?? after?.value;
    const maxHealth = last?.maxHealth ?? after?.max;

    if (targetId === PARTY_ID && hits.length) {
      const key = normalizeCharacterLookupName(member);
      const written = rulesetFightLiveStates({ encounter: step.state } as RulesetFightState)[key];
      if (written) live[key] = changed[key] = written;
    } else if (hits.length && health !== undefined && maxHealth !== undefined) {
      // ponytail: a felled foe's entry is emptied, so a later one of the same name starts whole.
      // Upgrade path: keep the dead and let the narrator number a new one.
      live[foeKey] = changed[foeKey] =
        health > 0 ? { tracks: { hp: health, max: maxHealth }, text: { name: foeName } } : {};
    }
    resolved++;
    const first = swings[0];
    const outcome = !first
      ? "hit"
      : swings.some((swing) => swing.outcome === "critical")
        ? "critical"
        : swings.some((swing) => swing.outcome !== "miss")
          ? "hit"
          : "miss";
    const damageType = last?.damageType;
    const left =
      health === undefined
        ? ""
        : health <= 0
          ? `; ${targetId === FOE_ID ? foeName : member} is down`
          : `; ${targetId === FOE_ID ? foeName : member} on ${health}/${maxHealth}`;
    summary.push(
      `${who} attacks ${target} with ${option.label}: ${
        swings.length
          ? swings
              .map(
                (swing) =>
                  `${swing.rolls.join("/")} + ${swing.modifier} = ${swing.total} against ${swing.defense}, ${swing.outcome}`,
              )
              .join("; ")
          : "no attack roll"
      }${dealt ? `, ${dealt}${damageType ? ` ${damageType}` : ""} damage` : ""}${left}.`,
    );
    return {
      who,
      weapon: option.label,
      target,
      mode: first?.mode,
      rolls: first?.rolls.join(","),
      kept: first?.kept,
      modifier: first?.modifier,
      total: first?.total,
      defense: first?.defense,
      result: outcome,
      strikes: swings.length > 1 ? swings.length : undefined,
      damage: dealt || undefined,
      damage_type: damageType,
      health: health === undefined ? undefined : `${Math.max(0, health)}/${maxHealth}`,
    };
  };

  let out = "";
  let at = 0;
  for (const match of content.matchAll(createAttackTagRegex())) {
    const attributes = readAttackTagAttributes(match[1] ?? "");
    out += content.slice(at, match.index);
    at = (match.index ?? 0) + match[0].length;
    // A record already settled (a continuation's saved text) is never thrown again.
    if (attributes.result || attributes.reason) {
      out += match[0];
      continue;
    }
    try {
      out += writeAttackTag(await settle(attributes));
    } catch (err) {
      logger.warn(err, "[roleplay/attack] Could not settle %s", match[0]);
      summary.push(
        `Attack by ${attributes.who || "?"} on ${attributes.target || "?"} was not rolled: the Engine failed.`,
      );
      out += writeAttackTag({ ...attributes, reason: "the Engine failed" });
    }
  }
  out += content.slice(at);
  return { content: out, live: Object.keys(changed).length ? changed : null, summary, resolved };
}
