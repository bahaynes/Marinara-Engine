// ──────────────────────────────────────────────
// D&D 5.5e Tactical Battlemap Grid Math & Logic
// ──────────────────────────────────────────────

import type { DndCombatant, DndSpell } from "../dnd-combat/types.js";
import {
  abilityModifier,
  proficiencyBonus,
  primaryCastingStat,
  cantripScaling,
} from "../dnd-combat/math.js";
import { AoETemplateFactory } from "./templates.js";
import type {
  DndGridCoord,
  DndTile,
  DndTacticalMap,
  DndAoEShape,
  DndAoEResolution,
  DndAoEIndividualResult,
  DndOpportunityAttackResult,
  DndTacticalState,
  DndTacticalUnitState,
  DndTerrainType,
} from "./types.js";

/** Default D&D battlemap grid dimensions (12 tiles wide x 8 tiles high = 60ft x 40ft arena) */
export const DEFAULT_MAP_WIDTH = 12;
export const DEFAULT_MAP_HEIGHT = 8;

/** Convert grid distance to D&D 5.5e feet (5ft per square) */
export function getDistanceFt(c1: DndGridCoord, c2: DndGridCoord): number {
  return Math.max(Math.abs(c1.x - c2.x), Math.abs(c1.y - c2.y)) * 5;
}

/** Generate a tactical battlemap with themed terrain, cover, and elevations */
export function generateDndBattlemap(
  width: number = DEFAULT_MAP_WIDTH,
  height: number = DEFAULT_MAP_HEIGHT,
  theme: "forest" | "dungeon" | "ruins" | "cavern" | "mountain" | "default" = "default",
): DndTacticalMap {
  const tiles: DndTile[][] = [];

  for (let y = 0; y < height; y++) {
    const row: DndTile[] = [];
    for (let x = 0; x < width; x++) {
      let terrain: DndTerrainType = "plains";
      let coverLevel: DndTile["coverLevel"] = "none";
      let moveCost = 1;
      let elevation = 0;
      let hazardDamage: number | undefined;
      let hazardType: string | undefined;

      // Seed procedural tactical elements away from starting spawn zones (cols 0-2 & cols width-3..width-1)
      const isSpawnZone = x <= 2 || x >= width - 3;

      if (!isSpawnZone) {
        // Pillars / Cover stones
        if ((x === 4 && y === 2) || (x === 7 && y === 5) || (x === 5 && y === 5) || (x === 6 && y === 2)) {
          terrain = "ruin";
          coverLevel = "half";
          moveCost = 1.5;
        }
        // Dense forest / difficult terrain
        else if (theme === "forest" && ((x === 4 && y === 4) || (x === 6 && y === 3) || (x === 7 && y === 4))) {
          terrain = "forest";
          coverLevel = "half";
          moveCost = 2;
        }
        // Cavern chasm / water hazard
        else if (
          (theme === "cavern" || theme === "dungeon") &&
          ((x === 5 && y === 3) || (x === 6 && y === 4))
        ) {
          terrain = "water";
          moveCost = 2;
          hazardDamage = 4;
          hazardType = "acid";
        }
        // Elevated vantage point
        else if ((x === 5 && y === 1) || (x === 6 && y === 6)) {
          terrain = "mountain";
          elevation = 1;
          moveCost = 1.5;
        }
      }

      row.push({
        x,
        y,
        terrain,
        coverLevel,
        moveCost,
        elevation,
        hazardDamage,
        hazardType,
      });
    }
    tiles.push(row);
  }

  return {
    width,
    height,
    tiles,
    name: `${theme.charAt(0).toUpperCase() + theme.slice(1)} Arena`,
    theme,
  };
}

/** Initialize tactical positioning for party and enemies */
export function initializeTacticalState(
  party: DndCombatant[],
  enemies: DndCombatant[],
  theme?: "forest" | "dungeon" | "ruins" | "cavern" | "mountain" | "default",
): DndTacticalState {
  const map = generateDndBattlemap(DEFAULT_MAP_WIDTH, DEFAULT_MAP_HEIGHT, theme);
  const units: Record<string, DndTacticalUnitState> = {};

  // Place Party on the left side (x: 1..2)
  party.forEach((member, i) => {
    const col = i % 2 === 0 ? 1 : 2;
    const row = Math.min(map.height - 1, 1 + Math.floor(i * 1.8));
    const speedFt = /wizard|sorcerer/i.test(member.unitClass) && member.level >= 10 ? 40 : 30;

    units[member.id] = {
      coord: { x: col, y: row },
      movementRemainingFt: speedFt,
      actionsRemaining: 1,
      bonusActionsRemaining: 1,
      reactionAvailable: true,
      hasDisengaged: false,
      hasDodged: false,
    };
  });

  // Place Enemies on the right side (x: width-3..width-2)
  enemies.forEach((enemy, i) => {
    const col = i % 2 === 0 ? map.width - 2 : map.width - 3;
    const row = Math.min(map.height - 1, 1 + Math.floor(i * 1.8));

    units[enemy.id] = {
      coord: { x: col, y: row },
      movementRemainingFt: 30,
      actionsRemaining: 1,
      bonusActionsRemaining: 1,
      reactionAvailable: true,
      hasDisengaged: false,
      hasDodged: false,
    };
  });

  return {
    map,
    units,
    selectedUnitId: party[0]?.id || null,
    activeTargetCoord: null,
    targetingSpellId: null,
  };
}

