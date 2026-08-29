// ──────────────────────────────────────────────
// D&D 5.5e Combat Types
// ──────────────────────────────────────────────

export type DndAbilityName = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface DndStats {
  str: number;
  dex: number;
  con: number;
  int: number;
  wis: number;
  cha: number;
}

export interface DndSpell {
  id: string;
  name: string;
  level: number; // 0 = cantrip, 1-9 = leveled spell
  type: "attack" | "save" | "heal" | "auto" | "buff";
  damageDie?: string; // e.g. "d10", "d8", "d6", "d4", "d12"
  diceCount?: number; // base dice count, e.g. 8 for Fireball
  fixedBonus?: number; // e.g. 40 for Disintegrate
  damageType?: string; // e.g. "force", "fire", "cold", "radiant", "necrotic", "lightning", "psychic"
  castingStat?: DndAbilityName; // overrides default class stat
  saveStat?: DndAbilityName; // e.g. "dex", "wis", "con", "int"
  description: string;
  isMultiBeam?: boolean; // Eldritch blast multi-beam
  isCantrip?: boolean;
  isAoE?: boolean;
  aoeShape?: "sphere" | "cone" | "line" | "single";
  aoeRadiusFt?: number; // e.g. 20 for Fireball
  rangeFt?: number; // e.g. 120, 60, 5
  classes?: string[]; // Recommended classes e.g. ["Wizard", "Sorcerer"]
}

// Backward compatibility alias
export type DndCantrip = DndSpell;

export interface DndCombatant {
  id: string;
  name: string;
  side: "party" | "enemy";
  isPlayer?: boolean;
  avatarUrl?: string | null;
  level: number;
  unitClass: string;
  hp: number;
  maxHp: number;
  ac: number;
  stats: DndStats;
  cantrips?: DndSpell[];
  statusEffects: Array<{ name: string; turnsLeft: number; effect: string }>;
  isDefending?: boolean;
  isFleeing?: boolean;
}

export type DndAdvantageState = "none" | "advantage" | "disadvantage";

export interface DndActionRequest {
  type: "attack" | "cantrip" | "spell" | "dodge" | "dash" | "heal" | "flee";
  actorId: string;
  targetId?: string;
  cantripId?: string;
  spellId?: string;
  advantage?: DndAdvantageState;
  useSneakAttack?: boolean;
  useDivineSmite?: boolean;
}

export interface DndSingleStrikeResult {
  beamIndex?: number;
  d20Roll1: number;
  d20Roll2?: number;
  finalD20: number;
  modifier: number;
  profBonus: number;
  toHitTotal: number;
  targetAc: number;
  isHit: boolean;
  isCrit: boolean;
  isCritMiss: boolean;
  damageDiceRoll: number;
  damageMod: number;
  damageDealt: number;
  sneakDiceRoll?: number;
  sneakDamage?: number;
  smiteDamage?: number;
  damageType?: string;
}

export interface DndActionResult {
  type: DndActionRequest["type"];
  actorName: string;
  targetName?: string;
  strikes: DndSingleStrikeResult[];
  saveResult?: {
    saveD20: number;
    saveMod: number;
    saveTotal: number;
    dc: number;
    saved: boolean;
  };
  totalDamage: number;
  totalHealing: number;
  targetRemainingHp?: number;
  targetMaxHp?: number;
  isTargetDefeated?: boolean;
  isTargetDowned?: boolean;
  logText: string;
  diceSummary: string;
}

export interface DndCombatLogEntry {
  id: string;
  round: number;
  turnActor: string;
  text: string;
  diceSummary?: string;
  isCrit?: boolean;
  isDowned?: boolean;
}

export interface DndCombatState {
  round: number;
  party: DndCombatant[];
  enemies: DndCombatant[];
  log: DndCombatLogEntry[];
  outcome: "victory" | "defeat" | "fled" | null;
  phase: "player" | "enemy" | "ended";
  activePartyIndex: number;
}
