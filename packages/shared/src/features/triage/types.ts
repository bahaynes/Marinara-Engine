// ──────────────────────────────────────────────
// Triage Combat — shared types
// ──────────────────────────────────────────────
// An ATLS "ABCDE" trauma-triage mini-game: turn-based (the clock only advances
// when the player commits an action or ends the round — never live/real-time).
// Deliberately NOT the tactical grid engine: no map, no movement, no positions.
//
// Split of authorship: the ACTION_CATALOG and DIFFERENTIAL_CATALOG (catalog.ts)
// are fixed, hand-authored content — the same real-world toolkit and closed
// list of possible diagnoses regardless of patient. The LLM invents only the
// CASE per encounter (which differential is correct, two red herrings, the
// patient's presentation/flavor, and starting vitals) via `TriageCaseSeed`.

export type TriageActionCategory = "airway" | "breathing" | "circulation" | "drugs" | "diagnostics";

/** Latency tier: instant effects land immediately; bedside/formal orders resolve at a future round-end. */
export type TriageActionSpeed = "instant" | "bedside" | "formal";

export interface TriageActionDef {
  id: string;
  name: string;
  category: TriageActionCategory;
  speed: TriageActionSpeed;
  /** Staff bandwidth cost, out of the 3 AP granted per round. */
  apCost: number;
  /** Rounds until a bedside/formal order's result lands. 0 for instant actions. */
  latencyRounds: number;
  description: string;
  /** Set on definitive-treatment actions: the ONE differential this action treats. */
  treatsDifferentialId?: string;
  /** Set on diagnostic actions: which differentials (from the case's shown 3) this action can reveal. */
  diagnosesDifferentialIds?: string[];
  /** CT pan-scan style: a resolved diagnostic order that CONFIRMS (not just "suspects") the true differential. */
  confirmsOnResolve?: boolean;
  /** Generic supportive vital nudge applied on a successful instant action (not tied to a differential). */
  vitalEffects?: Partial<Record<"map" | "spo2" | "gcs", number>>;
  /** Crash-meter delta applied on success (negative = improves). Definitive treatments use this for the big swing. */
  crashDelta?: number;
  /** CT pan-scan / any order that should only be ordered once the patient is reasonably stable. Advisory only in v1 (no forced block, just surfaced in the UI). */
  requiresStablePatient?: boolean;
}

export interface TriageDifferentialDef {
  id: string;
  name: string;
}

export type TriageDifferentialStatus = "unknown" | "suspected" | "ruled_out" | "confirmed";

export interface TriageDifferentialRuntime extends TriageDifferentialDef {
  status: TriageDifferentialStatus;
  /** Revealed once suspected/confirmed/ruled_out. */
  clue: string | null;
}

export interface TriageVitals {
  /** Mean Arterial Pressure — surrogate for blood pressure, roughly 0-140. */
  map: number;
  /** Oxygen saturation, 0-100. */
  spo2: number;
  /** Glasgow Coma Scale, 3-15. */
  gcs: number;
  /** Decompensation meter, 0-100. 100 = cardiac arrest (defeat). */
  crash: number;
}

export interface TriagePendingOrder {
  id: string;
  actionId: string;
  actionName: string;
  roundedAtRound: number;
  roundsRemaining: number;
}

export type TriageLogKind = "system" | "action" | "result" | "vital" | "escalation";

export interface TriageLogEntry {
  round: number;
  kind: TriageLogKind;
  text: string;
}

/** What the GM (LLM) invents per encounter — the case, not the mechanics. */
export interface TriageCaseSeed {
  patientName: string;
  /** One-line presenting complaint, e.g. "28M, GSW to abdomen, altered mental status." */
  presentation: string;
  startingVitals: TriageVitals;
  correctDifferentialId: string;
  redHerringDifferentialIds: [string, string];
  /** Flavor clue text revealed once a differential is suspected/confirmed/ruled out, keyed by differential id. */
  clues: Record<string, string>;
}

export type TriageOutcome = "victory" | "defeat" | "flee";

export interface TriageDebrief {
  label: string;
  detail: string;
}

export interface TriageState {
  seed: number;
  actionCounter: number;
  round: number;
  maxRounds: number;
  patientName: string;
  presentation: string;
  vitals: TriageVitals;
  apPerRound: number;
  apRemaining: number;
  correctDifferentialId: string;
  /** Carried from the case seed so a restored (page-refresh) snapshot can still resolve actions without re-fetching. */
  clues: Record<string, string>;
  differentials: TriageDifferentialRuntime[];
  pendingOrders: TriagePendingOrder[];
  treatedCorrectly: boolean;
  wrongTreatmentCount: number;
  log: TriageLogEntry[];
  outcome: TriageOutcome | null;
  debrief: TriageDebrief | null;
  /**
   * Non-baseline action ids currently on offer this round (diagnostics/treatments beyond the always-
   * available generic supportive actions). Recomputed once per round from a deterministic, seeded
   * selection — never client-random — so a resumed session sees the same hand for the same round.
   * Tier composition (roughly 2 helpful / 2 neutral / 1 trap, biased by the hidden correct differential)
   * is engine-internal only: nothing about which tier an id came from is exposed here or in the UI.
   */
  handActionIds: string[];
  /** The actual runtime party (persona + party characters) leading the case — not LLM-invented. */
  partyNames: string[];
  /**
   * Optional 0-5 bonus derived from a "Skill" / "Medicine" RPG attribute configured on the persona
   * or a party character (same 8-20-scale, 10-is-average convention used elsewhere in this app).
   * Scales successful-action effect magnitude and slows natural vital drift — lets the mini-game
   * grow with the user's character sheet instead of always playing at a flat difficulty. 0 if unset.
   */
  skillBonus: number;
  /** Character id(s) whose Skill/Medicine attribute produced skillBonus — credited for stat growth on victory. */
  skillSourceCharacterIds: string[];
}

/** Request body for POST /api/encounter/triage-init. */
export interface TriageInitRequest {
  chatId: string;
  connectionId: string | null;
  debugMode?: boolean;
  /** Last few cases from this chat's triage history (client-persisted), used to steer the GM away from repeats. */
  recentPresentations?: { patientName: string; flavor: string }[];
}

/** Server response for POST /api/encounter/triage-init. */
export interface TriageInitResponse {
  case: TriageCaseSeed;
  /** The actual runtime party (persona + party characters), parsed the same way classic/tactical combat does. */
  partyNames: string[];
  /** See TriageState.skillBonus. */
  skillBonus: number;
  /** See TriageState.skillSourceCharacterIds. */
  skillSourceCharacterIds: string[];
  /** The scenario-setting flavor randomly chosen for this case (independent of the diagnosis) — echoed back so the client can track it in `recentPresentations` for next time. */
  flavor: string;
}
