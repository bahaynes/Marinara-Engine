// ──────────────────────────────────────────────
// D&D 5.5e Weapons Data Source & Resolver Engine
// ──────────────────────────────────────────────

import type { DndCombatant, DndWeapon, DndStats } from "./types.js";
import { abilityModifier } from "./math.js";

export const WEAPON_CATALOG: DndWeapon[] = [
  // ── Martial Melee Weapons ──
  {
    id: "greatsword",
    name: "Greatsword",
    category: "martial_melee",
    damageDie: "2d6",
    damageType: "slashing",
    attackStat: "str",
    rangeFt: 5,
    properties: ["heavy", "two-handed"],
    mastery: "Graze",
    icon: "⚔️",
    description: "Massive two-handed blade (2d6 slashing). Graze: Deals STR mod damage even on a miss!",
    defaultForClasses: ["Fighter", "Barbarian", "Paladin"],
  },
  {
    id: "greataxe",
    name: "Greataxe",
    category: "martial_melee",
    damageDie: "1d12",
    damageType: "slashing",
    attackStat: "str",
    rangeFt: 5,
    properties: ["heavy", "two-handed"],
    mastery: "Cleave",
    icon: "🪓",
    description: "Devastating battle axe (1d12 slashing). Cleave: Strike an adjacent foe with excess momentum.",
    defaultForClasses: ["Barbarian", "Fighter"],
  },
  {
    id: "longsword",
    name: "Longsword",
    category: "martial_melee",
    damageDie: "1d8",
    damageType: "slashing",
    attackStat: "str",
    rangeFt: 5,
    properties: ["versatile"],
    mastery: "Sap",
    icon: "⚔️",
    description: "Classic versatile sword (1d8/1d10 slashing). Sap: Inflicts disadvantage on target's next attack.",
    defaultForClasses: ["Paladin", "Fighter"],
  },
  {
    id: "rapier",
    name: "Rapier",
    category: "martial_melee",
    damageDie: "1d8",
    damageType: "piercing",
    attackStat: "finesse",
    rangeFt: 5,
    properties: ["finesse"],
    mastery: "Vex",
    icon: "🗡️",
    description: "Elegant precision dueling sword (1d8 piercing, Finesse). Vex: Grants advantage on your next attack.",
    defaultForClasses: ["Rogue", "Bard", "Ranger"],
  },
  {
    id: "shortsword",
    name: "Shortsword",
    category: "martial_melee",
    damageDie: "1d6",
    damageType: "piercing",
    attackStat: "finesse",
    rangeFt: 5,
    properties: ["finesse", "light"],
    mastery: "Vex",
    icon: "🗡️",
    description: "Light dual-wielding blade (1d6 piercing, Finesse/Light). Vex: Grants advantage on next strike.",
    defaultForClasses: ["Rogue", "Ranger", "Monk"],
  },
  {
    id: "scimitar",
    name: "Scimitar",
    category: "martial_melee",
    damageDie: "1d6",
    damageType: "slashing",
    attackStat: "finesse",
    rangeFt: 5,
    properties: ["finesse", "light"],
    mastery: "Nick",
    icon: "🗡️",
    description: "Curved light slashing blade (1d6 slashing, Finesse/Light). Nick: Extra attack without bonus action.",
    defaultForClasses: ["Druid", "Ranger", "Rogue"],
  },
  {
    id: "halberd",
    name: "Halberd",
    category: "martial_melee",
    damageDie: "1d10",
    damageType: "slashing",
    attackStat: "str",
    rangeFt: 10,
    properties: ["heavy", "reach", "two-handed"],
    mastery: "Cleave",
    icon: "🔱",
    description: "Extended polearm weapon (1d10 slashing, 10ft Reach). Cleave: Swings into nearby foes.",
    defaultForClasses: ["Fighter", "Paladin"],
  },
  {
    id: "warhammer",
    name: "Warhammer",
    category: "martial_melee",
    damageDie: "1d8",
    damageType: "bludgeoning",
    attackStat: "str",
    rangeFt: 5,
    properties: ["versatile"],
    mastery: "Push",
    icon: "🔨",
    description: "Crushing heavy hammer (1d8/1d10 bludgeoning). Push: Slams target up to 10 feet away.",
    defaultForClasses: ["Cleric", "Paladin", "Fighter"],
  },
  {
    id: "maul",
    name: "Maul",
    category: "martial_melee",
    damageDie: "2d6",
    damageType: "bludgeoning",
    attackStat: "str",
    rangeFt: 5,
    properties: ["heavy", "two-handed"],
    mastery: "Topple",
    icon: "🔨",
    description: "Massive two-handed hammer (2d6 bludgeoning). Topple: Forces Constitution save or falls prone.",
    defaultForClasses: ["Fighter", "Barbarian", "Paladin"],
  },

  // ── Simple Melee Weapons ──
  {
    id: "dagger",
    name: "Dagger",
    category: "simple_melee",
    damageDie: "1d4",
    damageType: "piercing",
    attackStat: "finesse",
    rangeFt: 20,
    maxRangeFt: 60,
    properties: ["finesse", "light", "thrown"],
    mastery: "Nick",
    icon: "🗡️",
    description: "Concealed light blade (1d4 piercing, Finesse/Thrown 20/60ft). Nick: Fast dual-strike.",
    defaultForClasses: ["Wizard", "Sorcerer", "Warlock", "Rogue", "Bard"],
  },
  {
    id: "quarterstaff",
    name: "Quarterstaff",
    category: "simple_melee",
    damageDie: "1d6",
    damageType: "bludgeoning",
    attackStat: "versatile",
    rangeFt: 5,
    properties: ["versatile"],
    mastery: "Topple",
    icon: "🦯",
    description: "Hardwood combat staff (1d6/1d8 bludgeoning). Topple: Trips and knocks enemies prone.",
    defaultForClasses: ["Monk", "Druid", "Wizard", "Sorcerer"],
  },
  {
    id: "handaxe",
    name: "Handaxe",
    category: "simple_melee",
    damageDie: "1d6",
    damageType: "slashing",
    attackStat: "str",
    rangeFt: 20,
    maxRangeFt: 60,
    properties: ["light", "thrown"],
    mastery: "Vex",
    icon: "🪓",
    description: "Versatile light throwing axe (1d6 slashing, Thrown 20/60ft).",
    defaultForClasses: ["Barbarian", "Ranger"],
  },
  {
    id: "spear",
    name: "Spear",
    category: "simple_melee",
    damageDie: "1d6",
    damageType: "piercing",
    attackStat: "versatile",
    rangeFt: 20,
    maxRangeFt: 60,
    properties: ["thrown", "versatile"],
    mastery: "Sap",
    icon: "🔱",
    description: "Thrusting and throwing polearm (1d6/1d8 piercing, Thrown 20/60ft).",
    defaultForClasses: ["Druid", "Monk", "Cleric"],
  },
  {
    id: "mace",
    name: "Mace",
    category: "simple_melee",
    damageDie: "1d6",
    damageType: "bludgeoning",
    attackStat: "str",
    rangeFt: 5,
    properties: [],
    mastery: "Sap",
    icon: "🔨",
    description: "Flanged iron mace (1d6 bludgeoning). Sap: Weakens enemy counter-attacks.",
    defaultForClasses: ["Cleric"],
  },

  // ── Ranged Weapons ──
  {
    id: "longbow",
    name: "Longbow",
    category: "martial_ranged",
    damageDie: "1d8",
    damageType: "piercing",
    attackStat: "dex",
    rangeFt: 150,
    maxRangeFt: 600,
    properties: ["heavy", "range", "two-handed"],
    mastery: "Slow",
    icon: "🏹",
    description: "Powerful long-range war bow (1d8 piercing, 150/600ft). Slow: Reduces target speed by 10ft.",
    defaultForClasses: ["Ranger", "Fighter"],
  },
  {
    id: "shortbow",
    name: "Shortbow",
    category: "simple_ranged",
    damageDie: "1d6",
    damageType: "piercing",
    attackStat: "dex",
    rangeFt: 80,
    maxRangeFt: 320,
    properties: ["range", "two-handed"],
    mastery: "Vex",
    icon: "🏹",
    description: "Compact agile hunting bow (1d6 piercing, 80/320ft). Vex: Grants advantage on next hit.",
    defaultForClasses: ["Rogue", "Bard"],
  },
  {
    id: "heavy_crossbow",
    name: "Heavy Crossbow",
    category: "martial_ranged",
    damageDie: "1d10",
    damageType: "piercing",
    attackStat: "dex",
    rangeFt: 100,
    maxRangeFt: 400,
    properties: ["heavy", "loading", "range", "two-handed"],
    mastery: "Push",
    icon: "🎯",
    description: "High-impact crossbow mechanism (1d10 piercing, 100/400ft). Push: Knocks target 10ft back.",
    defaultForClasses: ["Fighter"],
  },
  {
    id: "hand_crossbow",
    name: "Hand Crossbow",
    category: "martial_ranged",
    damageDie: "1d6",
    damageType: "piercing",
    attackStat: "dex",
    rangeFt: 30,
    maxRangeFt: 120,
    properties: ["light", "loading", "range"],
    mastery: "Vex",
    icon: "🎯",
    description: "One-handed rapid firing crossbow (1d6 piercing, 30/120ft).",
    defaultForClasses: ["Rogue", "Bard"],
  },

  // ── Monster / Beast Weapons ──
  {
    id: "claws_bite",
    name: "Bite & Claws",
    category: "simple_melee",
    damageDie: "2d4",
    damageType: "piercing",
    attackStat: "str",
    rangeFt: 5,
    properties: [],
    mastery: "Topple",
    icon: "🐺",
    description: "Ferocious predatory jaws and rending claws (2d4 piercing/slashing).",
    defaultForClasses: ["Wolf", "Beast", "Monstrosity"],
  },
  {
    id: "rusty_blade",
    name: "Rusty Blade",
    category: "simple_melee",
    damageDie: "1d6",
    damageType: "slashing",
    attackStat: "str",
    rangeFt: 5,
    properties: [],
    mastery: "Sap",
    icon: "🗡️",
    description: "Corroded jagged iron blade (1d6 slashing).",
    defaultForClasses: ["Skeleton", "Zombie", "Goblin", "Orc", "Cultist"],
  },
];

