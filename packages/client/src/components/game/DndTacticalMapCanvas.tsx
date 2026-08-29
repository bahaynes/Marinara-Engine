// ──────────────────────────────────────────────
// D&D 5.5e Tactical Battlemap Canvas Component
// ──────────────────────────────────────────────

import { useCallback, useMemo, useState, useRef } from "react";
import {
  Shield,
  Flame,
  Footprints,
  Crown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FastForward,
  Sword,
} from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  type DndCombatant,
  type DndSpell,
  type DndGridCoord,
  type DndTile,
  type DndTacticalState,
  type DndTacticalUnitState,
  type DndAoEResolution,
  getDistanceFt,
  getReachableTiles,
  getAoEAffectedTiles,
  checkOpportunityAttack,
  resolveDndAoESpell,
} from "@marinara-engine/shared";

interface DndTacticalMapCanvasProps {
  tacticalState: DndTacticalState;
  allCombatants: DndCombatant[];
  selectedUnitId: string | null;
  selectedEnemyId: string | null;
  activeAoESpell: DndSpell | null;
  animatingActorId?: string | null;
  animatingTargetCoord?: DndGridCoord | null;
  animatingBannerText?: string | null;
  isAnimating?: boolean;
  onSkipAnimation?: () => void;
  onSelectUnit: (unitId: string) => void;
  onSelectEnemy: (enemyId: string) => void;
  onMoveUnit: (unitId: string, to: DndGridCoord, movementCostFt: number) => void;
  onExecuteAoESpell: (resolution: DndAoEResolution) => void;
  onLogMessage: (actor: string, text: string) => void;
}

const TERRAIN_STYLES: Record<string, { bg: string; border: string; label: string }> = {
  plains: { bg: "bg-emerald-950/40", border: "border-emerald-800/30", label: "Open Ground" },
  forest: { bg: "bg-green-950/70", border: "border-green-800/50", label: "Dense Foliage (Difficult)" },
  ruin: { bg: "bg-stone-900/80", border: "border-stone-700/60", label: "Stone Cover (+2 AC)" },
  mountain: { bg: "bg-amber-950/60", border: "border-amber-700/50", label: "High Vantage Point" },
  water: { bg: "bg-cyan-950/70", border: "border-cyan-800/50", label: "Hazard (Acid/Water)" },
  wall: { bg: "bg-zinc-950", border: "border-zinc-800", label: "Impassable Wall" },
  hazard: { bg: "bg-red-950/80", border: "border-red-700/60", label: "Hazard" },
};

