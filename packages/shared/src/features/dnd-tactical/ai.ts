// ──────────────────────────────────────────────
// D&D 5.5e Tactical Grid AI & Pathfinding Engine
// ──────────────────────────────────────────────

import type {
  DndCombatant,
  DndCombatState,
  DndActionRequest,
  DndSpell,
} from "../dnd-combat/types.js";
import {
  abilityModifier,
  proficiencyBonus,
  primaryCastingStat,
  primaryAttackStat,
  cantripScaling,
  martialAttackCount,
  SPELL_CATALOG,
} from "../dnd-combat/math.js";
import type {
  DndGridCoord,
  DndTacticalMap,
  DndTacticalState,
  DndTacticalUnitState,
} from "./types.js";
import {
  getDistanceFt,
  getReachableTiles,
  getAoEAffectedTiles,
  resolveDndAoESpell,
  checkOpportunityAttack,
} from "./grid.js";

export interface TacticalStepLog {
  actorId: string;
  actorName: string;
  side: "party" | "enemy";
  actionType: "move" | "attack" | "spell" | "aoe" | "heal" | "dodge";
  text: string;
  moveFrom?: DndGridCoord;
  moveTo?: DndGridCoord;
  targetCoord?: DndGridCoord;
}

export interface TacticalRoundResult {
  nextDndState: DndCombatState;
  nextTacticalState: DndTacticalState;
  stepLogs: TacticalStepLog[];
}

/** Score and find the optimal reachable tile for a unit based on its combat role */
export function findBestTacticalMoveTile(
  _actor: DndCombatant,
  actorState: DndTacticalUnitState,
  _target: DndCombatant,
  targetState: DndTacticalUnitState,
  map: DndTacticalMap,
  unitStates: Record<string, DndTacticalUnitState>,
  preferredRangeFt: number = 5,
): { targetCoord: DndGridCoord; costFt: number } {
  const reachable = getReachableTiles(actorState.coord, actorState.movementRemainingFt, map, unitStates);
  if (reachable.length === 0) {
    return { targetCoord: actorState.coord, costFt: 0 };
  }

  let bestCoord: DndGridCoord = reachable[0]!;
  let bestScore = -Infinity;

  for (const coord of reachable) {
    const tile = map.tiles[coord.y]?.[coord.x];
    if (!tile) continue;

    const distToTarget = getDistanceFt(coord, targetState.coord);
    let score = 0;

    if (preferredRangeFt <= 5) {
      // Melee martial: get as close to 5ft as possible
      score += 100 - distToTarget;
      if (distToTarget <= 5) score += 200; // In melee reach bonus
      if (tile.coverLevel === "half") score += 15; // Cover bonus
      if ((tile.elevation || 0) > 0) score += 10;
    } else {
      // Ranged caster: maintain safe sweet spot (20ft to 40ft)
      if (distToTarget < 15) {
        score -= (15 - distToTarget) * 20; // Penalize being too close (threat zone)
      } else if (distToTarget >= 15 && distToTarget <= 45) {
        score += 100; // Optimal range
      } else {
        score += 80 - (distToTarget - 45);
      }
      if (tile.coverLevel === "half") score += 25; // Cover highly valued for casters
      if ((tile.elevation || 0) > 0) score += 20; // High ground advantage
    }

    // Avoid hazard tiles
    if (tile.hazardDamage) {
      score -= 50;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCoord = coord;
    }
  }

  const costFt = getDistanceFt(actorState.coord, bestCoord);
  return { targetCoord: bestCoord, costFt };
}

