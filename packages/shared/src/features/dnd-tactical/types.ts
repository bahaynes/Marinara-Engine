// ──────────────────────────────────────────────
// D&D 5.5e Tactical Battlemap Grid Types
// ──────────────────────────────────────────────

import type { DndSpell } from "../dnd-combat/types.js";

export interface DndGridCoord {
  x: number;
  y: number;
}

export type DndTerrainType = "plains" | "forest" | "mountain" | "ruin" | "water" | "wall" | "hazard";

export type DndCoverLevel = "none" | "half" | "three-quarters" | "full";

export interface DndTile {
  x: number;
  y: number;
  terrain: DndTerrainType;
  coverLevel: DndCoverLevel;
  moveCost: number; // 1 = normal, 2 = difficult terrain, Infinity = impassable wall
  hazardDamage?: number;
  hazardType?: string; // "fire", "acid", "spikes"
  elevation?: number; // 0 = ground level, 1 = raised ledge (+2 to-hit ranged advantage)
}

export interface DndTacticalMap {
  width: number;
  height: number;
  tiles: DndTile[][];
  name: string;
  theme: "forest" | "dungeon" | "ruins" | "cavern" | "mountain" | "default";
}

export type DndAoEShape = "sphere" | "cone" | "line" | "single";

export interface DndAoETargetRequest {
  center: DndGridCoord;
  spell: DndSpell;
  casterCoord?: DndGridCoord;
}

export interface DndAoEIndividualResult {
  combatantId: string;
  combatantName: string;
  side: "party" | "enemy";
  saveD20: number;
  saveMod: number;
  saveTotal: number;
  dc: number;
  saved: boolean;
  damageDealt: number;
  hpRemaining: number;
  maxHp: number;
  isDowned: boolean;
}

export interface DndAoEResolution {
  spellId: string;
  spellName: string;
  casterName: string;
  center: DndGridCoord;
  affectedCoords: DndGridCoord[];
  targets: DndAoEIndividualResult[];
  totalDamage: number;
  logText: string;
}

export interface DndOpportunityAttackResult {
  provoked: boolean;
  enemyId: string;
  enemyName: string;
  d20Roll: number;
  toHitTotal: number;
  targetAc: number;
  isHit: boolean;
  damageDealt: number;
  logText: string;
}

export interface DndTacticalUnitState {
  coord: DndGridCoord;
  movementRemainingFt: number;
  actionsRemaining: number;
  bonusActionsRemaining: number;
  reactionAvailable: boolean;
  hasDisengaged: boolean;
  hasDodged: boolean;
}

export interface DndTacticalState {
  map: DndTacticalMap;
  units: Record<string, DndTacticalUnitState>;
  selectedUnitId: string | null;
  activeTargetCoord: DndGridCoord | null;
  targetingSpellId: string | null;
}