/** Get all tiles reachable by a unit based on its movement budget and terrain costs */
export function getReachableTiles(
  start: DndGridCoord,
  movementFt: number,
  map: DndTacticalMap,
  unitStates: Record<string, DndTacticalUnitState>,
  activeUnitId?: string,
): DndGridCoord[] {
  const maxTiles = Math.floor(movementFt / 5);
  if (maxTiles <= 0) return [];

  const reachable: DndGridCoord[] = [];
  const occupiedCoords = new Set<string>();

  // Mark all other living units as impassable
  for (const [id, unitState] of Object.entries(unitStates)) {
    if (id !== activeUnitId) {
      occupiedCoords.add(`${unitState.coord.x},${unitState.coord.y}`);
    }
  }

  // Dijkstra / BFS search
  const distMap: Record<string, number> = {};
  const queue: Array<{ coord: DndGridCoord; cost: number }> = [{ coord: start, cost: 0 }];
  distMap[`${start.x},${start.y}`] = 0;

  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const { coord, cost } = queue.shift()!;

    // 8-directional movement (orthogonal + diagonal)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const nx = coord.x + dx;
        const ny = coord.y + dy;

        if (nx < 0 || nx >= map.width || ny < 0 || ny >= map.height) continue;

        const tile = map.tiles[ny]?.[nx];
        if (!tile || tile.terrain === "wall") continue;

        const key = `${nx},${ny}`;
        if (occupiedCoords.has(key)) continue;

        const stepCost = (tile.moveCost || 1) * 5;
        const nextCost = cost + stepCost;

        if (nextCost <= movementFt) {
          if (distMap[key] === undefined || nextCost < distMap[key]) {
            distMap[key] = nextCost;
            queue.push({ coord: { x: nx, y: ny }, cost: nextCost });
            if (!reachable.some((r) => r.x === nx && r.y === ny)) {
              reachable.push({ x: nx, y: ny });
            }
          }
        }
      }
    }
  }

  return reachable;
}

/** Calculate all grid coordinates covered by an AoE template using the polymorphic Strategy Pattern */
export function getAoEAffectedTiles(
  center: DndGridCoord,
  shape: DndAoEShape,
  radiusFt: number,
  map: DndTacticalMap,
  casterCoord?: DndGridCoord,
): DndGridCoord[] {
  const template = AoETemplateFactory.create(shape, radiusFt);
  return template.getAffectedTiles(center, map, casterCoord);
}

/** Check if moving from `from` to `to` provokes an Opportunity Attack from adjacent enemies */
export function checkOpportunityAttack(
  unitId: string,
  from: DndGridCoord,
  to: DndGridCoord,
  enemies: DndCombatant[],
  unitStates: Record<string, DndTacticalUnitState>,
): DndOpportunityAttackResult | null {
  const moverState = unitStates[unitId];
  if (!moverState || moverState.hasDisengaged) return null;

  // Find all living enemies adjacent to `from` tile (distance <= 5ft)
  for (const enemy of enemies) {
    if (enemy.hp <= 0) continue;
    const enemyState = unitStates[enemy.id];
    if (!enemyState || !enemyState.reactionAvailable) continue;

    const wasAdjacent = getDistanceFt(from, enemyState.coord) <= 5;
    const isStillAdjacent = getDistanceFt(to, enemyState.coord) <= 5;

    // Moving away from 5ft melee reach
    if (wasAdjacent && !isStillAdjacent) {
      // Enemy consumes reaction to strike
      const d20 = Math.floor(Math.random() * 20) + 1;
      const enemyMod = abilityModifier(enemy.stats.str || 12);
      const enemyProf = proficiencyBonus(enemy.level);
      const toHit = d20 + enemyMod + enemyProf;
      const targetUnit = enemies.find((u) => u.id === unitId) || ({ ac: 15 } as DndCombatant);
      const isHit = d20 === 20 || (d20 !== 1 && toHit >= targetUnit.ac);
      const damage = isHit ? Math.floor(Math.random() * 8) + 1 + enemyMod : 0;

      return {
        provoked: true,
        enemyId: enemy.id,
        enemyName: enemy.name,
        d20Roll: d20,
        toHitTotal: toHit,
        targetAc: targetUnit.ac,
        isHit,
        damageDealt: damage,
        logText: isHit
          ? `⚔️ Opportunity Attack! ${enemy.name} strikes as you move away for ${damage} damage (Roll: ${d20} + ${enemyMod + enemyProf} = ${toHit} vs AC ${targetUnit.ac}).`
          : `🛡️ Opportunity Attack missed! ${enemy.name} swings as you retreat (Roll: ${d20} vs AC ${targetUnit.ac}).`,
      };
    }
  }

  return null;
}