/** Execute a single melee/ranged attack roll and calculate damage */
function executeStandardAttack(
  attacker: DndCombatant,
  target: DndCombatant,
  isMartial: boolean = false,
): { isHit: boolean; damageDealt: number; logText: string } {
  const attackStatKey = primaryAttackStat(attacker.unitClass, attacker.stats);
  const attMod = abilityModifier(attacker.stats[attackStatKey] || 10);
  const prof = proficiencyBonus(attacker.level);
  const attackCount = isMartial ? martialAttackCount(attacker.unitClass, attacker.level) : 1;

  let totalDamage = 0;
  const rollDetails: string[] = [];

  for (let i = 0; i < attackCount; i++) {
    const d20 = Math.floor(Math.random() * 20) + 1;
    const toHit = d20 + attMod + prof;
    const isCrit = d20 === 20;
    const isHit = isCrit || (d20 !== 1 && toHit >= target.ac);

    if (isHit) {
      const dieSides = isMartial ? 8 : 6;
      const dice = isCrit ? 2 : 1;
      let dmg = 0;
      for (let d = 0; d < dice; d++) {
        dmg += Math.floor(Math.random() * dieSides) + 1;
      }
      dmg += attMod;
      const applied = Math.max(1, dmg);
      totalDamage += applied;
      rollDetails.push(
        isCrit
          ? `💥 CRITICAL HIT! (${d20}+${attMod + prof}=${toHit} vs AC ${target.ac}) for ${applied} dmg`
          : `Hit (${d20}+${attMod + prof}=${toHit} vs AC ${target.ac}) for ${applied} dmg`,
      );
    } else {
      rollDetails.push(`Miss (${d20}+${attMod + prof}=${toHit} vs AC ${target.ac})`);
    }
  }

  const isHit = totalDamage > 0;
  const logText = isHit
    ? `⚔️ ${attacker.name} strikes ${target.name}: ${rollDetails.join(", ")}!`
    : `🛡️ ${attacker.name} attacks ${target.name}: ${rollDetails.join(", ")}.`;

  return { isHit, damageDealt: totalDamage, logText };
}

/** Execute a single-target spell/cantrip */
function executeSingleSpell(
  caster: DndCombatant,
  target: DndCombatant,
  spell: DndSpell,
): { isHit: boolean; damageDealt: number; logText: string } {
  const castStatKey = spell.castingStat || primaryCastingStat(caster.unitClass);
  const castMod = abilityModifier(caster.stats[castStatKey] || 10);
  const prof = proficiencyBonus(caster.level);
  const spellDc = 8 + prof + castMod;
  const attackBonus = prof + castMod;

  if (spell.type === "save") {
    const saveStatKey = spell.saveStat || "dex";
    const saveMod = abilityModifier(target.stats[saveStatKey] || 10);
    const saveD20 = Math.floor(Math.random() * 20) + 1;
    const saveTotal = saveD20 + saveMod;
    const saved = saveD20 === 20 || (saveD20 !== 1 && saveTotal >= spellDc);

    const diceCount = spell.diceCount || (spell.level === 0 ? cantripScaling(caster.level) : 3);
    const dieSize = parseInt((spell.damageDie || "d8").replace("d", ""), 10) || 8;
    let baseDmg = 0;
    for (let d = 0; d < diceCount; d++) {
      baseDmg += Math.floor(Math.random() * dieSize) + 1;
    }
    const finalDmg = saved ? Math.floor(baseDmg / 2) : baseDmg;

    const logText = saved
      ? `✨ ${caster.name} casts ${spell.name} on ${target.name}. Saved (${saveD20}+${saveMod}=${saveTotal} vs DC ${spellDc}) taking ${finalDmg} ${spell.damageType || "magic"} damage.`
      : `✨ ${caster.name} casts ${spell.name} on ${target.name}. Failed save (${saveD20}+${saveMod}=${saveTotal} vs DC ${spellDc}) taking ${finalDmg} ${spell.damageType || "magic"} damage!`;

    return { isHit: true, damageDealt: finalDmg, logText };
  } else {
    // Attack roll spell (e.g. Eldritch Blast, Guiding Bolt, Fire Bolt)
    const d20 = Math.floor(Math.random() * 20) + 1;
    const toHit = d20 + attackBonus;
    const isCrit = d20 === 20;
    const isHit = isCrit || (d20 !== 1 && toHit >= target.ac);

    if (!isHit) {
      return {
        isHit: false,
        damageDealt: 0,
        logText: `✨ ${caster.name} casts ${spell.name} at ${target.name}: Miss (${d20}+${attackBonus}=${toHit} vs AC ${target.ac}).`,
      };
    }

    const diceCount = spell.diceCount || (spell.level === 0 ? cantripScaling(caster.level) : 2);
    const dieSize = parseInt((spell.damageDie || "d10").replace("d", ""), 10) || 10;
    let dmg = 0;
    const rolls = isCrit ? diceCount * 2 : diceCount;
    for (let d = 0; d < rolls; d++) {
      dmg += Math.floor(Math.random() * dieSize) + 1;
    }
    if (spell.damageType === "force" && /warlock/i.test(caster.unitClass)) {
      dmg += castMod; // Agonizing blast
    }

    const logText = isCrit
      ? `💥 ${caster.name} CRITICAL HIT with ${spell.name} on ${target.name} for ${dmg} ${spell.damageType || "force"} damage!`
      : `✨ ${caster.name} hits ${target.name} with ${spell.name} for ${dmg} ${spell.damageType || "force"} damage!`;

    return { isHit: true, damageDealt: dmg, logText };
  }
}

