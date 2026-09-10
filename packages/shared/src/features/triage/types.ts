// ──────────────────────────────────────────────
// Triage Combat — shared types
// ──────────────────────────────────────────────
// An ATLS "ABCDE" trauma-triage mini-game: turn-based (the clock only advances
// when the player commits an action or ends the round — never live/real-time).
// Deliberately NOT the tactical grid engine: no map, no movement, no positions.
//
// Scoped to the acute stabilization window only — the "got to save someone right
// now" moment, not the whole case workup. Anything that takes real wait time in
// reality (formal labs, imaging) doesn't belong in a live turn loop measured in
// single-digit rounds; that's the kind of "results come back next scene" beat
// narrative prose already handles well (see TriageDebrief.recommendedWorkup).
// That's why every action here is either instant or a short (1-round) bedside
// order — there is no slower "formal" tier.
//
// Split of authorship: the ACTION_CATALOG and DIFFERENTIAL_CATALOG (catalog.ts)
// are fixed, hand-authored content — the same real-world toolkit and closed
// list of possible diagnoses regardless of patient. The LLM invents only the
// CASE per encounter (which differential is correct, two red herrings, the
// patient's presentation/flavor, and starting vitals) via `TriageCaseSeed`.

export type TriageActionCategory = "airway" | "breathing" | "circulation" | "drugs" | "diagnostics";

/** instant effects land immediately; bedside orders resolve one round later. */
export type TriageActionSpeed = "instant" | "bedside";

export interface TriageActionDef {
  id: string;
  name: string;
  category: TriageActionCategory;
  speed: TriageActionSpeed;
  /** Staff bandwidth cost, out of the 3 AP granted per round. */
  apCost: number;
  /** Rounds until a bedside order's result lands. 0 for instant actions. */
  latencyRounds: number;
  description: string;
  /** Set on definitive-treatment actions: the ONE differential this action treats. */
  treatsDifferentialId?: string;
  /** Set on diagnostic actions: which differentials (from the case's shown 3) this action can reveal. */
  diagnosesDifferentialIds?: string[];
  /** Generic supportive vital nudge applied on a successful instant action (not tied to a differential). */
  vitalEffects?: Partial<Record<"map" | "spo2" | "gcs", number>>;
  /** Crash-meter delta applied on success (negative = improves). Definitive treatments use this for the big swing. */
  crashDelta?: number;
}

export interface TriageDifferentialDef {
  id: string;
  name: string;
  /** GM-facing matching aid only (never shown to the player) — helps the case-generation prompt map a
   *  presenting mechanism/complaint onto the correct closed-list id instead of guessing. */
  hint?: string;
  /**
   * Player- and GM-facing follow-up workup for this diagnosis (confirmatory imaging, formal labs, the
   * relevant specialist) — the mini-game only plays out the acute stabilization; this is the "handed
   * back to the narrative LLM" tail the real case would still need, surfaced via TriageDebrief so the
   * GM can carry it into later scenes instead of the mini-game trying to simulate real wait times.
   */
  recommendedWorkup?: string;
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
  /** Follow-up workup to hand to the GM for narration in later scenes — see TriageDifferentialDef.recommendedWorkup. */
  recommendedWorkup?: string;
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
  /**
   * Patient name the GM named directly in the triggering `[state: combat patient="Name"]` tag, if any.
   * When present, this is authoritative — the case-generation prompt is told to continue this exact
   * patient rather than re-inferring "who's the patient" from raw chat history, which is what let a
   * more recently introduced patient silently displace one already being treated.
   */
  patientHint?: string;
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