export function DndTacticalMapCanvas({
  tacticalState,
  allCombatants,
  selectedUnitId,
  selectedEnemyId,
  activeAoESpell,
  animatingActorId,
  animatingTargetCoord,
  animatingBannerText,
  isAnimating = false,
  onSkipAnimation,
  onSelectUnit,
  onSelectEnemy,
  onMoveUnit,
  onExecuteAoESpell,
  onLogMessage,
}: DndTacticalMapCanvasProps) {
  const { map, units } = tacticalState;
  const [hoveredCoord, setHoveredCoord] = useState<DndGridCoord | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeUnit = allCombatants.find((c) => c.id === selectedUnitId);
  const activeUnitState: DndTacticalUnitState | undefined = selectedUnitId ? units[selectedUnitId] : undefined;

  // Compute movement range for the active selected unit
  const reachableTiles = useMemo(() => {
    if (!activeUnitState || isAnimating || activeAoESpell) return [];
    return getReachableTiles(activeUnitState.coord, activeUnitState.movementRemainingFt, map, units);
  }, [activeUnitState, map, units, isAnimating, activeAoESpell]);

  // Compute AoE preview tiles when an AoE spell is active
  const aoeHighlightedTiles = useMemo(() => {
    if (!activeAoESpell || !hoveredCoord) return [];
    const shape = activeAoESpell.aoeShape || "sphere";
    const radiusFt = activeAoESpell.aoeRadiusFt || 20;
    const origin = activeUnitState?.coord;
    return getAoEAffectedTiles(hoveredCoord, shape, radiusFt, map, origin);
  }, [activeAoESpell, hoveredCoord, activeUnitState?.coord, map]);

  // Lookup combatant on a specific tile
  const combatantAtCoord = useCallback(
    (x: number, y: number): DndCombatant | null => {
      for (const [id, unit] of Object.entries(units)) {
        if (unit.coord.x === x && unit.coord.y === y) {
          const found = allCombatants.find((c) => c.id === id);
          if (found && found.hp > 0) return found;
        }
      }
      return null;
    },
    [units, allCombatants],
  );

  // Handle tile click: movement or AoE execution or unit targeting
  const handleTileClick = (tile: DndTile) => {
    if (isAnimating) return;

    const clickedCombatant = combatantAtCoord(tile.x, tile.y);

    // 1. AoE Spell Detonation
    if (activeAoESpell && activeUnit) {
      const affected = aoeHighlightedTiles;
      const resolution = resolveDndAoESpell(
        activeUnit,
        activeAoESpell,
        { x: tile.x, y: tile.y },
        affected,
        allCombatants,
        units,
      );
      onExecuteAoESpell(resolution);
      return;
    }

    // 2. Click on a combatant: select unit or target enemy
    if (clickedCombatant) {
      if (clickedCombatant.side === "party") {
        onSelectUnit(clickedCombatant.id);
      } else {
        onSelectEnemy(clickedCombatant.id);
      }
      return;
    }

    // 3. Move active selected unit
    if (activeUnit && activeUnitState) {
      const isReachable = reachableTiles.some((r) => r.x === tile.x && r.y === tile.y);
      if (!isReachable) return;

      const targetCoord = { x: tile.x, y: tile.y };
      const moveDistanceFt = getDistanceFt(activeUnitState.coord, targetCoord);

      // Check Opportunity Attack from adjacent enemies
      const livingEnemies = allCombatants.filter((c) => c.side === "enemy" && c.hp > 0);
      const oppAttack = checkOpportunityAttack(
        activeUnit.id,
        activeUnitState.coord,
        targetCoord,
        livingEnemies,
        units,
      );

      if (oppAttack && oppAttack.provoked) {
        onLogMessage(oppAttack.enemyName, oppAttack.logText);
      }

      onMoveUnit(activeUnit.id, targetCoord, moveDistanceFt);
      onLogMessage(
        activeUnit.name,
        `🏃 Moves ${moveDistanceFt}ft to (${tile.x}, ${tile.y}). Remaining: ${Math.max(0, activeUnitState.movementRemainingFt - moveDistanceFt)}ft.`,
      );
    }
  };

  return (
    <div className="relative flex flex-col h-full w-full select-none overflow-hidden rounded-xl border border-white/10 bg-slate-950/90 shadow-2xl">
      {/* ── Top Battlemap Toolbar ── */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black/50 px-3 py-2 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-bold text-cyan-300">🗺️ D&D Battlemap (5ft Grid)</span>

          {/* Turn Animation Live Banner */}
          {isAnimating ? (
            <div className="flex items-center gap-2 rounded-lg bg-amber-500/20 px-2.5 py-1 text-xs font-bold text-amber-300 border border-amber-500/40 animate-pulse">
              <Sword size={14} className="animate-spin" />
              <span>{animatingBannerText || "Executing Tactical Turn..."}</span>
              {onSkipAnimation && (
                <button
                  type="button"
                  onClick={onSkipAnimation}
                  className="flex items-center gap-1 rounded bg-amber-500/30 px-1.5 py-0.5 text-[0.6875rem] font-bold text-amber-100 hover:bg-amber-500/50 ml-2"
                >
                  <FastForward size={12} />
                  <span>Skip</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {activeUnit && activeUnitState && (
                <span className="flex items-center gap-1 font-semibold text-white/80">
                  <Footprints size={14} className="text-cyan-400" />
                  <span>
                    {activeUnit.name}: <strong className="text-cyan-300">{activeUnitState.movementRemainingFt} ft</strong> Move
                  </span>
                </span>
              )}
              {activeAoESpell && (
                <span className="flex items-center gap-1 rounded bg-orange-500/20 px-2 py-0.5 font-bold text-orange-300 animate-pulse border border-orange-500/40">
                  <Flame size={14} />
                  <span>Tap Grid to Cast {activeAoESpell.name} (20ft Radius)</span>
                </span>
              )}
            </>
          )}
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(0.8, z - 0.1))}
            className="rounded bg-white/10 p-1 text-white/70 hover:bg-white/20 hover:text-white"
            title="Zoom Out"
          >
            <ZoomOut size={14} />
          </button>
          <span className="w-9 text-center font-mono text-[0.6875rem] text-white/60">{Math.round(zoomLevel * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(1.4, z + 0.1))}
            className="rounded bg-white/10 p-1 text-white/70 hover:bg-white/20 hover:text-white"
            title="Zoom In"
          >
            <ZoomIn size={14} />
          </button>
          <button
            type="button"
            onClick={() => setZoomLevel(1)}
            className="rounded bg-white/10 p-1 text-white/70 hover:bg-white/20 hover:text-white"
            title="Reset Zoom"
          >
            <Maximize2 size={14} />
          </button>
        </div>
      </div>

      {/* ── Main Interactive Grid Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 flex items-center justify-center overscroll-contain bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]"
      >
        <div
          style={{ transform: `scale(${zoomLevel})`, transformOrigin: "center center" }}
          className="transition-transform duration-150 inline-block rounded-lg p-2 bg-black/40 border border-white/15 shadow-2xl"
        >
          <div
            className="grid gap-1.5"
            style={{
              gridTemplateColumns: `repeat(${map.width}, minmax(3.25rem, 4.25rem))`,
              gridTemplateRows: `repeat(${map.height}, minmax(3.25rem, 4.25rem))`,
            }}
          >
            {map.tiles.map((row, y) =>
              row.map((tile, x) => {
                const combatant = combatantAtCoord(x, y);
                const isReachable = reachableTiles.some((r) => r.x === x && r.y === y);
                const isAoEHit = aoeHighlightedTiles.some((a) => a.x === x && a.y === y);
                const isHovered = hoveredCoord?.x === x && hoveredCoord?.y === y;
                const isSelectedCombatant = combatant && combatant.id === selectedUnitId;
                const isTargetedEnemy = combatant && combatant.id === selectedEnemyId;
                const isTurnActor = combatant && combatant.id === animatingActorId;
                const isTargetFlash = animatingTargetCoord?.x === x && animatingTargetCoord?.y === y;

                const terrainConfig = TERRAIN_STYLES[tile.terrain] || TERRAIN_STYLES.plains;

                return (
                  <div
                    key={`${x}-${y}`}
                    onClick={() => handleTileClick(tile)}
                    onMouseEnter={() => setHoveredCoord({ x, y })}
                    className={cn(
                      "relative flex flex-col items-center justify-center rounded-lg border transition-all cursor-pointer select-none",
                      terrainConfig.bg,
                      terrainConfig.border,
                      isReachable && "bg-cyan-500/20 border-cyan-400/80 shadow-lg shadow-cyan-900/40 ring-1 ring-cyan-400/50",
                      isAoEHit && "bg-orange-600/40 border-orange-400 shadow-lg shadow-orange-900/50 ring-2 ring-orange-400",
                      isHovered && !isAoEHit && !isReachable && !isAnimating && "border-white/40 bg-white/10",
                      isTargetFlash && "bg-red-500/40 border-red-400 ring-4 ring-red-500/80 animate-ping",
                    )}
                  >
                    {/* Grid Coordinate Watermark */}
                    <span className="absolute top-0.5 left-1 text-[0.5625rem] font-mono text-white/20">
                      {x},{y}
                    </span>

                    {/* Target Hit Flash FX */}
                    {isTargetFlash && (
                      <div className="absolute inset-0 z-30 flex items-center justify-center bg-red-600/40 rounded-lg animate-pulse">
                        <span className="text-sm font-black text-white drop-shadow">💥 HIT!</span>
                      </div>
                    )}

                    {/* Terrain Cover Badge */}
                    {tile.coverLevel !== "none" && !combatant && (
                      <span className="absolute bottom-0.5 right-1 flex items-center gap-0.5 text-[0.5625rem] font-bold text-stone-400">
                        <Shield size={10} />
                        <span>+2 AC</span>
                      </span>
                    )}

                    {/* Reachable Move Footprint Indicator */}
                    {isReachable && !combatant && (
                      <Footprints size={16} className="text-cyan-300/60 animate-pulse" />
                    )}

                    {/* Combatant Token */}
                    {combatant && (
                      <div className="relative flex flex-col items-center justify-center z-10">
                        <div
                          className={cn(
                            "relative flex h-10 w-10 sm:h-11 sm:w-11 items-center justify-center rounded-full border-2 text-sm font-bold shadow-xl transition-all duration-300",
                            combatant.side === "party"
                              ? combatant.isPlayer
                                ? "border-amber-400 bg-amber-950 text-amber-200 ring-2 ring-amber-400/60"
                                : "border-cyan-400 bg-cyan-950 text-cyan-200 ring-1 ring-cyan-400/50"
                              : "border-red-500 bg-red-950 text-red-200 ring-1 ring-red-500/50",
                            isSelectedCombatant && !isTurnActor && "scale-110 ring-4 ring-white shadow-cyan-400/80",
                            isTargetedEnemy && !isTurnActor && "ring-4 ring-red-400 scale-105 shadow-red-500/80",
                            isTurnActor && "scale-125 ring-4 ring-yellow-300 bg-amber-900 text-yellow-100 shadow-2xl shadow-yellow-400/90 animate-bounce",
                          )}
                        >
                          {combatant.isPlayer && (
                            <Crown size={12} className="absolute -top-2 text-amber-300 drop-shadow" />
                          )}
                          {combatant.name.charAt(0)}
                        </div>

                        {/* Mini HP Bar below token */}
                        <div className="mt-1 w-9 h-1 rounded-full bg-black/80 overflow-hidden border border-white/10">
                          <div
                            className={cn(
                              "h-full transition-all",
                              combatant.side === "party" ? "bg-cyan-400" : "bg-red-500",
                            )}
                            style={{
                              width: `${Math.max(0, Math.min(100, Math.round((combatant.hp / combatant.maxHp) * 100)))}%`,
                            }}
                          />
                        </div>

                        {/* Name Tag */}
                        <span className="mt-0.5 max-w-[4rem] truncate text-[0.625rem] font-bold leading-none text-white drop-shadow">
                          {combatant.name.split(" ")[0]}
                        </span>
                      </div>
                    )}
                  </div>
                );
              }),
            )}
          </div>
        </div>
      </div>

      {/* ── Bottom Grid Legend ── */}
      <div className="flex flex-wrap items-center justify-between border-t border-white/10 bg-black/60 px-3 py-1.5 text-[0.6875rem] text-white/60">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400" /> Party Ally
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> Protagonist (You)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Enemy
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-cyan-500/30 border border-cyan-400" /> Move Range (5ft/tile)
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded bg-orange-600/40 border border-orange-400" /> AoE Blast Zone
          </span>
        </div>

        <div>
          <span>Tap empty blue tile to move • Tap enemy to target</span>
        </div>
      </div>
    </div>
  );
}