/**
 * Execute a complete tactical round:
 * 1. Player Action (if provided)
 * 2. Autonomous Allies AI Turns (Pathfind + Reposition + Cast/Attack)
 * 3. Enemy Monsters AI Turns (Pathfind + Close in / Cover + Attack/Spells)
 */
export function resolveTacticalCombatRound(
  currentState: DndCombatState,
  currentTactical: DndTacticalState,
  playerAction?: DndActionRequest,
): TacticalRoundResult {
  let party = currentState.party.map((p) => ({ ...p }));
  let enemies = currentState.enemies.map((e) => ({ ...e }));
  let units = { ...currentTactical.units };
  const map = currentTactical.map;
  const stepLogs: TacticalStepLog[] = [];

  const getLivingAllies = () => party.filter((p) => p.hp > 0);
  const getLivingEnemies = () => enemies.filter((e) => e.hp > 0);

  // ── 1. Resolve Active Player Action ──
  if (playerAction) {
    const actor = party.find((p) => p.id === playerAction.actorId);
    const target = enemies.find((e) => e.id === playerAction.targetId) || getLivingEnemies()[0];

    if (actor && target && actor.hp > 0 && target.hp > 0) {
      if (playerAction.type === "spell" && playerAction.spellId) {
        const spell = SPELL_CATALOG.find((s) => s.id === playerAction.spellId) || SPELL_CATALOG[0]!;
        const res = executeSingleSpell(actor, target, spell);
        target.hp = Math.max(0, target.hp - res.damageDealt);
        stepLogs.push({
          actorId: actor.id,
          actorName: actor.name,
          side: "party",
          actionType: "spell",
          text: res.logText,
        });
      } else if (playerAction.type === "cantrip" && (playerAction.cantripId || playerAction.spellId)) {
        const spell = SPELL_CATALOG.find((s) => s.id === (playerAction.cantripId || playerAction.spellId)) || SPELL_CATALOG[0]!;
        const res = executeSingleSpell(actor, target, spell);
        target.hp = Math.max(0, target.hp - res.damageDealt);
        stepLogs.push({
          actorId: actor.id,
          actorName: actor.name,
          side: "party",
          actionType: "spell",
          text: res.logText,
        });
      } else if (playerAction.type === "dodge") {
        stepLogs.push({
          actorId: actor.id,
          actorName: actor.name,
          side: "party",
          actionType: "dodge",
          text: `🛡️ ${actor.name} takes the Dodge action, preparing to evade incoming attacks.`,
        });
      } else {
        // Weapon attack
        const isMartial = /fighter|barbarian|paladin|rogue/i.test(actor.unitClass);
        const res = executeStandardAttack(actor, target, isMartial);
        target.hp = Math.max(0, target.hp - res.damageDealt);
        stepLogs.push({
          actorId: actor.id,
          actorName: actor.name,
          side: "party",
          actionType: "attack",
          text: res.logText,
        });
      }
    }
  }

  // ── 2. Autonomous Allies AI Turns ──
  const actingId = playerAction?.actorId;
  const alliesToAct = party.filter((p) => p.id !== actingId && p.hp > 0);

  for (const ally of alliesToAct) {
    if (getLivingEnemies().length === 0) break;
    const allyState = units[ally.id];
    if (!allyState) continue;

    const isCaster = /wizard|warlock|sorcerer|cleric|druid|bard/i.test(ally.unitClass);
    const preferredRange = isCaster ? 30 : 5;

    // Pick closest living enemy
    let closestEnemy: DndCombatant | undefined = getLivingEnemies()[0];
    let closestDist = Infinity;
    for (const enemy of getLivingEnemies()) {
      const eState = units[enemy.id];
      if (!eState) continue;
      const d = getDistanceFt(allyState.coord, eState.coord);
      if (d < closestDist) {
        closestDist = d;
        closestEnemy = enemy;
      }
    }

    if (!closestEnemy) continue;
    const targetEnemyState = units[closestEnemy.id];
    if (!targetEnemyState) continue;

    // Check if ally can cast AoE (e.g. Fireball) on enemy clusters
    let usedAoE = false;
    if (isCaster && ally.level >= 5) {
      const fireballSpell = SPELL_CATALOG.find((s) => s.id === "fireball");
      if (fireballSpell) {
        const blastCenter = targetEnemyState.coord;
        const blastCoords = getAoEAffectedTiles(blastCenter, "sphere", 20, map);
        // Ensure no party member is caught in friendly fire
        const partyCaught = getLivingAllies().some((p) => {
          const pCoord = units[p.id]?.coord;
          return pCoord && blastCoords.some((c) => c.x === pCoord.x && c.y === pCoord.y);
        });

        if (!partyCaught) {
          const aoeRes = resolveDndAoESpell(
            ally,
            fireballSpell,
            blastCenter,
            blastCoords,
            [...party, ...enemies],
            units,
          );
          // Apply damage to enemies
          for (const t of aoeRes.targets) {
            const e = enemies.find((entry) => entry.id === t.combatantId);
            if (e) e.hp = Math.max(0, e.hp - t.damageDealt);
          }
          stepLogs.push({
            actorId: ally.id,
            actorName: ally.name,
            side: "party",
            actionType: "aoe",
            text: aoeRes.logText,
            targetCoord: blastCenter,
          });
          usedAoE = true;
        }
      }
    }

    if (!usedAoE) {
      // Tactical Movement
      const move = findBestTacticalMoveTile(
        ally,
        allyState,
        closestEnemy,
        targetEnemyState,
        map,
        units,
        preferredRange,
      );

      if (move.costFt > 0) {
        // Opportunity attack check
        const opp = checkOpportunityAttack(
          ally.id,
          allyState.coord,
          move.targetCoord,
          getLivingEnemies(),
          units,
        );
        if (opp?.provoked) {
          if (opp.isHit) ally.hp = Math.max(0, ally.hp - opp.damageDealt);
          stepLogs.push({
            actorId: opp.enemyId,
            actorName: opp.enemyName,
            side: "enemy",
            actionType: "attack",
            text: opp.logText,
          });
        }

        units[ally.id] = {
          ...allyState,
          coord: move.targetCoord,
          movementRemainingFt: Math.max(0, allyState.movementRemainingFt - move.costFt),
        };
        stepLogs.push({
          actorId: ally.id,
          actorName: ally.name,
          side: "party",
          actionType: "move",
          text: `🏃 ${ally.name} maneuvers ${move.costFt}ft across the battlemap.`,
          moveFrom: allyState.coord,
          moveTo: move.targetCoord,
        });
      }

      // Attack / Spell resolution
      if (closestEnemy.hp > 0) {
        if (isCaster) {
          const availableSpells = SPELL_CATALOG.filter(
            (s) => !s.classes || s.classes.some((c) => ally.unitClass.toLowerCase().includes(c.toLowerCase())),
          );
          const chosenSpell = availableSpells[Math.floor(Math.random() * Math.min(3, availableSpells.length))] || SPELL_CATALOG[0]!;
          const res = executeSingleSpell(ally, closestEnemy, chosenSpell);
          closestEnemy.hp = Math.max(0, closestEnemy.hp - res.damageDealt);
          stepLogs.push({
            actorId: ally.id,
            actorName: ally.name,
            side: "party",
            actionType: "spell",
            text: res.logText,
          });
        } else {
          const isMartial = /fighter|barbarian|paladin|rogue/i.test(ally.unitClass);
          const res = executeStandardAttack(ally, closestEnemy, isMartial);
          closestEnemy.hp = Math.max(0, closestEnemy.hp - res.damageDealt);
          stepLogs.push({
            actorId: ally.id,
            actorName: ally.name,
            side: "party",
            actionType: "attack",
            text: res.logText,
          });
        }
      }
    }
  }

  // ── 3. Autonomous Enemy Monsters AI Turns ──
  const livingEnemies = getLivingEnemies();

  for (const enemy of livingEnemies) {
    if (getLivingAllies().length === 0) break;
    const enemyState = units[enemy.id];
    if (!enemyState) continue;

    // Target closest living party member
    let closestTarget: DndCombatant | undefined = getLivingAllies()[0];
    let closestDist = Infinity;
    for (const ally of getLivingAllies()) {
      const aState = units[ally.id];
      if (!aState) continue;
      const d = getDistanceFt(enemyState.coord, aState.coord);
      if (d < closestDist) {
        closestDist = d;
        closestTarget = ally;
      }
    }

    if (!closestTarget) continue;
    const targetAllyState = units[closestTarget.id];
    if (!targetAllyState) continue;

    const isEnemyCaster = /mage|wizard|cultist|shaman|lich|sorcerer/i.test(enemy.unitClass);
    const preferredRange = isEnemyCaster ? 30 : 5;

    // Tactical Movement
    const move = findBestTacticalMoveTile(
      enemy,
      enemyState,
      closestTarget,
      targetAllyState,
      map,
      units,
      preferredRange,
    );

    if (move.costFt > 0) {
      // Opportunity attack check from party
      const opp = checkOpportunityAttack(
        enemy.id,
        enemyState.coord,
        move.targetCoord,
        getLivingAllies(),
        units,
      );
      if (opp?.provoked) {
        if (opp.isHit) enemy.hp = Math.max(0, enemy.hp - opp.damageDealt);
        stepLogs.push({
          actorId: opp.enemyId,
          actorName: opp.enemyName,
          side: "party",
          actionType: "attack",
          text: opp.logText,
        });
      }

      units[enemy.id] = {
        ...enemyState,
        coord: move.targetCoord,
        movementRemainingFt: Math.max(0, enemyState.movementRemainingFt - move.costFt),
      };
      stepLogs.push({
        actorId: enemy.id,
        actorName: enemy.name,
        side: "enemy",
        actionType: "move",
        text: `🐾 ${enemy.name} advances ${move.costFt}ft towards ${closestTarget.name}.`,
        moveFrom: enemyState.coord,
        moveTo: move.targetCoord,
      });
    }

    // Strike Target
    if (closestTarget.hp > 0) {
      if (isEnemyCaster) {
        const spell = SPELL_CATALOG.find((s) => s.id === "eldritch_blast") || SPELL_CATALOG[0]!;
        const res = executeSingleSpell(enemy, closestTarget, spell);
        closestTarget.hp = Math.max(0, closestTarget.hp - res.damageDealt);
        stepLogs.push({
          actorId: enemy.id,
          actorName: enemy.name,
          side: "enemy",
          actionType: "spell",
          text: res.logText,
        });
      } else {
        const isMartial = enemy.level >= 5;
        const res = executeStandardAttack(enemy, closestTarget, isMartial);
        closestTarget.hp = Math.max(0, closestTarget.hp - res.damageDealt);
        stepLogs.push({
          actorId: enemy.id,
          actorName: enemy.name,
          side: "enemy",
          actionType: "attack",
          text: res.logText,
        });
      }
    }
  }

  // ── 4. Check Outcome & Reset Round Budgets ──
  const allEnemiesDead = enemies.every((e) => e.hp <= 0);
  const allPartyDead = party.every((p) => p.hp <= 0);
  const outcome = allEnemiesDead ? "victory" : allPartyDead ? "defeat" : null;

  // Refresh speed budgets for next round
  for (const [id, u] of Object.entries(units)) {
    const combatant = party.find((p) => p.id === id) || enemies.find((e) => e.id === id);
    const speed = combatant && /wizard|sorcerer/i.test(combatant.unitClass) && combatant.level >= 10 ? 40 : 30;
    units[id] = {
      ...u,
      movementRemainingFt: speed,
      actionsRemaining: 1,
      reactionAvailable: true,
    };
  }

  const roundLogEntries = stepLogs.map((log, idx) => ({
    id: `round-${currentState.round}-step-${idx}-${Date.now()}`,
    round: currentState.round,
    turnActor: log.actorName,
    text: log.text,
  }));

  const nextDndState: DndCombatState = {
    ...currentState,
    round: currentState.round + 1,
    party,
    enemies,
    outcome,
    log: [...currentState.log, ...roundLogEntries],
  };

  const nextTacticalState: DndTacticalState = {
    ...currentTactical,
    units,
  };

  return {
    nextDndState,
    nextTacticalState,
    stepLogs,
  };
}
