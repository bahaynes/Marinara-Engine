// ──────────────────────────────────────────────
// D&D 5.5e Pure Combat Math & Turn Resolution
// ──────────────────────────────────────────────

import type {
  DndAbilityName,
  DndStats,
  DndSpell,
  DndAdvantageState,
  DndActionRequest,
  DndSingleStrikeResult,
  DndActionResult,
  DndCombatState,
} from "./types.js";

export function abilityModifier(score: number): number {
  return Math.floor(((score || 10) - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function proficiencyBonus(level: number): number {
  const lvl = Math.max(1, Math.min(20, Math.round(level || 1)));
  return Math.min(6, 2 + Math.floor((lvl - 1) / 4));
}

export function primaryCastingStat(unitClass: string = ""): DndAbilityName {
  const cls = (unitClass || "").toLowerCase();
  if (/warlock|sorcerer|bard|paladin/i.test(cls)) return "cha";
  if (/wizard|artificer/i.test(cls)) return "int";
  if (/cleric|druid|ranger/i.test(cls)) return "wis";
  if (/rogue|monk/i.test(cls)) return "dex";
  return "cha"; // Default caster fallback
}

export function primaryAttackStat(unitClass: string = "", stats: DndStats): DndAbilityName {
  const cls = (unitClass || "").toLowerCase();
  if (/rogue|monk|ranger|archer/i.test(cls)) return "dex";
  if (/barbarian|fighter|paladin/i.test(cls)) {
    return stats.dex > stats.str ? "dex" : "str";
  }
  // Casters using weapon attacks fallback to higher of STR/DEX
  return stats.dex > stats.str ? "dex" : "str";
}

export function cantripScaling(level: number): number {
  const lvl = Math.max(1, Math.round(level || 1));
  if (lvl >= 17) return 4;
  if (lvl >= 11) return 3;
  if (lvl >= 5) return 2;
  return 1;
}

export function martialAttackCount(unitClass: string = "", level: number): number {
  const lvl = Math.max(1, Math.round(level || 1));
  const cls = (unitClass || "").toLowerCase();
  const isFighter = /fighter/i.test(cls);
  const isMartial = /barbarian|paladin|ranger|monk|fighter/i.test(cls);

  if (isFighter && lvl >= 20) return 4;
  if (isFighter && lvl >= 11) return 3;
  if (isMartial && lvl >= 5) return 2;
  return 1;
}

export function rogueSneakAttackDice(level: number): number {
  const lvl = Math.max(1, Math.round(level || 1));
  return Math.ceil(lvl / 2);
}

// ── Complete D&D Spell & Power Catalog ──
export const SPELL_CATALOG: DndSpell[] = [
  // ── Cantrips ──
  {
    id: "eldritch_blast",
    name: "Eldritch Blast",
    level: 0,
    type: "attack",
    damageDie: "d10",
    damageType: "force",
    castingStat: "cha",
    isMultiBeam: true,
    isCantrip: true,
    classes: ["Warlock"],
    description: "Crackling beams of force (1-4 beams by level, +CHA damage per beam).",
  },
  {
    id: "fire_bolt",
    name: "Fire Bolt",
    level: 0,
    type: "attack",
    damageDie: "d10",
    damageType: "fire",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Wizard", "Sorcerer", "Artificer"],
    description: "Hurl a mot of fire (1d10 to 4d10 fire damage).",
  },
  {
    id: "ray_of_frost",
    name: "Ray of Frost",
    level: 0,
    type: "attack",
    damageDie: "d8",
    damageType: "cold",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Wizard", "Sorcerer"],
    description: "Freezing beam of light (1d8 to 4d8 cold damage).",
  },
  {
    id: "shocking_grasp",
    name: "Shocking Grasp",
    level: 0,
    type: "attack",
    damageDie: "d8",
    damageType: "lightning",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Wizard", "Sorcerer", "Artificer"],
    description: "Lightning springs from your hand to deliver a shock (1d8 to 4d8).",
  },
  {
    id: "mind_sliver",
    name: "Mind Sliver",
    level: 0,
    type: "save",
    damageDie: "d6",
    damageType: "psychic",
    saveStat: "int",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Wizard", "Sorcerer", "Warlock"],
    description: "Drive a disorienting spike of psychic energy into target's mind (INT save).",
  },
  {
    id: "sacred_flame",
    level: 0,
    name: "Sacred Flame",
    type: "save",
    damageDie: "d8",
    damageType: "radiant",
    saveStat: "dex",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Cleric"],
    description: "Flame-like radiance descends on target (DEX save vs Spell DC).",
  },
  {
    id: "toll_the_dead",
    level: 0,
    name: "Toll the Dead",
    type: "save",
    damageDie: "d12",
    damageType: "necrotic",
    saveStat: "wis",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Cleric", "Warlock", "Wizard"],
    description: "The sound of a dolorous bell fills the air (WIS save vs Spell DC).",
  },
  {
    id: "vicious_mockery",
    level: 0,
    name: "Vicious Mockery",
    type: "save",
    damageDie: "d4",
    damageType: "psychic",
    saveStat: "wis",
    isMultiBeam: false,
    isCantrip: true,
    classes: ["Bard"],
    description: "Unleash string of insults (WIS save vs Spell DC).",
  },

  // ── Leveled Spells ──
  {
    id: "magic_missile",
    name: "Magic Missile",
    level: 1,
    type: "auto",
    damageDie: "d4",
    diceCount: 3,
    fixedBonus: 3, // 3 darts of 1d4+1
    damageType: "force",
    classes: ["Wizard", "Sorcerer"],
    description: "Three glowing darts of magical force unerringly strike the target (3× 1d4+1 force).",
  },
  {
    id: "guiding_bolt",
    name: "Guiding Bolt",
    level: 1,
    type: "attack",
    damageDie: "d6",
    diceCount: 4,
    damageType: "radiant",
    classes: ["Cleric"],
    description: "A flash of radiant light streaks toward target (4d6 radiant damage).",
  },
  {
    id: "inflict_wounds",
    name: "Inflict Wounds",
    level: 1,
    type: "attack",
    damageDie: "d10",
    diceCount: 3,
    damageType: "necrotic",
    classes: ["Cleric"],
    description: "Channel necrotic corruption with a touch (3d10 necrotic damage).",
  },
  {
    id: "dissonant_whispers",
    name: "Dissonant Whispers",
    level: 1,
    type: "save",
    damageDie: "d6",
    diceCount: 3,
    damageType: "psychic",
    saveStat: "wis",
    classes: ["Bard"],
    description: "Whisper a discordant melody that wracks the target's mind (3d6 psychic, WIS save).",
  },
  {
    id: "cure_wounds",
    name: "Cure Wounds",
    level: 1,
    type: "heal",
    damageDie: "d8",
    diceCount: 2,
    classes: ["Cleric", "Druid", "Bard", "Paladin"],
    description: "Channel soothing divine energy to restore 2d8 + Casting Mod HP.",
  },
  {
    id: "burning_hands",
    name: "Burning Hands",
    level: 1,
    type: "save",
    damageDie: "d6",
    diceCount: 3,
    damageType: "fire",
    saveStat: "dex",
    isAoE: true,
    aoeShape: "cone",
    aoeRadiusFt: 15,
    classes: ["Wizard", "Sorcerer"],
    description: "A 15-foot cone of searing flame flashes from your outstretched fingertips (3d6 fire, DEX save).",
  },
  {
    id: "aganazzars_scorcher",
    name: "Aganazzar's Scorcher",
    level: 2,
    type: "save",
    damageDie: "d8",
    diceCount: 3,
    damageType: "fire",
    saveStat: "dex",
    isAoE: true,
    aoeShape: "line",
    aoeRadiusFt: 30,
    classes: ["Wizard", "Sorcerer"],
    description: "A 30-foot line of roaring flame shoots from you in a direction you choose (3d8 fire, DEX save).",
  },
  {
    id: "dragons_breath",
    name: "Dragon's Breath",
    level: 2,
    type: "save",
    damageDie: "d6",
    diceCount: 3,
    damageType: "fire",
    saveStat: "dex",
    isAoE: true,
    aoeShape: "cone",
    aoeRadiusFt: 15,
    classes: ["Wizard", "Sorcerer"],
    description: "Exhale elemental energy in a 15-foot cone (3d6 fire, DEX save).",
  },
  {
    id: "gust_of_wind",
    name: "Gust of Wind",
    level: 2,
    type: "save",
    damageDie: "d8",
    diceCount: 2,
    damageType: "bludgeoning",
    saveStat: "str",
    isAoE: true,
    aoeShape: "line",
    aoeRadiusFt: 60,
    classes: ["Wizard", "Druid", "Sorcerer"],
    description: "A 60-foot line of strong wind blasts out, buffeting enemies (2d8 bludgeoning, STR save).",
  },
  {
    id: "fireball",
    name: "Fireball",
    level: 3,
    type: "save",
    damageDie: "d6",
    diceCount: 8,
    damageType: "fire",
    saveStat: "dex",
    isAoE: true,
    aoeShape: "sphere",
    aoeRadiusFt: 20,
    rangeFt: 120,
    classes: ["Wizard", "Sorcerer"],
    description: "A bright streak flashes and erupts into a 20ft fiery explosion (8d6 fire, DEX save).",
  },
  {
    id: "lightning_bolt",
    name: "Lightning Bolt",
    level: 3,
    type: "save",
    damageDie: "d6",
    diceCount: 8,
    damageType: "lightning",
    saveStat: "dex",
    isAoE: true,
    aoeShape: "line",
    aoeRadiusFt: 60,
    classes: ["Wizard", "Sorcerer"],
    description: "A stroke of lightning forming a 60-foot line blasts through foes (8d6 lightning, DEX save).",
  },
  {
    id: "fear",
    name: "Fear",
    level: 3,
    type: "save",
    damageDie: "d8",
    diceCount: 4,
    damageType: "psychic",
    saveStat: "wis",
    isAoE: true,
    aoeShape: "cone",
    aoeRadiusFt: 30,
    classes: ["Bard", "Sorcerer", "Warlock", "Wizard"],
    description: "Project a phantasmal image in a 30-foot cone that terrifies creatures (4d8 psychic, WIS save).",
  },
  {
    id: "hunger_of_hadar",
    name: "Hunger of Hadar",
    level: 3,
    type: "save",
    damageDie: "d6",
    diceCount: 4,
    damageType: "cold",
    saveStat: "dex",
    isAoE: true,
    aoeShape: "sphere",
    aoeRadiusFt: 20,
    classes: ["Warlock"],
    description: "Open a gateway to the dark between the stars (4d6 cold/acid damage, DEX save).",
  },
  {
    id: "synaptic_static",
    name: "Synaptic Static",
    level: 5,
    type: "save",
    damageDie: "d6",
    diceCount: 8,
    damageType: "psychic",
    saveStat: "int",
    isAoE: true,
    aoeShape: "sphere",
    aoeRadiusFt: 20,
    classes: ["Wizard", "Warlock", "Bard", "Sorcerer"],
    description: "Unleash a 20ft psychic explosion that scrambles thoughts (8d6 psychic, INT save).",
  },
  {
    id: "cone_of_cold",
    name: "Cone of Cold",
    level: 5,
    type: "save",
    damageDie: "d8",
    diceCount: 8,
    damageType: "cold",
    saveStat: "con",
    isAoE: true,
    aoeShape: "cone",
    aoeRadiusFt: 60,
    classes: ["Wizard", "Sorcerer"],
    description: "A 60-foot cone of freezing air erupts from your hands (8d8 cold, CON save).",
  },
  {
    id: "sunbeam",
    name: "Sunbeam",
    level: 6,
    type: "save",
    damageDie: "d8",
    diceCount: 6,
    damageType: "radiant",
    saveStat: "con",
    isAoE: true,
    aoeShape: "line",
    aoeRadiusFt: 60,
    classes: ["Cleric", "Druid", "Sorcerer", "Wizard"],
    description: "A 60-foot line of brilliant sunlight flashes from your hand (6d8 radiant, CON save).",
  },
  {
    id: "chain_lightning",
    name: "Chain Lightning",
    level: 6,
    type: "save",
    damageDie: "d8",
    diceCount: 10,
    damageType: "lightning",
    saveStat: "dex",
    classes: ["Wizard", "Sorcerer"],
    description: "Arcs of blue lightning bolt toward the target (10d8 lightning, DEX save).",
  },
  {
    id: "disintegrate",
    name: "Disintegrate",
    level: 6,
    type: "save",
    damageDie: "d6",
    diceCount: 10,
    fixedBonus: 40,
    damageType: "force",
    saveStat: "dex",
    classes: ["Wizard", "Sorcerer"],
    description: "A thin green ray springs from your pointing finger (10d6+40 force, DEX save).",
  },
  {
    id: "maddening_darkness",
    name: "Maddening Darkness",
    level: 8,
    type: "save",
    damageDie: "d8",
    diceCount: 8,
    damageType: "psychic",
    saveStat: "wis",
    classes: ["Warlock", "Wizard"],
    description: "Magical darkness filled with horrific shrieks engulfs the target (8d8 psychic, WIS save).",
  },
];

export const DEFAULT_CANTRIPS: DndSpell[] = SPELL_CATALOG.filter((s) => s.level === 0);

export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

export function rollDiceTotal(count: number, sides: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += rollDie(sides);
  }
  return total;
}

export function rollD20(advantage: DndAdvantageState = "none"): { roll1: number; roll2?: number; final: number } {
  const roll1 = rollDie(20);
  if (advantage === "none") {
    return { roll1, final: roll1 };
  }
  const roll2 = rollDie(20);
  const final = advantage === "advantage" ? Math.max(roll1, roll2) : Math.min(roll1, roll2);
  return { roll1, roll2, final };
}

export function parseDieSides(dieStr: string = "d6"): number {
  const match = dieStr.match(/d(\d+)/i);
  return match && match[1] ? parseInt(match[1], 10) : 6;
}

// ── Turn Resolution ──

export function resolveDndAction(state: DndCombatState, action: DndActionRequest): { nextState: DndCombatState; result: DndActionResult } {
  const party = state.party.map((p) => ({ ...p, stats: { ...p.stats } }));
  const enemies = state.enemies.map((e) => ({ ...e, stats: { ...e.stats } }));
  const logEntries = [...state.log];

  const allActors = [...party, ...enemies];
  const actor = allActors.find((c) => c.id === action.actorId);
  if (!actor) {
    throw new Error(`Actor ${action.actorId} not found in combat state.`);
  }

  // 1. Handle Dodge
  if (action.type === "dodge") {
    actor.isDefending = true;
    const logText = `${actor.name} takes the Dodge action, focusing entirely on avoiding incoming attacks.`;
    const result: DndActionResult = {
      type: "dodge",
      actorName: actor.name,
      strikes: [],
      totalDamage: 0,
      totalHealing: 0,
      logText,
      diceSummary: "🛡️ Dodge (Disadvantage on enemy attacks)",
    };
    logEntries.push({
      id: Math.random().toString(36).substring(2, 9),
      round: state.round,
      turnActor: actor.name,
      text: logText,
      diceSummary: result.diceSummary,
    });
    return checkStateOutcome({ ...state, party, enemies, log: logEntries }, result);
  }

  // 2. Handle Heal / Cure Wounds
  if (action.type === "heal" || action.spellId === "cure_wounds") {
    const castingStat = primaryCastingStat(actor.unitClass);
    const mod = abilityModifier(actor.stats[castingStat]);
    const healRoll = rollDiceTotal(2, 8) + Math.max(0, mod);

    // Target ally with lowest HP percentage
    const livingAllies = party.filter((p) => p.hp > 0);
    livingAllies.sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
    const healTarget = livingAllies[0] || actor;

    healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healRoll);
    const logText = `✨ ${actor.name} casts Cure Wounds on ${healTarget.name}, restoring ${healRoll} HP! (${healTarget.hp}/${healTarget.maxHp})`;

    const result: DndActionResult = {
      type: "heal",
      actorName: actor.name,
      targetName: healTarget.name,
      strikes: [],
      totalDamage: 0,
      totalHealing: healRoll,
      targetRemainingHp: healTarget.hp,
      targetMaxHp: healTarget.maxHp,
      logText,
      diceSummary: `✨ 2d8+${mod} = +${healRoll} HP`,
    };
    logEntries.push({
      id: Math.random().toString(36).substring(2, 9),
      round: state.round,
      turnActor: actor.name,
      text: logText,
      diceSummary: result.diceSummary,
    });
    return checkStateOutcome({ ...state, party, enemies, log: logEntries }, result);
  }

  // 3. Handle Flee
  if (action.type === "flee") {
    const logText = `🏃 ${actor.name} signals a retreat! The party disengages and flees from the battle.`;
    const result: DndActionResult = {
      type: "flee",
      actorName: actor.name,
      strikes: [],
      totalDamage: 0,
      totalHealing: 0,
      logText,
      diceSummary: "🏃 Retreat successful",
    };
    logEntries.push({
      id: Math.random().toString(36).substring(2, 9),
      round: state.round,
      turnActor: actor.name,
      text: logText,
      diceSummary: result.diceSummary,
    });
    return {
      nextState: { ...state, party, enemies, log: logEntries, outcome: "fled", phase: "ended" },
      result,
    };
  }

  // 4. Targeted Attack / Spell / Cantrip
  const target = allActors.find((c) => c.id === action.targetId) || (actor.side === "party" ? enemies.find((e) => e.hp > 0) : party.find((p) => p.hp > 0));
  if (!target) {
    throw new Error(`Target not found for action.`);
  }

  const spellId = action.spellId || action.cantripId;
  const spell = SPELL_CATALOG.find((s) => s.id === spellId);
  const isSpell = action.type === "spell" || action.type === "cantrip" || !!spell;

  const strikes: DndSingleStrikeResult[] = [];
  let totalDamage = 0;

  // Determine advantage state
  let adv: DndAdvantageState = action.advantage || "none";
  if (target.isDefending && adv !== "advantage") {
    adv = "disadvantage";
  }

  // ── Auto-Hit Spell (e.g. Magic Missile) ──
  if (spell?.type === "auto") {
    const dartCount = spell.diceCount || 3;
    const dartSides = parseDieSides(spell.damageDie || "d4");
    let missileDamage = 0;
    const dartLogs: string[] = [];

    for (let i = 1; i <= dartCount; i++) {
      const roll = rollDie(dartSides);
      const dmg = roll + 1; // 1d4+1 per dart
      missileDamage += dmg;
      dartLogs.push(`Dart ${i}: 🎲 ${roll}+1 = ${dmg} force`);
    }

    target.hp = Math.max(0, target.hp - missileDamage);
    totalDamage = missileDamage;

    const fullLog = `✨ ${actor.name} casts ${spell.name} at ${target.name}! ${dartLogs.join(" | ")} → Total ${missileDamage} force damage!`;
    const isDefeated = target.hp <= 0;

    const result: DndActionResult = {
      type: "spell",
      actorName: actor.name,
      targetName: target.name,
      strikes: [],
      totalDamage: missileDamage,
      totalHealing: 0,
      targetRemainingHp: target.hp,
      targetMaxHp: target.maxHp,
      isTargetDefeated: isDefeated && target.side === "enemy",
      isTargetDowned: isDefeated && target.side === "party",
      logText: fullLog,
      diceSummary: dartLogs.join(" | "),
    };

    logEntries.push({
      id: Math.random().toString(36).substring(2, 9),
      round: state.round,
      turnActor: actor.name,
      text: fullLog,
      diceSummary: result.diceSummary,
      isDowned: isDefeated,
    });

    return checkStateOutcome({ ...state, party, enemies, log: logEntries }, result);
  }

  // ── Saving Throw Spell (e.g. Fireball, Sacred Flame, Toll the Dead, Synaptic Static) ──
  if (spell?.type === "save") {
    const casterStat = spell.castingStat || primaryCastingStat(actor.unitClass);
    const casterMod = abilityModifier(actor.stats[casterStat]);
    const prof = proficiencyBonus(actor.level);
    const dc = 8 + prof + casterMod;

    const saveStatName = spell.saveStat || "dex";
    const targetSaveMod = abilityModifier(target.stats[saveStatName]);
    const targetD20 = rollD20("none");
    const saveTotal = targetD20.final + targetSaveMod;
    const isSaved = saveTotal >= dc;

    // Dice calculation
    const count = spell.isCantrip ? cantripScaling(actor.level) : (spell.diceCount || 8);
    const sides = parseDieSides(spell.damageDie || "d6");
    const rolledDmg = rollDiceTotal(count, sides) + (spell.fixedBonus || 0);

    // Cantrips usually deal 0 on save, leveled spells usually half
    const actualDamage = isSaved ? (spell.isCantrip ? 0 : Math.floor(rolledDmg / 2)) : rolledDmg;
    target.hp = Math.max(0, target.hp - actualDamage);
    totalDamage = actualDamage;

    const saveOutcomeText = isSaved
      ? spell.isCantrip
        ? `SAVED! (No damage)`
        : `SAVED! (Half damage: ${actualDamage})`
      : `FAILED SAVE! (${actualDamage} ${spell.damageType || "magical"} dmg)`;

    const fullLog = `🔥 ${actor.name} casts ${spell.name} on ${target.name}. ${target.name} rolled ${saveStatName.toUpperCase()} save 🎲 ${targetD20.final}${formatModifier(targetSaveMod)} = ${saveTotal} vs DC ${dc} → ${saveOutcomeText}`;
    const isDefeated = target.hp <= 0;

    const result: DndActionResult = {
      type: "spell",
      actorName: actor.name,
      targetName: target.name,
      strikes: [],
      saveResult: {
        saveD20: targetD20.final,
        saveMod: targetSaveMod,
        saveTotal,
        dc,
        saved: isSaved,
      },
      totalDamage: actualDamage,
      totalHealing: 0,
      targetRemainingHp: target.hp,
      targetMaxHp: target.maxHp,
      isTargetDefeated: isDefeated && target.side === "enemy",
      isTargetDowned: isDefeated && target.side === "party",
      logText: fullLog,
      diceSummary: `DC ${dc} ${saveStatName.toUpperCase()} Save vs 🎲 ${saveTotal} → ${actualDamage} dmg`,
    };

    logEntries.push({
      id: Math.random().toString(36).substring(2, 9),
      round: state.round,
      turnActor: actor.name,
      text: fullLog,
      diceSummary: result.diceSummary,
      isDowned: isDefeated,
    });

    return checkStateOutcome({ ...state, party, enemies, log: logEntries }, result);
  }

  // ── Attack Roll (Martial Weapon, Eldritch Blast, Fire Bolt, Guiding Bolt) ──
  const isEldritchBlast = spell?.id === "eldritch_blast";
  const numStrikes = isEldritchBlast
    ? cantripScaling(actor.level)
    : isSpell
      ? 1
      : martialAttackCount(actor.unitClass, actor.level);

  for (let beam = 1; beam <= numStrikes; beam++) {
    const d20 = rollD20(adv);
    const prof = proficiencyBonus(actor.level);

    let statKey: DndAbilityName;
    let statMod: number;
    let damageSides: number;
    let numDice: number;
    let damageType: string;

    if (isSpell) {
      statKey = spell?.castingStat || primaryCastingStat(actor.unitClass);
      statMod = abilityModifier(actor.stats[statKey]);
      damageSides = parseDieSides(spell?.damageDie || "d10");
      numDice = isEldritchBlast ? 1 : (spell?.diceCount || (spell?.isCantrip ? cantripScaling(actor.level) : 1));
      damageType = spell?.damageType || "force";
    } else {
      statKey = primaryAttackStat(actor.unitClass, actor.stats);
      statMod = abilityModifier(actor.stats[statKey]);
      damageSides = /rogue|monk|archer/i.test(actor.unitClass) ? 6 : 8; // d6 finesse/dagger or d8 longsword
      numDice = 1;
      damageType = "slashing";
    }

    const toHitTotal = d20.final + prof + statMod;
    const isCrit = d20.final === 20;
    const isCritMiss = d20.final === 1;
    const isHit = !isCritMiss && (isCrit || toHitTotal >= target.ac);

    let dmgDealt = 0;
    let sneakDamage = 0;
    let smiteDamage = 0;
    let diceRollSum = 0;

    if (isHit) {
      const diceToRoll = isCrit ? numDice * 2 : numDice;
      diceRollSum = rollDiceTotal(diceToRoll, damageSides);

      // Agonizing blast applies CHA mod to each beam; weapon attacks apply STR/DEX mod
      const dmgBonus = isEldritchBlast ? Math.max(0, statMod) : isSpell && !spell?.isCantrip ? 0 : Math.max(0, statMod);
      dmgDealt = diceRollSum + dmgBonus;

      // Rogue Sneak Attack (once per turn on first hit)
      if (action.useSneakAttack && beam === 1) {
        const sneakCount = rogueSneakAttackDice(actor.level);
        const sneakDiceToRoll = isCrit ? sneakCount * 2 : sneakCount;
        sneakDamage = rollDiceTotal(sneakDiceToRoll, 6);
        dmgDealt += sneakDamage;
      }

      // Paladin Divine Smite
      if (action.useDivineSmite && beam === 1) {
        const smiteCount = Math.min(5, 2 + Math.floor(actor.level / 4));
        const smiteDiceToRoll = isCrit ? smiteCount * 2 : smiteCount;
        smiteDamage = rollDiceTotal(smiteDiceToRoll, 8);
        dmgDealt += smiteDamage;
      }

      dmgDealt = Math.max(1, dmgDealt);
      target.hp = Math.max(0, target.hp - dmgDealt);
      totalDamage += dmgDealt;
    }

    strikes.push({
      beamIndex: numStrikes > 1 ? beam : undefined,
      d20Roll1: d20.roll1,
      d20Roll2: d20.roll2,
      finalD20: d20.final,
      modifier: statMod,
      profBonus: prof,
      toHitTotal,
      targetAc: target.ac,
      isHit,
      isCrit,
      isCritMiss,
      damageDiceRoll: diceRollSum,
      damageMod: isEldritchBlast || !isSpell ? Math.max(0, statMod) : 0,
      damageDealt: dmgDealt,
      sneakDamage: sneakDamage || undefined,
      smiteDamage: smiteDamage || undefined,
      damageType,
    });
  }

  // Build log summary
  const strikeLogs = strikes.map((s) => {
    const advTag = adv !== "none" ? ` [${adv.toUpperCase()}: ${s.d20Roll1},${s.d20Roll2}]` : "";
    const prefix = s.beamIndex ? `Strike/Beam ${s.beamIndex}: ` : "";
    if (s.isCrit) {
      return `${prefix}🎲 NAT 20 CRIT! (${s.finalD20}${formatModifier(s.modifier + s.profBonus)}${advTag} = ${s.toHitTotal} vs AC ${s.targetAc}) → ${s.damageDealt} dmg!`;
    }
    if (s.isCritMiss) {
      return `${prefix}🎲 NAT 1 MISS!${advTag}`;
    }
    if (s.isHit) {
      const extraText = (s.sneakDamage ? ` (+${s.sneakDamage} Sneak)` : "") + (s.smiteDamage ? ` (+${s.smiteDamage} Smite)` : "");
      return `${prefix}🎲 Roll ${s.finalD20}${formatModifier(s.modifier + s.profBonus)}${advTag} = ${s.toHitTotal} vs AC ${s.targetAc} (HIT!) → ${s.damageDealt}${extraText} dmg`;
    }
    return `${prefix}🎲 Roll ${s.finalD20}${formatModifier(s.modifier + s.profBonus)}${advTag} = ${s.toHitTotal} vs AC ${s.targetAc} (MISS)`;
  });

  const attackLabel = isSpell ? `casts ${spell?.name || "Spell"}` : `attacks`;
  const fullLog = `${actor.name} ${attackLabel} on ${target.name}. ${strikeLogs.join(" | ")}`;
  const isDefeated = target.hp <= 0;

  const result: DndActionResult = {
    type: action.type,
    actorName: actor.name,
    targetName: target.name,
    strikes,
    totalDamage,
    totalHealing: 0,
    targetRemainingHp: target.hp,
    targetMaxHp: target.maxHp,
    isTargetDefeated: isDefeated && target.side === "enemy",
    isTargetDowned: isDefeated && target.side === "party",
    logText: fullLog,
    diceSummary: strikeLogs.join(" | "),
  };

  logEntries.push({
    id: Math.random().toString(36).substring(2, 9),
    round: state.round,
    turnActor: actor.name,
    text: fullLog,
    diceSummary: result.diceSummary,
    isCrit: strikes.some((s) => s.isCrit),
    isDowned: isDefeated,
  });

  return checkStateOutcome({ ...state, party, enemies, log: logEntries }, result);
}

// ── Ally AI Turns (Non-player party members attack thematic to class) ──

export function resolveAllyTurns(state: DndCombatState): { nextState: DndCombatState; results: DndActionResult[] } {
  let currentState = { ...state };
  const results: DndActionResult[] = [];

  // Allies are all living party members EXCEPT the primary player (party[0])
  const livingAllies = currentState.party.slice(1).filter((p) => p.hp > 0);

  for (const ally of livingAllies) {
    const livingEnemies = currentState.enemies.filter((e) => e.hp > 0);
    if (livingEnemies.length === 0) break;

    // Ally picks enemy target (prefers lowest HP enemy)
    const sortedEnemies = [...livingEnemies].sort((a, b) => a.hp - b.hp);
    const target = sortedEnemies[0];
    if (!target) continue;

    const cls = ally.unitClass.toLowerCase();

    // Check if ally is a Cleric and should heal an injured friend
    if (/cleric|druid/i.test(cls)) {
      const injuredParty = currentState.party.filter((p) => p.hp > 0 && p.hp / p.maxHp < 0.5);
      if (injuredParty.length > 0) {
        const { nextState, result } = resolveDndAction(currentState, {
          type: "heal",
          actorId: ally.id,
          spellId: "cure_wounds",
        });
        currentState = nextState;
        results.push(result);
        continue;
      }
    }

    // Determine thematic action based on class & level
    let actionReq: DndActionRequest;

    if (/wizard/i.test(cls)) {
      // Wizard: Fireball if high level, else Synaptic Static, Magic Missile, or Fire Bolt
      const spellChoice = ally.level >= 9 ? "synaptic_static" : ally.level >= 5 ? "fireball" : "magic_missile";
      actionReq = {
        type: "spell",
        actorId: ally.id,
        targetId: target.id,
        spellId: spellChoice,
      };
    } else if (/warlock/i.test(cls)) {
      // Warlock: Eldritch Blast barrage or Synaptic Static
      const spellChoice = ally.level >= 9 && Math.random() > 0.5 ? "synaptic_static" : "eldritch_blast";
      actionReq = {
        type: "cantrip",
        actorId: ally.id,
        targetId: target.id,
        cantripId: spellChoice,
      };
    } else if (/rogue|soulknife/i.test(cls)) {
      // Rogue: Sneak Attack!
      actionReq = {
        type: "attack",
        actorId: ally.id,
        targetId: target.id,
        useSneakAttack: true,
        advantage: "advantage", // Rogues find stealth/flank advantage
      };
    } else if (/paladin/i.test(cls)) {
      // Paladin: Attack with Divine Smite
      actionReq = {
        type: "attack",
        actorId: ally.id,
        targetId: target.id,
        useDivineSmite: true,
      };
    } else if (/cleric/i.test(cls)) {
      // Cleric: Guiding Bolt or Sacred Flame
      actionReq = {
        type: "spell",
        actorId: ally.id,
        targetId: target.id,
        spellId: ally.level >= 3 ? "guiding_bolt" : "sacred_flame",
      };
    } else {
      // Martial (Fighter, Barbarian, Monk, Ranger): Weapon Attacks with Extra Attack
      actionReq = {
        type: "attack",
        actorId: ally.id,
        targetId: target.id,
      };
    }

    const { nextState, result } = resolveDndAction(currentState, actionReq);
    currentState = nextState;
    results.push(result);
  }

  return { nextState: currentState, results };
}

// ── Enemy AI Turns ──

export function resolveEnemyTurns(state: DndCombatState): { nextState: DndCombatState; results: DndActionResult[] } {
  let currentState = { ...state };
  const results: DndActionResult[] = [];

  const livingEnemies = currentState.enemies.filter((e) => e.hp > 0);
  const livingParty = currentState.party.filter((p) => p.hp > 0);

  if (livingEnemies.length === 0 || livingParty.length === 0) {
    return { nextState: currentState, results };
  }

  for (const enemy of livingEnemies) {
    const targets = currentState.party.filter((p) => p.hp > 0);
    if (targets.length === 0) break;

    // Pick random living party member
    const target = targets[Math.floor(Math.random() * targets.length)];
    if (!target) continue;

    const { nextState, result } = resolveDndAction(currentState, {
      type: "attack",
      actorId: enemy.id,
      targetId: target.id,
      advantage: "none",
    });

    currentState = nextState;
    results.push(result);
  }

  // Advance round counter after all enemies attack
  currentState.round += 1;
  // Clear dodge states
  currentState.party.forEach((p) => (p.isDefending = false));
  currentState.enemies.forEach((e) => (e.isDefending = false));

  return { nextState: currentState, results };
}

// ── Full Turn Flow (Player -> Allies -> Enemies) ──

export function resolveFullCombatRound(
  state: DndCombatState,
  playerAction: DndActionRequest,
): { nextState: DndCombatState; playerResult: DndActionResult } {
  // 1. Resolve player's turn
  const { nextState: afterPlayerState, result: playerResult } = resolveDndAction(state, playerAction);

  // If combat ended from player action (e.g. victory or flee), return immediately
  if (afterPlayerState.outcome) {
    return { nextState: afterPlayerState, playerResult };
  }

  // 2. Resolve living ally turns
  const { nextState: afterAlliesState } = resolveAllyTurns(afterPlayerState);

  // If allies wiped out the remaining enemies, return victory!
  if (afterAlliesState.outcome) {
    return { nextState: afterAlliesState, playerResult };
  }

  // 3. Resolve living enemy turns
  const { nextState: afterEnemiesState } = resolveEnemyTurns(afterAlliesState);

  return { nextState: afterEnemiesState, playerResult };
}

function checkStateOutcome(
  state: DndCombatState,
  actionResult: DndActionResult,
): { nextState: DndCombatState; result: DndActionResult } {
  const livingParty = state.party.filter((p) => p.hp > 0);
  const livingEnemies = state.enemies.filter((e) => e.hp > 0);

  let outcome: DndCombatState["outcome"] = state.outcome;
  let phase: DndCombatState["phase"] = state.phase;

  if (livingEnemies.length === 0 && livingParty.length > 0) {
    outcome = "victory";
    phase = "ended";
  } else if (livingParty.length === 0) {
    outcome = "defeat";
    phase = "ended";
  }

  return {
    nextState: {
      ...state,
      outcome,
      phase,
    },
    result: actionResult,
  };
}