/** Resolve the equipped or default weapon for a combatant based on class and stats */
export function getCombatantWeapon(combatant: DndCombatant): DndWeapon {
  if (combatant.equippedWeapon) {
    return combatant.equippedWeapon;
  }

  if (combatant.weaponId) {
    const found = WEAPON_CATALOG.find((w) => w.id === combatant.weaponId);
    if (found) return found;
  }

  const cls = (combatant.unitClass || "").toLowerCase();

  // Match default weapon by class
  if (/barbarian/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "greataxe") || WEAPON_CATALOG[0]!;
  }
  if (/paladin/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "longsword") || WEAPON_CATALOG[0]!;
  }
  if (/rogue|soulknife|assassin|thief/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "rapier") || WEAPON_CATALOG[0]!;
  }
  if (/ranger/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "longbow") || WEAPON_CATALOG[0]!;
  }
  if (/monk/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "quarterstaff") || WEAPON_CATALOG[0]!;
  }
  if (/cleric/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "warhammer") || WEAPON_CATALOG[0]!;
  }
  if (/druid/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "scimitar") || WEAPON_CATALOG[0]!;
  }
  if (/wizard|sorcerer|warlock/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "dagger") || WEAPON_CATALOG[0]!;
  }
  if (/bard/i.test(cls)) {
    return WEAPON_CATALOG.find((w) => w.id === "rapier") || WEAPON_CATALOG[0]!;
  }
  if (/wolf|hound|beast|bear|spider/i.test(cls) || /wolf|hound|beast|bear/i.test(combatant.name)) {
    return WEAPON_CATALOG.find((w) => w.id === "claws_bite") || WEAPON_CATALOG[0]!;
  }
  if (/skeleton|zombie|goblin|orc|cultist/i.test(cls) || /skeleton|zombie|goblin|orc|cultist/i.test(combatant.name)) {
    return WEAPON_CATALOG.find((w) => w.id === "rusty_blade") || WEAPON_CATALOG[0]!;
  }

  // Default martial vs simple
  const str = combatant.stats.str || 10;
  const dex = combatant.stats.dex || 10;
  if (dex > str) {
    return WEAPON_CATALOG.find((w) => w.id === "rapier") || WEAPON_CATALOG[0]!;
  }
  return WEAPON_CATALOG.find((w) => w.id === "greatsword") || WEAPON_CATALOG[0]!;
}

/** Calculate the optimal ability modifier for attacking with a weapon */
export function getWeaponAttackModifier(weapon: DndWeapon, stats: DndStats): number {
  const strMod = abilityModifier(stats.str || 10);
  const dexMod = abilityModifier(stats.dex || 10);

  if (weapon.attackStat === "dex" || weapon.properties.includes("range")) {
    return dexMod;
  }
  if (weapon.attackStat === "finesse" || weapon.properties.includes("finesse")) {
    return Math.max(strMod, dexMod);
  }
  return strMod;
}
