// ──────────────────────────────────────────────
// Triage Combat — pure engine
// ──────────────────────────────────────────────
// Every function is pure: state in → new state out. Randomness flows through a
// tiny local seeded PRNG (same mulberry32 pattern the tactical-combat engine
// uses, kept as its own copy per this codebase's existing convention of each
// mini-engine owning its own RNG — see tactical-combat/rng.ts's comment).
// Client-authoritative (like the D&D 5e combat engine): no server round-trip
// per action, so the same seed + action sequence always reproduces the same
// case, refresh-safe via the persisted TriageState snapshot.

import type { CombatSummary } from "../../types/game.js";
import { ACTION_CATALOG, DIFFERENTIAL_CATALOG, BASELINE_ACTION_IDS, actionById, differentialName } from "./catalog.js";
import type {
  TriageActionDef,
  TriageCaseSeed,
  TriageDebrief,
  TriageDifferentialRuntime,
  TriageLogEntry,
  TriageOutcome,
  TriagePendingOrder,
  TriageState,
  TriageVitals,
} from "./types.js";

// ── Local seeded RNG (mulberry32) ──

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveSubSeed(seed: number, cursor: number): number {
  let z = (seed + Math.imul(cursor + 1, 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

function rngFor(state: TriageState): () => number {
  return mulberry32(deriveSubSeed(state.seed, state.actionCounter));
}

const MAX_ROUNDS = 12;
const NATURAL_CRASH_DRIFT = 5;
const WRONG_TREATMENT_HARM = 20;
const STABILIZE_CRASH_THRESHOLD = 15;

/** Offset kept well clear of `actionCounter`'s cursor space so hand-seeding never collides with action RNG. */
const HAND_SEED_OFFSET = 1_000_000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function clampVitals(v: TriageVitals): TriageVitals {
  return {
    map: clamp(Math.round(v.map), 0, 140),
    spo2: clamp(Math.round(v.spo2), 0, 100),
    gcs: clamp(Math.round(v.gcs), 3, 15),
    crash: clamp(Math.round(v.crash), 0, 100),
  };
}

function log(state: TriageState, kind: TriageLogEntry["kind"], text: string): TriageLogEntry[] {
  return [...state.log, { round: state.round, kind, text }];
}

/** Build the initial engine state from an LLM-invented case seed + the actual runtime party. */
export function createTriageState(
  caseSeed: TriageCaseSeed,
  seed: number,
  party: { partyNames: string[]; skillBonus?: number; skillSourceCharacterIds?: string[] } = { partyNames: [] },
): TriageState {
  const shownIds = [caseSeed.correctDifferentialId, ...caseSeed.redHerringDifferentialIds];
  const differentials: TriageDifferentialRuntime[] = shownIds.map((id) => ({
    id,
    name: differentialName(id),
    status: "unknown",
    clue: null,
  }));
  const partyNames = party.partyNames.length > 0 ? party.partyNames : ["Trauma Team"];
  const skillBonus = clamp(party.skillBonus ?? 0, 0, 5);

  const base: TriageState = {
    seed,
    actionCounter: 0,
    round: 1,
    maxRounds: MAX_ROUNDS,
    patientName: caseSeed.patientName,
    presentation: caseSeed.presentation,
    vitals: clampVitals(caseSeed.startingVitals),
    apPerRound: 3,
    apRemaining: 3,
    correctDifferentialId: caseSeed.correctDifferentialId,
    clues: caseSeed.clues,
    differentials,
    pendingOrders: [],
    treatedCorrectly: false,
    wrongTreatmentCount: 0,
    log: [
      {
        round: 1,
        kind: "system",
        text: `${partyNames.join(", ")} take the case: ${caseSeed.patientName} rolls in — ${caseSeed.presentation}`,
      },
    ],
    outcome: null,
    debrief: null,
    handActionIds: [],
    partyNames,
    skillBonus,
    skillSourceCharacterIds: party.skillSourceCharacterIds ?? [],
  };

  return { ...base, handActionIds: computeHand(base) };
}

/** Is this differential's status advanced enough that its definitive treatment may be attempted? */
function isTreatmentEligible(state: TriageState, action: TriageActionDef): boolean {
  if (!action.treatsDifferentialId) return false;
  const target = state.differentials.find((d) => d.id === action.treatsDifferentialId);
  return !!target && (target.status === "suspected" || target.status === "confirmed");
}

/** Would running this diagnostic still tell us something new about this case? */
function isDiagnosticUseful(state: TriageState, action: TriageActionDef): boolean {
  if (!action.diagnosesDifferentialIds) return false;
  return action.diagnosesDifferentialIds.some((id) => {
    const target = state.differentials.find((d) => d.id === id);
    return !!target && target.status !== "confirmed" && target.status !== "ruled_out";
  });
}

/**
 * Engine-only tiering, computed with full knowledge of `correctDifferentialId` — never exposed to the
 * UI. "good" nudges toward the correct call, "bad" is a real, committable trap (a suspected but wrong
 * differential's treatment), "okay" is everything else still legal/useful this round.
 */
function tierOf(state: TriageState, action: TriageActionDef): "good" | "okay" | "bad" {
  if (action.treatsDifferentialId) {
    return action.treatsDifferentialId === state.correctDifferentialId ? "good" : "bad";
  }
  if (action.diagnosesDifferentialIds?.includes(state.correctDifferentialId)) {
    const target = state.differentials.find((d) => d.id === state.correctDifferentialId);
    if (target && target.status === "unknown") return "good";
  }
  return "okay";
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Deal this round's non-baseline hand: up to 2 good / 2 okay / 1 bad, sampled deterministically from
 * a seed derived from the round number (not `actionCounter`, so the hand is stable for the whole round
 * regardless of how many actions get committed within it, and reproducible on a resumed session).
 */
function computeHand(state: TriageState): string[] {
  const rng = mulberry32(deriveSubSeed(state.seed, HAND_SEED_OFFSET + state.round));
  const pool = ACTION_CATALOG.filter(
    (a) => !BASELINE_ACTION_IDS.includes(a.id) && (isTreatmentEligible(state, a) || isDiagnosticUseful(state, a)),
  );
  const good = pool.filter((a) => tierOf(state, a) === "good");
  const bad = pool.filter((a) => tierOf(state, a) === "bad");
  const okay = pool.filter((a) => tierOf(state, a) === "okay");
  const picked = [
    ...shuffle(good, rng).slice(0, 2),
    ...shuffle(okay, rng).slice(0, 2),
    ...shuffle(bad, rng).slice(0, 1),
  ];
  return Array.from(new Set(picked.map((a) => a.id)));
}

interface CommitResult {
  state: TriageState;
  ok: boolean;
  error?: string;
}

/** Commit one action: deduct AP, resolve instant effects now or queue a pending order. */
export function commitAction(state: TriageState, actionId: string): CommitResult {
  if (state.outcome) return { state, ok: false, error: "The case has already ended." };
  const action = actionById(actionId);
  if (!action) return { state, ok: false, error: "Unknown action." };
  if (action.apCost > state.apRemaining) return { state, ok: false, error: "Not enough staff bandwidth this round." };

  if (action.treatsDifferentialId) {
    const target = state.differentials.find((d) => d.id === action.treatsDifferentialId);
    if (!target || target.status === "unknown") {
      return { state, ok: false, error: "Suspect it first — run a diagnostic." };
    }
    if (target.status === "ruled_out") {
      return { state, ok: false, error: "Already ruled out." };
    }
  }

  let next: TriageState = {
    ...state,
    apRemaining: state.apRemaining - action.apCost,
    actionCounter: state.actionCounter + 1,
  };

  if (action.speed === "instant") {
    next = resolveInstantAction(next, action);
  } else {
    const order: TriagePendingOrder = {
      id: `${action.id}-${next.actionCounter}`,
      actionId: action.id,
      actionName: action.name,
      roundedAtRound: next.round,
      roundsRemaining: action.latencyRounds,
    };
    next = { ...next, pendingOrders: [...next.pendingOrders, order] };
    next = {
      ...next,
      log: log(next, "action", `Ordered ${action.name} — results in ${action.latencyRounds} round(s).`),
    };
  }

  return { state: checkOutcome(next), ok: true };
}

// A configured Skill/Medicine attribute doesn't change what's correct — it makes a correct call
// land harder (bigger crash-meter swing, stronger vital response), never protects against a wrong one.
function skillMultiplier(state: TriageState): number {
  return 1 + state.skillBonus * 0.1;
}

function resolveInstantAction(state: TriageState, action: TriageActionDef): TriageState {
  let vitals = { ...state.vitals };
  let differentials = state.differentials;
  let treatedCorrectly = state.treatedCorrectly;
  let wrongTreatmentCount = state.wrongTreatmentCount;
  let entries: TriageLogEntry[] = [];
  const mult = skillMultiplier(state);

  if (action.treatsDifferentialId) {
    const isCorrect = action.treatsDifferentialId === state.correctDifferentialId;
    if (isCorrect) {
      treatedCorrectly = true;
      vitals.crash = clamp(vitals.crash + Math.round((action.crashDelta ?? -30) * mult), 0, 100);
      applyVitalEffects(vitals, action.vitalEffects, mult);
      differentials = differentials.map((d) =>
        d.id === action.treatsDifferentialId ? { ...d, status: "confirmed", clue: state.clues[d.id] ?? d.clue } : d,
      );
      entries.push({
        round: state.round,
        kind: "result",
        text: `${action.name}: correct call — the patient responds.`,
      });
    } else {
      wrongTreatmentCount += 1;
      vitals.crash = clamp(vitals.crash + WRONG_TREATMENT_HARM, 0, 100);
      vitals.map = clamp(vitals.map - 6, 0, 140);
      differentials = differentials.map((d) =>
        d.id === action.treatsDifferentialId ? { ...d, status: "ruled_out" } : d,
      );
      entries.push({
        round: state.round,
        kind: "escalation",
        text: `${action.name}: wrong call for this patient — the intervention does harm instead of good.`,
      });
    }
  } else {
    applyVitalEffects(vitals, action.vitalEffects, mult);
    if (action.crashDelta) vitals.crash = clamp(vitals.crash + Math.round(action.crashDelta * mult), 0, 100);
    entries.push({ round: state.round, kind: "action", text: `${action.name} performed.` });
  }

  vitals = clampVitals(vitals);
  return {
    ...state,
    vitals,
    differentials,
    treatedCorrectly,
    wrongTreatmentCount,
    log: [...state.log, ...entries],
  };
}

function applyVitalEffects(vitals: TriageVitals, effects: TriageActionDef["vitalEffects"], mult: number): void {
  if (!effects) return;
  if (effects.map) vitals.map += Math.round(effects.map * mult);
  if (effects.spo2) vitals.spo2 += Math.round(effects.spo2 * mult);
  if (effects.gcs) vitals.gcs += Math.round(effects.gcs * mult);
}

/** Advance the clock: resolve due pending orders, apply natural drift, reset AP, check outcome. */
export function endRound(state: TriageState): TriageState {
  if (state.outcome) return state;
  const rng = rngFor(state);

  let differentials = state.differentials;
  let entries: TriageLogEntry[] = [];
  const stillPending: TriagePendingOrder[] = [];

  for (const order of state.pendingOrders) {
    const roundsRemaining = order.roundsRemaining - 1;
    if (roundsRemaining > 0) {
      stillPending.push({ ...order, roundsRemaining });
      continue;
    }
    const action = actionById(order.actionId);
    if (!action?.diagnosesDifferentialIds) {
      entries.push({ round: state.round, kind: "result", text: `${order.actionName} result: inconclusive.` });
      continue;
    }
    for (const diffId of action.diagnosesDifferentialIds) {
      const shown = differentials.find((d) => d.id === diffId);
      if (!shown || shown.status === "confirmed") continue;
      const isCorrect = diffId === state.correctDifferentialId;
      const status = isCorrect ? (action.confirmsOnResolve ? "confirmed" : "suspected") : "ruled_out";
      differentials = differentials.map((d) =>
        d.id === diffId ? { ...d, status, clue: state.clues[d.id] ?? null } : d,
      );
      entries.push({
        round: state.round,
        kind: "result",
        text: isCorrect
          ? `${order.actionName}: findings point toward ${differentialName(diffId)}.`
          : `${order.actionName}: ${differentialName(diffId)} ruled out.`,
      });
    }
  }

  let vitals = { ...state.vitals };
  if (state.treatedCorrectly) {
    vitals.crash = clamp(vitals.crash - Math.round(10 * skillMultiplier(state)), 0, 100);
  } else {
    // Small natural variance so two rounds never feel identical, on top of the steady drift.
    // A configured Skill/Medicine attribute slows the drift a little (faster hands, calmer room).
    const drift = Math.max(2, NATURAL_CRASH_DRIFT - state.skillBonus);
    vitals.crash = clamp(vitals.crash + drift + Math.floor(rng() * 3), 0, 100);
  }
  vitals = clampVitals(vitals);

  let next: TriageState = {
    ...state,
    round: state.round + 1,
    apRemaining: state.apPerRound,
    vitals,
    differentials,
    pendingOrders: stillPending,
    log: [...state.log, ...entries],
  };
  next = { ...next, handActionIds: computeHand(next) };

  return checkOutcome(next);
}

function checkOutcome(state: TriageState): TriageState {
  if (state.outcome) return state;
  if (state.vitals.crash >= 100) {
    return { ...state, outcome: "defeat", debrief: buildDebrief(state, "defeat") };
  }
  if (state.treatedCorrectly && state.vitals.crash <= STABILIZE_CRASH_THRESHOLD) {
    return { ...state, outcome: "victory", debrief: buildDebrief(state, "victory") };
  }
  if (state.round > state.maxRounds) {
    return { ...state, outcome: "defeat", debrief: buildDebrief(state, "defeat") };
  }
  return state;
}

export function buildDebrief(state: TriageState, outcome: TriageOutcome): TriageDebrief {
  if (outcome === "defeat") {
    return { label: "Called It", detail: `${state.patientName} coded. The case didn't go your way this time.` };
  }
  if (outcome === "flee") {
    return { label: "Handed Off", detail: "You handed the case to another team." };
  }
  if (state.wrongTreatmentCount === 0 && state.round <= 5) {
    return { label: "Clean Save", detail: "Textbook trauma response — diagnosed and treated with room to spare." };
  }
  if (state.wrongTreatmentCount === 0) {
    return { label: "Solid Save", detail: `A hard-fought stabilization. ${state.patientName} is going to make it.` };
  }
  return {
    label: "Close Call",
    detail: "It got tense and you second-guessed yourself, but the patient pulled through.",
  };
}

/** Player abandons the case — handed off to another team, no penalty. */
export function fleeTriage(state: TriageState): TriageState {
  if (state.outcome) return state;
  return { ...state, outcome: "flee", debrief: buildDebrief(state, "flee") };
}

const AUTO_RESOLVE_DC = 12;

/**
 * Resolve the rest of the case without interactive play: a single d20 + skillBonus check against a flat
 * DC decides pass/fail, then produces a finished TriageState via the same buildDebrief used for manually
 * played outcomes, so debrief copy stays consistent whether the case was played or auto-resolved.
 */
export function autoResolveTriage(state: TriageState, rng: () => number = Math.random): TriageState {
  if (state.outcome) return state;
  const roll = 1 + Math.floor(rng() * 20);
  const success = roll === 20 ? true : roll === 1 ? false : roll + state.skillBonus >= AUTO_RESOLVE_DC;
  const outcome: TriageOutcome = success ? "victory" : "defeat";

  const nextVitals = clampVitals({
    ...state.vitals,
    crash: success ? clamp(state.vitals.crash - 30, 0, 100) : 100,
  });
  const entry: TriageLogEntry = {
    round: state.round,
    kind: "system",
    text: success
      ? "The team auto-resolves the case — a clean, fast stabilization."
      : "The team auto-resolves the case — despite best efforts, it doesn't go their way.",
  };
  const next: TriageState = {
    ...state,
    round: state.round + 1,
    vitals: nextVitals,
    treatedCorrectly: success,
    log: [...state.log, entry],
    outcome,
  };
  return { ...next, debrief: buildDebrief(next, outcome) };
}

/** Build a CombatSummary-shaped handoff so GameSurface's existing GM-narration recap can consume it unchanged. */
export function buildTriageSummary(state: TriageState): CombatSummary {
  const stability = clamp(100 - state.vitals.crash, 0, 100);
  return {
    outcome: state.outcome ?? "defeat",
    rounds: state.round,
    subjectName: state.patientName,
    outcomeNote: state.debrief ? `${state.debrief.label}: ${state.debrief.detail}` : undefined,
    party: state.partyNames.map((name) => ({
      name,
      hp: stability,
      maxHp: 100,
      ko: state.outcome === "defeat",
      statusEffects: state.treatedCorrectly ? ["Stabilized"] : [],
    })),
    enemies: DIFFERENTIAL_CATALOG.filter((d) => state.differentials.some((shown) => shown.id === d.id)).map((d) => ({
      name: d.name,
      defeated: d.id === state.correctDifferentialId && state.treatedCorrectly,
      hp: d.id === state.correctDifferentialId ? clamp(state.vitals.crash, 0, 100) : 0,
      maxHp: 100,
    })),
  };
}
