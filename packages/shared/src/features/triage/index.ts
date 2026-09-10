// ──────────────────────────────────────────────
// Triage Combat — public API
// ──────────────────────────────────────────────
export * from "./types.js";
export { ACTION_CATALOG, DIFFERENTIAL_CATALOG, BASELINE_ACTION_IDS, actionById, differentialName } from "./catalog.js";
export {
  createTriageState,
  commitAction,
  endRound,
  fleeTriage,
  autoResolveTriage,
  buildTriageSummary,
} from "./engine.js";
