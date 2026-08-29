// ──────────────────────────────────────────────
// D&D 5.5e Tabletop Combat UI
// ──────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sword,
  Sparkles,
  Shield,
  RotateCcw,
  Flag,
  Trophy,
  Skull,
  Settings2,
  Check,
  ChevronUp,
  ChevronDown,
  Flame,
  Snowflake,
  Sun,
  Bell,
  User,
  Zap,
  Heart,
  Brain,
  Crosshair,
} from "lucide-react";
import { cn } from "../../lib/utils.js";
import {
  type Combatant,
  type CombatSummary,
  type DndCombatant,
  type DndCombatState,
  type DndAdvantageState,
  type DndActionRequest,
  type DndSpell,
  SPELL_CATALOG,
  DEFAULT_CANTRIPS,
  abilityModifier,
  formatModifier,
  proficiencyBonus,
  primaryCastingStat,
  cantripScaling,
  martialAttackCount,
  rogueSneakAttackDice,
  resolveFullCombatRound,
} from "@marinara-engine/shared";

interface DndCombatUIProps {
  chatId: string;
  party: Combatant[];
  enemies: Combatant[];
  gameCharacterCards?: any[];
  difficulty?: string;
  onCombatEnd: (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => void;
  onCustomInstruction?: (instruction: string) => void;
  onSaveCharacterStats?: (combatant: DndCombatant) => void;
}

const CLASS_OPTIONS = [
  { name: "Warlock", stat: "CHA" },
  { name: "Wizard", stat: "INT" },
  { name: "Cleric", stat: "WIS" },
  { name: "Rogue", stat: "DEX" },
  { name: "Fighter", stat: "STR" },
  { name: "Paladin", stat: "CHA" },
  { name: "Sorcerer", stat: "CHA" },
  { name: "Bard", stat: "CHA" },
  { name: "Druid", stat: "WIS" },
  { name: "Barbarian", stat: "STR" },
  { name: "Ranger", stat: "WIS" },
  { name: "Monk", stat: "DEX" },
];

function normalizeStatName(name: unknown): string {
  return typeof name === "string" ? name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function extractStatFromText(text: string, statName: string): number | null {
  if (!text) return null;
  const regex = new RegExp(`(?:\\b${statName}\\b|\\b${statName}\\s*score)\\s*[:=]?\\s*(\\d+)`, "i");
  const match = text.match(regex);
  return match && match[1] ? parseInt(match[1], 10) : null;
}

function readCardAttribute(card: any, ...aliases: string[]): number | null {
  if (!card) return null;
  const accepted = new Set(aliases.map(normalizeStatName));
  const attributes = Array.isArray(card.rpgStats?.attributes) ? card.rpgStats.attributes : [];
  for (const attr of attributes) {
    if (!accepted.has(normalizeStatName(attr?.name))) continue;
    const num = Number(attr?.value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function mapToDndCombatant(c: Combatant, side: "party" | "enemy", index: number, cards: any[] = []): DndCombatant {
  const rawRecord = c as unknown as Record<string, unknown>;
  const rawStats = (rawRecord.rawAttributes as Record<string, number> | undefined) || {};

  // Look for exact character card match
  const card = cards.find(
    (entry) => typeof entry?.name === "string" && entry.name.toLowerCase().trim() === c.name.toLowerCase().trim(),
  );

  // Build searchable text from card description/personality for regex fallback
  const cardText = [
    card?.description,
    card?.personality,
    card?.system_prompt,
    card?.mes_example,
    card?.creator_notes,
  ]
    .filter(Boolean)
    .join(" ");

  // Extract RPG Stats from card attributes, falling back to text regex, then rawRecord, then defaults
  const str =
    readCardAttribute(card, "str", "strength", "str score") ??
    extractStatFromText(cardText, "str") ??
    Number(rawStats.str ?? rawStats.strength ?? 10) ??
    10;
  const dex =
    readCardAttribute(card, "dex", "dexterity", "dex score") ??
    extractStatFromText(cardText, "dex") ??
    Number(rawStats.dex ?? rawStats.dexterity ?? 12) ??
    12;
  const con =
    readCardAttribute(card, "con", "constitution", "con score") ??
    extractStatFromText(cardText, "con") ??
    Number(rawStats.con ?? rawStats.constitution ?? 14) ??
    14;
  const int =
    readCardAttribute(card, "int", "intelligence", "int score") ??
    extractStatFromText(cardText, "int") ??
    Number(rawStats.int ?? rawStats.intelligence ?? 10) ??
    10;
  const wis =
    readCardAttribute(card, "wis", "wisdom", "wis score") ??
    extractStatFromText(cardText, "wis") ??
    Number(rawStats.wis ?? rawStats.wisdom ?? 10) ??
    10;
  const cha =
    readCardAttribute(card, "cha", "charisma", "cha score") ??
    extractStatFromText(cardText, "cha") ??
    Number(rawStats.cha ?? rawStats.charisma ?? (side === "party" ? 18 : 10)) ??
    (side === "party" ? 18 : 10);

  const level = Math.max(
    1,
    readCardAttribute(card, "level", "lvl") ??
      extractStatFromText(cardText, "level") ??
      extractStatFromText(cardText, "lvl") ??
      Number(c.level) ??
      1,
  );

  // Determine Class
  let unitClass = String(
    card?.class || rawRecord.unitClass || rawRecord.combatClass || (side === "party" ? "Warlock" : "Monster"),
  ).trim();

  // If unitClass is default, check cardText for class keywords
  if (unitClass === "Warlock" && side === "party") {
    const classMatch = cardText.match(/\b(wizard|warlock|cleric|rogue|paladin|sorcerer|bard|druid|barbarian|fighter|ranger|monk)\b/i);
    if (classMatch && classMatch[1]) {
      unitClass = classMatch[1].charAt(0).toUpperCase() + classMatch[1].slice(1).toLowerCase();
    }
  }

  const dexMod = abilityModifier(dex);
  const defaultAc = 10 + dexMod + (side === "enemy" ? 2 : 3);
  const cardAc = readCardAttribute(card, "ac", "armor class", "armor") ?? extractStatFromText(cardText, "ac");
  const ac = Number(cardAc ?? (c.defense ? Math.min(22, Math.max(10, Math.floor(c.defense / 2) + 8)) : defaultAc));

  const rawCardHpMax = Number(card?.rpgStats?.hp?.max) || extractStatFromText(cardText, "hp");
  const maxHp: number =
    typeof rawCardHpMax === "number" && Number.isFinite(rawCardHpMax) && rawCardHpMax > 0
      ? rawCardHpMax
      : Math.max(10, Number(c.maxHp || c.hp || 30));

  const cardHpVal = Number(card?.rpgStats?.hp?.value);
  const hp: number = Number.isFinite(cardHpVal)
    ? Math.min(maxHp, Math.max(1, cardHpVal))
    : Math.max(1, Number(c.hp || maxHp));

  return {
    id: c.id || `${side}-${index}-${Date.now()}`,
    name: c.name || (side === "party" ? "Adventurer" : "Enemy"),
    side,
    isPlayer: side === "party" && index === 0,
    avatarUrl: (rawRecord.avatarUrl as string | undefined) || null,
    level,
    unitClass,
    hp,
    maxHp,
    ac,
    stats: { str, dex, con, int, wis, cha },
    cantrips: DEFAULT_CANTRIPS,
    statusEffects: [],
  };
}

export function DndCombatUI({
  chatId,
  party,
  enemies,
  gameCharacterCards = [],
  onCombatEnd,
  onSaveCharacterStats,
}: DndCombatUIProps) {
  const initialParty = useMemo(() => party.map((p, i) => mapToDndCombatant(p, "party", i, gameCharacterCards)), [party, gameCharacterCards]);
  const initialEnemies = useMemo(() => enemies.map((e, i) => mapToDndCombatant(e, "enemy", i, gameCharacterCards)), [enemies, gameCharacterCards]);

  const [dndState, setDndState] = useState<DndCombatState>(() => ({
    round: 1,
    party: initialParty,
    enemies: initialEnemies,
    log: [
      {
        id: `init-${chatId}-${Date.now()}`,
        round: 1,
        turnActor: "System",
        text: "⚔️ Initiative rolled! Party and enemies enter turn-based D&D 5.5e combat.",
      },
    ],
    outcome: null,
    phase: "player",
    activePartyIndex: 0,
  }));

  const [selectedEnemyId, setSelectedEnemyId] = useState<string>(() => initialEnemies[0]?.id || "");
  const [advantageState, setAdvantageState] = useState<DndAdvantageState>("none");
  const [sneakAttackEnabled, setSneakAttackEnabled] = useState<boolean>(false);
  const [smiteEnabled, setSmiteEnabled] = useState<boolean>(false);
  const [fleeConfirm, setFleeConfirm] = useState<boolean>(false);

  // Spell category filter tab: "class" | "cantrips" | "low" | "high" | "all"
  const [spellTab, setSpellTab] = useState<"class" | "cantrips" | "low" | "high" | "all">("class");

  // Quick Stat & Level Sheet Editor
  const [editingCombatantId, setEditingCombatantId] = useState<string | null>(null);

  // ── Sync with Prop / Chat Changes ──
  useEffect(() => {
    setDndState({
      round: 1,
      party: initialParty,
      enemies: initialEnemies,
      log: [
        {
          id: `init-${chatId}-${Date.now()}`,
          round: 1,
          turnActor: "System",
          text: "⚔️ Initiative rolled! Party and enemies enter turn-based D&D 5.5e combat.",
        },
      ],
      outcome: null,
      phase: "player",
      activePartyIndex: 0,
    });
    setSelectedEnemyId(initialEnemies[0]?.id || "");
    setAdvantageState("none");
    setSneakAttackEnabled(false);
    setSmiteEnabled(false);
    setFleeConfirm(false);
    setEditingCombatantId(null);
  }, [chatId, initialParty, initialEnemies]);

  const activePlayer = dndState.party[0];
  const targetEnemy = dndState.enemies.find((e) => e.id === selectedEnemyId) || dndState.enemies.find((e) => e.hp > 0);

  const playerLevel = activePlayer?.level || 1;
  const playerProf = proficiencyBonus(playerLevel);
  const castingStatKey = primaryCastingStat(activePlayer?.unitClass);
  const playerCastMod = abilityModifier(activePlayer?.stats[castingStatKey] || 10);
  const spellDc = 8 + playerProf + playerCastMod;
  const spellAttackBonus = playerProf + playerCastMod;

  const martialAttacks = martialAttackCount(activePlayer?.unitClass, playerLevel);
  const sneakDice = rogueSneakAttackDice(playerLevel);
  const isPaladin = /paladin/i.test(activePlayer?.unitClass || "");
  const isRogue = /rogue|soulknife/i.test(activePlayer?.unitClass || "");

  // ── Filter available spells for active character ──
  const visibleSpells = useMemo(() => {
    const cls = activePlayer?.unitClass || "Warlock";
    if (spellTab === "all") return SPELL_CATALOG;
    if (spellTab === "cantrips") return SPELL_CATALOG.filter((s) => s.level === 0);
    if (spellTab === "low") return SPELL_CATALOG.filter((s) => s.level >= 1 && s.level <= 3);
    if (spellTab === "high") return SPELL_CATALOG.filter((s) => s.level >= 4);

    // "class" tab: match spells recommended for class or cantrips
    return SPELL_CATALOG.filter((s) => {
      if (!s.classes || s.classes.length === 0) return true;
      return s.classes.some((c) => cls.toLowerCase().includes(c.toLowerCase()));
    });
  }, [activePlayer?.unitClass, spellTab]);

  // ── Handle Full Combat Round Execution (Player -> Allies -> Enemies) ──
  const executePlayerAction = useCallback(
    (actionReq: Partial<DndActionRequest>) => {
      if (!activePlayer || dndState.outcome || !targetEnemy) return;

      try {
        const fullRequest: DndActionRequest = {
          type: actionReq.type || "attack",
          actorId: activePlayer.id,
          targetId: targetEnemy.id,
          spellId: actionReq.spellId,
          cantripId: actionReq.cantripId,
          advantage: advantageState,
          useSneakAttack: sneakAttackEnabled,
          useDivineSmite: smiteEnabled,
        };

        const { nextState: updatedState } = resolveFullCombatRound(dndState, fullRequest);
        setDndState(updatedState);

        // Reset turn-specific toggles
        setAdvantageState("none");
        setSneakAttackEnabled(false);
        setSmiteEnabled(false);
      } catch (err) {
        console.error("Combat action error:", err);
      }
    },
    [activePlayer, dndState, targetEnemy, advantageState, sneakAttackEnabled, smiteEnabled],
  );

  // ── Quick Stat / Level / Class Updates ──
  const updateCombatantStat = useCallback((id: string, field: string, value: any) => {
    setDndState((prev) => ({
      ...prev,
      party: prev.party.map((c) => {
        if (c.id !== id) return c;
        if (field === "unitClass") return { ...c, unitClass: String(value).trim() || "Adventurer" };
        if (field === "level") return { ...c, level: Math.max(1, Math.min(20, Number(value) || 1)) };
        if (field === "ac") return { ...c, ac: Math.max(1, Number(value) || 10) };
        if (field === "maxHp") return { ...c, maxHp: Math.max(1, Number(value) || 10), hp: Math.min(c.hp, Number(value) || 10) };
        if (field in c.stats) {
          return {
            ...c,
            stats: { ...c.stats, [field]: Math.max(1, Math.min(30, Number(value) || 10)) },
          };
        }
        return c;
      }),
    }));
  }, []);

  // ── Restart Battle ──
  const handleRestart = useCallback(() => {
    setDndState({
      round: 1,
      party: initialParty,
      enemies: initialEnemies,
      log: [
        {
          id: `restart-${Date.now()}`,
          round: 1,
          turnActor: "System",
          text: "🔄 Battle restarted! Ready for round 1.",
        },
      ],
      outcome: null,
      phase: "player",
      activePartyIndex: 0,
    });
    setEditingCombatantId(null);
  }, [initialParty, initialEnemies]);

  // ── Finish Combat & Return to Story ──
  const handleEndBattle = useCallback(() => {
    const outcome = dndState.outcome === "fled" ? "flee" : dndState.outcome === "victory" ? "victory" : "defeat";
    onCombatEnd(outcome, {
      outcome,
      rounds: dndState.round,
      party: dndState.party.map((p) => ({
        name: p.name,
        hp: p.hp,
        maxHp: p.maxHp,
        ko: p.hp <= 0,
        statusEffects: [],
      })),
      enemies: dndState.enemies.map((e) => ({
        name: e.name,
        hp: e.hp,
        maxHp: e.maxHp,
        defeated: e.hp <= 0,
      })),
    });
  }, [dndState, onCombatEnd]);

  const editingCombatant = dndState.party.find((c) => c.id === editingCombatantId);

  const handleSaveModal = useCallback(() => {
    if (editingCombatant) {
      onSaveCharacterStats?.(editingCombatant);
    }
    setEditingCombatantId(null);
  }, [editingCombatant, onSaveCharacterStats]);

  // Helper icon for spells
  const getSpellIcon = (spell: DndSpell) => {
    if (spell.damageType === "fire") return <Flame size={15} className="text-orange-400" />;
    if (spell.damageType === "cold") return <Snowflake size={15} className="text-cyan-400" />;
    if (spell.damageType === "radiant") return <Sun size={15} className="text-yellow-400" />;
    if (spell.damageType === "necrotic") return <Bell size={15} className="text-indigo-400" />;
    if (spell.damageType === "lightning") return <Zap size={15} className="text-amber-400" />;
    if (spell.damageType === "psychic") return <Brain size={15} className="text-purple-400" />;
    if (spell.type === "heal") return <Heart size={15} className="text-emerald-400" />;
    if (spell.type === "auto") return <Crosshair size={15} className="text-blue-400" />;
    return <Sparkles size={15} className="text-cyan-400" />;
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-slate-950/90 text-white backdrop-blur-md">
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between border-b border-white/10 bg-black/40 px-3 sm:px-4 py-2 sm:py-2.5">
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-2 sm:px-2.5 py-1 text-xs font-bold text-amber-300">
            <Sword size={14} />
            <span>D&D 5.5e Combat</span>
          </div>
          <span className="text-xs font-semibold text-white/60">Round {dndState.round}</span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={handleRestart}
            className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 sm:px-2.5 py-1 text-xs font-semibold text-white/70 hover:bg-white/10"
            title="Restart Battle"
          >
            <RotateCcw size={13} />
            <span className="hidden sm:inline">Restart</span>
          </button>
          <button
            type="button"
            onClick={() => setFleeConfirm(true)}
            className="flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 sm:px-2.5 py-1 text-xs font-semibold text-red-300 hover:bg-red-500/20"
            title="Flee Battle"
          >
            <Flag size={13} />
            <span className="hidden sm:inline">Flee</span>
          </button>
        </div>
      </div>

      {/* ── Main Battlefield Area ── */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 sm:gap-4 overflow-y-auto p-3 sm:p-6 overscroll-contain">
        {/* Enemy Cards Formation */}
        <div>
          <h3 className="mb-1.5 sm:mb-2 text-xs font-bold uppercase tracking-wider text-red-400/80">Enemies (Tap to Target)</h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {dndState.enemies.map((enemy) => {
              const isSelected = enemy.id === selectedEnemyId;
              const isDead = enemy.hp <= 0;
              const hpPct = Math.max(0, Math.min(100, Math.round((enemy.hp / enemy.maxHp) * 100)));

              return (
                <button
                  key={enemy.id}
                  type="button"
                  onClick={() => !isDead && setSelectedEnemyId(enemy.id)}
                  disabled={isDead}
                  className={cn(
                    "flex flex-col gap-1.5 sm:gap-2 rounded-xl border p-2.5 sm:p-3 text-left transition-all",
                    isSelected
                      ? "border-red-500 bg-red-950/40 shadow-lg shadow-red-900/30 ring-2 ring-red-500/50"
                      : "border-white/10 bg-slate-900/60 hover:border-white/20",
                    isDead && "opacity-40 grayscale",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-lg bg-red-900/40 text-red-300 font-bold text-sm">
                        {enemy.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-bold text-white leading-tight">{enemy.name}</div>
                        <div className="text-[0.6875rem] text-white/50">{enemy.unitClass}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 rounded-md bg-white/10 px-1.5 sm:px-2 py-0.5 text-[0.6875rem] font-bold text-amber-200">
                      <Shield size={11} />
                      <span>AC {enemy.ac}</span>
                    </div>
                  </div>

                  {/* HP Bar */}
                  <div>
                    <div className="mb-0.5 sm:mb-1 flex justify-between text-[0.6875rem] sm:text-xs font-semibold">
                      <span className="text-red-300">HP</span>
                      <span className="text-white/70">
                        {enemy.hp} / {enemy.maxHp}
                      </span>
                    </div>
                    <div className="h-1.5 sm:h-2 w-full overflow-hidden rounded-full bg-black/50">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-red-600 to-amber-500 transition-all duration-300"
                        style={{ width: `${hpPct}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Player & Party Cards */}
        <div>
          <div className="mb-1.5 sm:mb-2 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-400/80">Party Members</h3>
            <span className="text-[0.6875rem] text-white/50">Tap card to edit Stats</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {dndState.party.map((member, i) => {
              const isDead = member.hp <= 0;
              const hpPct = Math.max(0, Math.min(100, Math.round((member.hp / member.maxHp) * 100)));
              const castingKey = primaryCastingStat(member.unitClass);
              const mainMod = abilityModifier(member.stats[castingKey]);

              return (
                <div
                  key={member.id}
                  onClick={() => setEditingCombatantId(member.id)}
                  className={cn(
                    "group relative flex cursor-pointer flex-col gap-1.5 sm:gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 p-2.5 sm:p-3.5 transition-all hover:border-cyan-400/60 hover:bg-cyan-950/50",
                    isDead && "opacity-40 grayscale",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 sm:h-10 sm:w-10 items-center justify-center rounded-lg bg-cyan-900/50 text-cyan-200 font-bold border border-cyan-500/30 text-sm sm:text-base">
                        {member.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs sm:text-sm font-bold text-white group-hover:text-cyan-200">{member.name}</span>
                          {i === 0 && <span className="rounded bg-cyan-500/20 px-1 text-[0.5625rem] font-bold text-cyan-300">YOU</span>}
                        </div>
                        <div className="text-[0.6875rem] text-cyan-300/70 font-semibold">
                          Lvl {member.level} {member.unitClass}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div className="flex items-center gap-1 rounded-md bg-cyan-900/40 px-1.5 sm:px-2 py-0.5 text-[0.6875rem] font-bold text-cyan-200 border border-cyan-500/30">
                        <Shield size={11} />
                        <span>AC {member.ac}</span>
                      </div>
                      <Settings2 size={14} className="text-white/40 group-hover:text-white/90" />
                    </div>
                  </div>

                  {/* Stats Pill Row */}
                  <div className="flex flex-wrap items-center gap-1 text-[0.5625rem] sm:text-[0.625rem] font-bold text-white/70">
                    <span className="rounded bg-black/40 px-1 py-0.5">STR {member.stats.str}</span>
                    <span className="rounded bg-black/40 px-1 py-0.5">DEX {member.stats.dex}</span>
                    <span className="rounded bg-black/40 px-1 py-0.5">CON {member.stats.con}</span>
                    <span className="rounded bg-black/40 px-1 py-0.5">INT {member.stats.int}</span>
                    <span className="rounded bg-black/40 px-1 py-0.5">WIS {member.stats.wis}</span>
                    <span className="rounded bg-cyan-900/60 text-cyan-200 px-1 py-0.5">
                      CHA {member.stats.cha} ({formatModifier(mainMod)})
                    </span>
                  </div>

                  {/* HP Bar */}
                  <div>
                    <div className="mb-0.5 sm:mb-1 flex justify-between text-[0.6875rem] sm:text-xs font-semibold">
                      <span className="text-cyan-300">HP</span>
                      <span className="text-white/70">
                        {member.hp} / {member.maxHp}
                      </span>
                    </div>
                    <div className="h-1.5 sm:h-2 w-full overflow-hidden rounded-full bg-black/50">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300"
                        style={{ width: `${hpPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Combat Feed ── */}
        <div className="flex-1 rounded-xl border border-white/10 bg-black/40 p-2.5 sm:p-3.5">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-white/50">D&D Combat Feed</div>
          <div className="max-h-32 sm:max-h-40 space-y-1 overflow-y-auto pr-1 text-[0.6875rem] sm:text-xs overscroll-contain">
            {dndState.log.slice(-8).map((entry) => (
              <div key={entry.id} className="rounded bg-white/5 p-1.5 sm:p-2 font-mono leading-relaxed">
                <span className="font-bold text-amber-300">[{entry.turnActor}]</span> {entry.text}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Action Control Deck ── */}
      <div className="border-t border-white/10 bg-slate-900/98 p-2.5 sm:p-4 shrink-0 shadow-2xl">
        {/* Modifiers & Spell Navigation Bar */}
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Roll Modifiers */}
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[0.6875rem] font-bold uppercase text-white/50 mr-1 shrink-0">Roll:</span>
            <button
              type="button"
              onClick={() => setAdvantageState((prev) => (prev === "advantage" ? "none" : "advantage"))}
              className={cn(
                "rounded-lg border px-2 py-0.5 text-[0.6875rem] sm:text-xs font-bold transition-all shrink-0",
                advantageState === "advantage"
                  ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                  : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10",
              )}
            >
              🎲 Adv
            </button>
            <button
              type="button"
              onClick={() => setAdvantageState((prev) => (prev === "disadvantage" ? "none" : "disadvantage"))}
              className={cn(
                "rounded-lg border px-2 py-0.5 text-[0.6875rem] sm:text-xs font-bold transition-all shrink-0",
                advantageState === "disadvantage"
                  ? "border-red-500 bg-red-500/20 text-red-300"
                  : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10",
              )}
            >
              🎲 Disadv
            </button>
            {isRogue && (
              <button
                type="button"
                onClick={() => setSneakAttackEnabled((prev) => !prev)}
                className={cn(
                  "rounded-lg border px-2 py-0.5 text-[0.6875rem] sm:text-xs font-bold transition-all shrink-0",
                  sneakAttackEnabled
                    ? "border-purple-500 bg-purple-500/20 text-purple-300"
                    : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                🗡️ Sneak (+{sneakDice}d6)
              </button>
            )}
            {isPaladin && (
              <button
                type="button"
                onClick={() => setSmiteEnabled((prev) => !prev)}
                className={cn(
                  "rounded-lg border px-2 py-0.5 text-[0.6875rem] sm:text-xs font-bold transition-all shrink-0",
                  smiteEnabled
                    ? "border-amber-500 bg-amber-500/20 text-amber-300"
                    : "border-white/15 bg-white/5 text-white/60 hover:bg-white/10",
                )}
              >
                ✨ Smite (+3d8)
              </button>
            )}
          </div>

          {/* Spell Tabs and DC Info */}
          <div className="flex items-center justify-between sm:justify-end gap-2 overflow-x-auto no-scrollbar">
            <span className="text-[0.6875rem] sm:text-xs font-bold text-amber-300 shrink-0">
              +{spellAttackBonus} To-Hit | DC {spellDc}
            </span>

            {/* Filter Tabs */}
            <div className="flex items-center gap-1 rounded-lg bg-black/50 p-0.5 border border-white/10 shrink-0">
              <button
                type="button"
                onClick={() => setSpellTab("class")}
                className={cn(
                  "rounded-md px-1.5 sm:px-2 py-0.5 text-[0.625rem] sm:text-xs font-bold transition-all",
                  spellTab === "class" ? "bg-cyan-500 text-slate-950 shadow" : "text-white/60 hover:text-white",
                )}
              >
                Class
              </button>
              <button
                type="button"
                onClick={() => setSpellTab("cantrips")}
                className={cn(
                  "rounded-md px-1.5 sm:px-2 py-0.5 text-[0.625rem] sm:text-xs font-bold transition-all",
                  spellTab === "cantrips" ? "bg-cyan-500 text-slate-950 shadow" : "text-white/60 hover:text-white",
                )}
              >
                Cantrips
              </button>
              <button
                type="button"
                onClick={() => setSpellTab("low")}
                className={cn(
                  "rounded-md px-1.5 sm:px-2 py-0.5 text-[0.625rem] sm:text-xs font-bold transition-all",
                  spellTab === "low" ? "bg-cyan-500 text-slate-950 shadow" : "text-white/60 hover:text-white",
                )}
              >
                Lvl 1-3
              </button>
              <button
                type="button"
                onClick={() => setSpellTab("high")}
                className={cn(
                  "rounded-md px-1.5 sm:px-2 py-0.5 text-[0.625rem] sm:text-xs font-bold transition-all",
                  spellTab === "high" ? "bg-cyan-500 text-slate-950 shadow" : "text-white/60 hover:text-white",
                )}
              >
                Lvl 4+
              </button>
              <button
                type="button"
                onClick={() => setSpellTab("all")}
                className={cn(
                  "rounded-md px-1.5 sm:px-2 py-0.5 text-[0.625rem] sm:text-xs font-bold transition-all",
                  spellTab === "all" ? "bg-cyan-500 text-slate-950 shadow" : "text-white/60 hover:text-white",
                )}
              >
                All
              </button>
            </div>
          </div>
        </div>

        {/* Action Buttons Grid (Smooth Touch Scrollable on Mobile) */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 max-h-48 sm:max-h-40 overflow-y-auto overscroll-contain touch-pan-y pr-1 pb-1 scrollbar-thin scrollbar-thumb-white/20">
          {/* Standard Weapon Attack */}
          <button
            type="button"
            onClick={() => executePlayerAction({ type: "attack" })}
            className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 rounded-xl border border-amber-500/40 bg-amber-500/15 p-2 sm:p-2.5 font-bold text-amber-200 transition-all hover:bg-amber-500/30 active:scale-95 text-center min-h-[3.25rem]"
          >
            <Sword size={15} />
            <span className="text-[0.6875rem] sm:text-xs">Weapon ({martialAttacks}×)</span>
          </button>

          {/* Dynamic Spells and Cantrips */}
          {visibleSpells.map((spell) => {
            const isCantrip = spell.level === 0;
            const diceScaling = isCantrip ? `${cantripScaling(playerLevel)}${spell.damageDie || "d10"}` : `${spell.diceCount || 8}${spell.damageDie || "d6"}`;

            return (
              <button
                key={spell.id}
                type="button"
                onClick={() =>
                  executePlayerAction({
                    type: isCantrip ? "cantrip" : "spell",
                    spellId: spell.id,
                    cantripId: spell.id,
                  })
                }
                className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 rounded-xl border border-cyan-500/30 bg-cyan-950/40 p-2 sm:p-2.5 font-bold text-cyan-200 transition-all hover:border-cyan-400 hover:bg-cyan-900/50 active:scale-95 text-center min-h-[3.25rem]"
                title={spell.description}
              >
                {getSpellIcon(spell)}
                <span className="text-[0.6875rem] sm:text-xs truncate w-full px-0.5 leading-tight">{spell.name}</span>
                <span className="text-[0.5625rem] sm:text-[0.625rem] text-cyan-300/70 leading-none">
                  {spell.type === "save" ? `DC ${spellDc} ${spell.saveStat?.toUpperCase()} Save` : diceScaling}
                </span>
              </button>
            );
          })}

          {/* Dodge Action */}
          <button
            type="button"
            onClick={() => executePlayerAction({ type: "dodge" })}
            className="flex flex-col items-center justify-center gap-0.5 sm:gap-1 rounded-xl border border-blue-500/40 bg-blue-500/15 p-2 sm:p-2.5 font-bold text-blue-200 transition-all hover:bg-blue-500/30 active:scale-95 text-center min-h-[3.25rem]"
          >
            <Shield size={15} />
            <span className="text-[0.6875rem] sm:text-xs">Dodge (Evade)</span>
          </button>
        </div>
      </div>

      {/* ── Quick Stat & Level Editor Modal ── */}
      {editingCombatant && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4">
          <div className="w-full max-w-lg rounded-2xl border border-cyan-500/40 bg-slate-900 p-4 sm:p-6 shadow-2xl">
            <div className="mb-3 sm:mb-4 flex items-center justify-between border-b border-white/10 pb-2 sm:pb-3">
              <h3 className="text-base sm:text-lg font-bold text-cyan-200">Edit D&D Stats: {editingCombatant.name}</h3>
              <button
                type="button"
                onClick={handleSaveModal}
                className="rounded-lg bg-white/10 p-1.5 text-white/70 hover:bg-white/20"
              >
                <Check size={18} />
              </button>
            </div>

            <div className="space-y-3 sm:space-y-4 max-h-[75vh] overflow-y-auto pr-1 overscroll-contain">
              {/* Class Selection */}
              <div className="rounded-xl bg-black/40 p-2.5 sm:p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold text-white">
                    <User size={14} className="text-cyan-300" />
                    <span>D&D Class</span>
                  </div>
                  <span className="text-[0.6875rem] sm:text-xs font-semibold text-cyan-300">
                    Casting: {primaryCastingStat(editingCombatant.unitClass).toUpperCase()}
                  </span>
                </div>

                {/* Freeform input */}
                <input
                  type="text"
                  value={editingCombatant.unitClass}
                  onChange={(e) => updateCombatantStat(editingCombatant.id, "unitClass", e.target.value)}
                  placeholder="e.g. Warlock, Wizard, Rogue..."
                  className="mb-2 w-full rounded-lg border border-white/10 bg-slate-950 px-2.5 py-1 sm:py-1.5 text-xs sm:text-sm font-bold text-white outline-none focus:border-cyan-400"
                />

                {/* Quick select pills */}
                <div className="flex flex-wrap gap-1">
                  {CLASS_OPTIONS.map((cls) => {
                    const isSelected = editingCombatant.unitClass.toLowerCase() === cls.name.toLowerCase();
                    return (
                      <button
                        key={cls.name}
                        type="button"
                        onClick={() => updateCombatantStat(editingCombatant.id, "unitClass", cls.name)}
                        className={cn(
                          "rounded-md px-1.5 sm:px-2 py-0.5 sm:py-1 text-[0.625rem] sm:text-[0.6875rem] font-bold transition-all",
                          isSelected
                            ? "bg-cyan-500 text-slate-950 shadow"
                            : "bg-white/5 text-white/70 hover:bg-white/15 hover:text-white",
                        )}
                      >
                        {cls.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Level Control */}
              <div className="flex items-center justify-between rounded-xl bg-black/40 p-2.5 sm:p-3">
                <div>
                  <div className="text-xs sm:text-sm font-bold text-white">Character Level</div>
                  <div className="text-[0.6875rem] text-white/50">
                    Proficiency: +{proficiencyBonus(editingCombatant.level)} | Cantrips: {cantripScaling(editingCombatant.level)}×
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => updateCombatantStat(editingCombatant.id, "level", editingCombatant.level - 1)}
                    className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                  >
                    <ChevronDown size={15} />
                  </button>
                  <span className="w-6 text-center text-base sm:text-lg font-bold text-cyan-300">{editingCombatant.level}</span>
                  <button
                    type="button"
                    onClick={() => updateCombatantStat(editingCombatant.id, "level", editingCombatant.level + 1)}
                    className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                  >
                    <ChevronUp size={15} />
                  </button>
                </div>
              </div>

              {/* Core Attributes Grid */}
              <div className="grid grid-cols-3 gap-2">
                {(["str", "dex", "con", "int", "wis", "cha"] as const).map((attr) => {
                  const score = editingCombatant.stats[attr];
                  const mod = abilityModifier(score);

                  return (
                    <div key={attr} className="rounded-xl border border-white/10 bg-black/30 p-2 text-center">
                      <div className="text-[0.625rem] font-bold uppercase text-white/60">{attr}</div>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={score}
                        onChange={(e) =>
                          updateCombatantStat(editingCombatant.id, attr, parseInt(e.target.value, 10) || 10)
                        }
                        className="my-0.5 w-full rounded bg-white/10 py-0.5 text-center text-sm sm:text-base font-bold text-white outline-none focus:ring-1 focus:ring-cyan-400"
                      />
                      <div className="text-[0.6875rem] font-semibold text-cyan-300">{formatModifier(mod)}</div>
                    </div>
                  );
                })}
              </div>

              {/* AC & Max HP */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div className="rounded-xl bg-black/40 p-2.5 sm:p-3">
                  <div className="text-[0.6875rem] font-bold uppercase text-white/60">Armor Class (AC)</div>
                  <input
                    type="number"
                    min={1}
                    value={editingCombatant.ac}
                    onChange={(e) => updateCombatantStat(editingCombatant.id, "ac", parseInt(e.target.value, 10) || 10)}
                    className="mt-1 w-full rounded bg-white/10 py-1 text-center text-sm sm:text-base font-bold text-amber-200 outline-none"
                  />
                </div>
                <div className="rounded-xl bg-black/40 p-2.5 sm:p-3">
                  <div className="text-[0.6875rem] font-bold uppercase text-white/60">Max HP</div>
                  <input
                    type="number"
                    min={1}
                    value={editingCombatant.maxHp}
                    onChange={(e) =>
                      updateCombatantStat(editingCombatant.id, "maxHp", parseInt(e.target.value, 10) || 10)
                    }
                    className="mt-1 w-full rounded bg-white/10 py-1 text-center text-sm sm:text-base font-bold text-emerald-300 outline-none"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleSaveModal}
                className="w-full rounded-xl bg-cyan-500 py-2 sm:py-2.5 text-xs sm:text-sm font-bold text-slate-950 transition-all hover:bg-cyan-400"
              >
                Save & Return to Battle
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Flee Confirm Modal ── */}
      {fleeConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-white/15 bg-slate-900 p-5 text-center shadow-2xl">
            <Flag className="mx-auto mb-2 h-7 w-7 text-red-400" />
            <h4 className="mb-2 text-base font-bold text-white">Flee From Battle?</h4>
            <p className="mb-4 text-xs text-white/70">
              Your party will disengage and retreat back to exploration mode.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setFleeConfirm(false);
                  executePlayerAction({ type: "flee" });
                }}
                className="flex-1 rounded-xl bg-red-600 py-2 text-xs font-bold text-white hover:bg-red-500"
              >
                Flee
              </button>
              <button
                type="button"
                onClick={() => setFleeConfirm(false)}
                className="flex-1 rounded-xl bg-white/10 py-2 text-xs font-bold text-white hover:bg-white/20"
              >
                Stay & Fight
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Victory / Defeat Outcome Overlay ── */}
      {dndState.outcome && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center backdrop-blur">
          {dndState.outcome === "victory" && (
            <>
              <Trophy className="h-16 w-16 text-amber-300 animate-bounce" />
              <h2 className="text-3xl font-black uppercase tracking-widest text-amber-300">VICTORY!</h2>
              <p className="max-w-md text-sm text-white/80">
                All enemies have been defeated! Return to the narrative to claim your rewards and continue your journey.
              </p>
            </>
          )}
          {dndState.outcome === "defeat" && (
            <>
              <Skull className="h-16 w-16 text-red-400" />
              <h2 className="text-3xl font-black uppercase tracking-widest text-red-400">DEFEAT</h2>
              <p className="max-w-md text-sm text-white/80">
                Your party was overwhelmed. Return to the GM to narrate the aftermath.
              </p>
            </>
          )}
          {dndState.outcome === "fled" && (
            <>
              <Flag className="h-16 w-16 text-cyan-300" />
              <h2 className="text-3xl font-black uppercase tracking-widest text-cyan-300">RETREAT</h2>
              <p className="max-w-md text-sm text-white/80">You successfully disengaged and fled from combat.</p>
            </>
          )}

          <button
            type="button"
            onClick={handleEndBattle}
            className="mt-2 rounded-xl bg-white px-6 py-2.5 text-sm font-bold text-slate-950 shadow-lg transition-all hover:bg-white/90"
          >
            Continue Story
          </button>
        </div>
      )}
    </div>
  );
}