/** Resolve multi-target AoE spell damage with individual saving throws vs Spell DC */
export function resolveDndAoESpell(
  caster: DndCombatant,
  spell: DndSpell,
  center: DndGridCoord,
  affectedCoords: DndGridCoord[],
  allCombatants: DndCombatant[],
  unitStates: Record<string, DndTacticalUnitState>,
): DndAoEResolution {
  const casterLevel = caster.level || 1;
  const prof = proficiencyBonus(casterLevel);
  const castingStat = spell.castingStat || primaryCastingStat(caster.unitClass);
  const castMod = abilityModifier(caster.stats[castingStat] || 10);
  const spellDc = 8 + prof + castMod;

  // Base spell damage calculation
  const diceCount = spell.diceCount || (spell.level === 0 ? cantripScaling(casterLevel) : 8);
  const dieSize = parseInt((spell.damageDie || "d6").replace("d", ""), 10) || 6;

  let totalRawDamage = 0;
  for (let i = 0; i < diceCount; i++) {
    totalRawDamage += Math.floor(Math.random() * dieSize) + 1;
  }
  totalRawDamage += spell.fixedBonus || 0;

  const targetResults: DndAoEIndividualResult[] = [];
  let combinedDamage = 0;

  // Check which combatants are positioned inside affected tiles
  for (const combatant of allCombatants) {
    if (combatant.hp <= 0) continue;
    const uState = unitStates[combatant.id];
    if (!uState) continue;

    const isCaught = affectedCoords.some((c) => c.x === uState.coord.x && c.y === uState.coord.y);
    if (!isCaught) continue;

    // Roll saving throw
    const saveStatKey = spell.saveStat || "dex";
    const saveMod = abilityModifier(combatant.stats[saveStatKey] || 10);
    const saveD20 = Math.floor(Math.random() * 20) + 1;
    const saveTotal = saveD20 + saveMod;
    const saved = saveD20 === 20 || (saveD20 !== 1 && saveTotal >= spellDc);

    // D&D 5.5e: Half damage on save, full damage on fail
    const appliedDamage = saved ? Math.floor(totalRawDamage / 2) : totalRawDamage;
    const hpRemaining = Math.max(0, combatant.hp - appliedDamage);
    const isDowned = hpRemaining === 0;

    combinedDamage += appliedDamage;

    targetResults.push({
      combatantId: combatant.id,
      combatantName: combatant.name,
      side: combatant.side,
      saveD20,
      saveMod,
      saveTotal,
      dc: spellDc,
      saved,
      damageDealt: appliedDamage,
      hpRemaining,
      maxHp: combatant.maxHp,
      isDowned,
    });
  }

  const logLines = targetResults.map((r) => {
    return `${r.combatantName}: ${r.saved ? `Saved (${r.saveD20}+${r.saveMod}=${r.saveTotal} vs DC ${r.dc})` : `Failed (${r.saveD20}+${r.saveMod}=${r.saveTotal})`} ➔ ${r.damageDealt} ${spell.damageType || "fire"} damage${r.isDowned ? " 💀 [DOWNED]" : ` (${r.hpRemaining}/${r.maxHp} HP)`}`;
  });

  const logText = `💥 ${caster.name} casts ${spell.name} (DC ${spellDc} ${spell.saveStat?.toUpperCase() || "DEX"} Save, Base: ${totalRawDamage} dmg) hitting ${targetResults.length} target(s):\n${logLines.join("\n")}`;

  return {
    spellId: spell.id,
    spellName: spell.name,
    casterName: caster.name,
    center,
    affectedCoords,
    targets: targetResults,
    totalDamage: combinedDamage,
    logText,
  };
}
