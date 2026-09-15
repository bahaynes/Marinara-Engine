// ──────────────────────────────────────────────
// Triage Combat — ATLS trauma-triage mini-game UI
// ──────────────────────────────────────────────
// No grid, no movement, no positions — a vitals monitor, a differential
// notebook, a central case log, and a dealt hand of actions. The clock only
// advances when the player commits an action or ends the round (never live/
// real-time). All game logic lives in the pure shared engine (packages/
// shared/src/features/triage); this component is a thin renderer + button
// dispatcher. It never reveals which hand card the engine considers "good" —
// that tiering is engine-internal only (see engine.ts's computeHand).
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Clock,
  Heart,
  Stethoscope,
  Wind,
  Syringe,
  FlaskConical,
  Flag,
  Trophy,
  SkullIcon,
  LifeBuoy,
  XCircle,
  FastForward,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import { ACTION_CATALOG, BASELINE_ACTION_IDS } from "@marinara-engine/shared";
import type { TriageActionCategory, TriageActionDef, TriageLogKind, TriageState } from "@marinara-engine/shared";
import { useTranslation as useUiTranslation } from "react-i18next";

interface TriageCombatUIProps {
  state: TriageState;
  onCommitAction: (actionId: string) => void;
  onEndRound: () => void;
  onFlee: () => void;
  /** Statistically resolve the rest of the case from the party's skill, without interactive play. */
  onAutoResolve: () => void;
  /** Discard the case entirely — no chat post, no journal entry; also deletes the GM turn that started it. */
  onCancel: () => void;
  onContinue: () => void;
}

const CATEGORY_ICON: Record<TriageActionCategory, typeof Wind> = {
  airway: Wind,
  breathing: Stethoscope,
  circulation: Heart,
  drugs: Syringe,
  diagnostics: FlaskConical,
};

const SPEED_LABEL: Record<TriageActionDef["speed"], string> = {
  instant: "Instant",
  bedside: "1 round",
};

function vitalTone(value: number, low: number, high: number): string {
  if (value < low || value > high) return "text-red-400";
  return "text-emerald-400";
}

function crashTone(crash: number): string {
  if (crash >= 70) return "bg-red-500";
  if (crash >= 40) return "bg-amber-500";
  return "bg-emerald-500";
}

function logKindClass(kind: TriageLogKind): string {
  if (kind === "escalation") return "font-semibold text-red-300";
  if (kind === "result") return "text-emerald-300";
  if (kind === "system") return "font-bold text-amber-200";
  if (kind === "action") return "text-sky-300";
  return "italic text-slate-400";
}

type EcgRegime = "calm" | "elevated" | "critical";

function ecgRegime(crash: number): EcgRegime {
  if (crash >= 60) return "critical";
  if (crash >= 30) return "elevated";
  return "calm";
}

const ECG_PATH: Record<EcgRegime, string> = {
  calm: "M0,15 Q12.5,5 25,15 T50,15 T75,15 T100,15",
  elevated: "M0,15 L8,15 L11,3 L14,26 L17,15 L40,15 L44,9 L48,15 L100,15",
  critical:
    "M0,15 L4,4 L8,25 L12,2 L16,22 L20,15 L26,5 L31,27 L36,10 L42,15 L50,3 L56,26 L62,9 L70,18 L78,4 L86,23 L94,12 L100,15",
};

const ECG_DURATION: Record<EcgRegime, string> = { calm: "3.5s", elevated: "1.8s", critical: "0.9s" };
const ECG_COLOR: Record<EcgRegime, string> = { calm: "#34d399", elevated: "#fbbf24", critical: "#f87171" };

/**
 * "I'm not a doctor" coaching hint — general triage strategy nudges, NEVER the answer.
 * Points toward a category of move given the current board state, same way a charge
 * nurse might talk a new resident through it, without naming the actual diagnosis.
 */
function coachingHint(state: TriageState): string {
  const { vitals } = state;
  const anyConfirmed = state.differentials.some((d) => d.status === "confirmed");
  if (anyConfirmed) {
    return "You've confirmed the diagnosis — commit to its definitive treatment now. Every round you stall, the crash meter keeps creeping.";
  }
  if (vitals.spo2 < 88 || vitals.gcs < 9) {
    return "Airway and breathing come before everything else in ATLS — an Airway or Breathing action buys you time to think, even before you know what's wrong.";
  }
  if (vitals.crash >= 60) {
    return "The crash meter is climbing fast. A generic Circulation support action (fluids, a pressor) buys time without committing to a diagnosis you're not sure of yet.";
  }
  const anySuspected = state.differentials.some((d) => d.status === "suspected");
  if (!anySuspected) {
    return "Nothing's suspected yet — run a Diagnostics action (an instant bedside check is fastest) before you commit to a definitive treatment. Guessing wrong on an invasive treatment costs you.";
  }
  return "You've got a lead. One more diagnostic to confirm it is usually safer than committing to a definitive treatment on a hunch — but don't wait too many rounds.";
}

export function TriageCombatUI({
  state,
  onCommitAction,
  onEndRound,
  onFlee,
  onAutoResolve,
  onCancel,
  onContinue,
}: TriageCombatUIProps) {
  const { t: localizeUi } = useUiTranslation();
  const [fleeConfirm, setFleeConfirm] = useState(false);
  const [autoResolveConfirm, setAutoResolveConfirm] = useState(false);
  const [cancelConfirm, setCancelConfirm] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [expandedActionId, setExpandedActionId] = useState<string | null>(null);
  const { vitals } = state;

  // Auto-advance the round once AP is spent — the clock only needs a human decision when
  // there's still something to spend it on. Guarded by round number so it fires exactly once
  // per round even if this re-renders before the round actually increments.
  const autoEndedRoundRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.outcome) return;
    if (state.apRemaining > 0) return;
    if (autoEndedRoundRef.current === state.round) return;
    autoEndedRoundRef.current = state.round;
    const t = setTimeout(onEndRound, 700);
    return () => clearTimeout(t);
  }, [state.outcome, state.apRemaining, state.round, onEndRound]);

  // Screen juice: shake + a color flash on the round's newest log entries, so a crash-meter
  // spike or a confirmed treatment reads as an EVENT, not a spreadsheet row updating.
  const [shake, setShake] = useState(false);
  const [flash, setFlash] = useState<"good" | "bad" | null>(null);
  const seenLogCountRef = useRef(state.log.length);
  useEffect(() => {
    const prevCount = seenLogCountRef.current;
    seenLogCountRef.current = state.log.length;
    if (state.log.length <= prevCount) return;
    const newEntries = state.log.slice(prevCount);
    const bad = newEntries.some((e) => e.kind === "escalation");
    const good = newEntries.some((e) => e.kind === "result");
    if (!bad && !good) return;
    setFlash(bad ? "bad" : "good");
    setShake(bad);
    const t = setTimeout(() => {
      setFlash(null);
      setShake(false);
    }, 550);
    return () => clearTimeout(t);
  }, [state.log]);

  // The case log is the screen's centerpiece now — keep it pinned to the newest entry.
  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [state.log.length]);

  const regime = ecgRegime(vitals.crash);
  const baselineActions = ACTION_CATALOG.filter((a) => BASELINE_ACTION_IDS.includes(a.id));
  const handActions = state.handActionIds
    .map((id) => ACTION_CATALOG.find((a) => a.id === id))
    .filter((a): a is TriageActionDef => !!a);

  function actionBlockReason(action: TriageActionDef): string | null {
    if (action.apCost > state.apRemaining) return localizeUi("ui.game.triagecombatui.notEnoughApThisRound");
    if (action.treatsDifferentialId) {
      const target = state.differentials.find((d) => d.id === action.treatsDifferentialId);
      if (!target || target.status === "unknown")
        return localizeUi("ui.game.triagecombatui.suspectItFirstRunADiagnostic");
      if (target.status === "ruled_out") return localizeUi("ui.game.triagecombatui.alreadyRuledOut");
    }
    return null;
  }

  function renderActionCard(action: TriageActionDef) {
    const blockReason = state.outcome ? "" : actionBlockReason(action);
    const disabled = !!state.outcome || !!blockReason;
    const CatIcon = CATEGORY_ICON[action.category];
    const expanded = expandedActionId === action.id;
    return (
      <div key={action.id} className="flex flex-col items-start">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onCommitAction(action.id)}
          title={action.description}
          className={cn(
            "inline-flex w-full flex-col items-start gap-0.5 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-left text-xs font-semibold text-white/85 transition-colors hover:bg-white/10 sm:w-auto",
            disabled && "cursor-not-allowed opacity-40 hover:bg-black/30",
          )}
        >
          <span className="flex items-center gap-1.5">
            <CatIcon size={11} className="shrink-0 text-white/50" />
            {action.name}
          </span>
          <span className="text-[0.6rem] font-normal text-white/50">
            {action.apCost} {localizeUi("ui.game.triagecombatui.ap_e1462c8")} {SPEED_LABEL[action.speed]}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setExpandedActionId(expanded ? null : action.id)}
          className="mt-0.5 text-[0.6rem] text-white/40 underline decoration-dotted hover:text-white/70"
        >
          {expanded ? localizeUi("ui.game.triagecombatui.hideDetails") : localizeUi("ui.game.triagecombatui.whatSThis")}
        </button>
        {expanded && (
          <div className="mt-1 max-w-[14rem] rounded-lg border border-white/10 bg-white/5 p-2 text-[0.65rem] leading-relaxed text-white/70">
            {action.description}
            {blockReason && <div className="mt-1 font-semibold text-amber-300">{blockReason}</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-950/70 text-white",
        shake && "tc-shake",
      )}
    >
      <style>{`
        @keyframes tc-shake {
          10%, 90% { transform: translate3d(-1px, 0, 0); }
          20%, 80% { transform: translate3d(2px, 0, 0); }
          30%, 50%, 70% { transform: translate3d(-4px, 0, 0); }
          40%, 60% { transform: translate3d(4px, 0, 0); }
        }
        .tc-shake { animation: tc-shake 0.5s cubic-bezier(.36,.07,.19,.97) both; }
        @keyframes tc-ecg-scroll {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
      `}</style>
      {flash && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-30 animate-pulse",
            flash === "bad" ? "bg-red-500/20" : "bg-emerald-400/15",
          )}
        />
      )}
      {/* Vitals monitor strip */}
      <div className="z-20 flex shrink-0 flex-wrap items-center gap-4 border-b border-white/10 bg-black/50 px-4 py-2.5 backdrop-blur">
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <Heart size={14} className={vitalTone(vitals.map, 60, 120)} />
          <span className={vitalTone(vitals.map, 60, 120)}>
            {localizeUi("ui.game.triagecombatui.map")} {vitals.map}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <Activity size={14} className={vitalTone(vitals.spo2, 90, 100)} />
          <span className={vitalTone(vitals.spo2, 90, 100)}>
            {localizeUi("ui.game.triagecombatui.spo2")} {vitals.spo2}%
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm font-bold">
          <AlertTriangle size={14} className={vitalTone(vitals.gcs, 13, 15)} />
          <span className={vitalTone(vitals.gcs, 13, 15)}>
            {localizeUi("ui.game.triagecombatui.gcs")} {vitals.gcs}
          </span>
        </div>
        <div className="flex min-w-[9rem] flex-1 items-center gap-2">
          <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-white/50">
            {localizeUi("ui.game.triagecombatui.crash")}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/60">
            <div
              className={cn("h-full transition-all duration-500", crashTone(vitals.crash))}
              style={{ width: `${vitals.crash}%` }}
            />
          </div>
          <span className="text-xs font-bold text-white/70">{vitals.crash}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-white/70">
            {localizeUi("ui.game.gamecombatui.round")} {state.round}
          </span>
          {!state.outcome && (
            <button
              type="button"
              onClick={() => setHintOpen(true)}
              title={localizeUi("ui.game.triagecombatui.iMNotADoctorGetANudge")}
              className="flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-500/10 px-2 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"
            >
              <LifeBuoy size={13} />
              {localizeUi("ui.game.triagecombatui.imNotADoctor")}
            </button>
          )}
          {!state.outcome && (
            <button
              type="button"
              onClick={() => setAutoResolveConfirm(true)}
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
            >
              <FastForward size={13} />
              {localizeUi("ui.game.triagecombatui.autoResolve")}
            </button>
          )}
          {!state.outcome && (
            <button
              type="button"
              onClick={() => setFleeConfirm(true)}
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
            >
              <Flag size={13} />
              {localizeUi("ui.game.triagecombatui.handOff")}
            </button>
          )}
          {!state.outcome && (
            <button
              type="button"
              onClick={() => setCancelConfirm(true)}
              className="flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white/60 hover:bg-white/10"
            >
              <XCircle size={13} />
              {localizeUi("ui.game.triagecombatui.cancelCase")}
            </button>
          )}
        </div>
      </div>

      {/* ECG strip — a compact, code-drawn visual read on the crash meter, not decoration alone */}
      <div className="relative z-10 h-7 w-full shrink-0 overflow-hidden border-b border-white/10 bg-black/50">
        <svg
          className="absolute inset-y-0 left-0 h-full"
          style={{ width: "200%", animation: `tc-ecg-scroll ${ECG_DURATION[regime]} linear infinite` }}
          viewBox="0 0 200 30"
          preserveAspectRatio="none"
        >
          <path d={ECG_PATH[regime]} fill="none" stroke={ECG_COLOR[regime]} strokeWidth={1.5} />
          <path
            d={ECG_PATH[regime]}
            transform="translate(100,0)"
            fill="none"
            stroke={ECG_COLOR[regime]}
            strokeWidth={1.5}
          />
        </svg>
      </div>

      {/* Patient card + differential notebook */}
      <div className="z-10 flex shrink-0 flex-col gap-2 border-b border-white/10 bg-black/30 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-bold">{state.patientName}</p>
          <p className="text-xs text-white/60">{state.presentation}</p>
          <p className="mt-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-white/40">
            {localizeUi("ui.game.triagecombatui.team")} {state.partyNames.join(", ")}
            {state.skillBonus > 0 ? localizeUi("ui.game.triagecombatui.skillValue1", { value1: state.skillBonus }) : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {state.differentials.map((d) => (
            <span
              key={d.id}
              title={d.clue ?? "No findings yet"}
              className={cn(
                "rounded-full px-2 py-1 text-[0.65rem] font-semibold",
                d.status === "confirmed" && "bg-emerald-500/20 text-emerald-300",
                d.status === "suspected" && "bg-amber-500/20 text-amber-300",
                d.status === "ruled_out" && "bg-white/5 text-white/30 line-through",
                d.status === "unknown" && "bg-white/10 text-white/60",
              )}
            >
              {d.name}
            </span>
          ))}
        </div>
      </div>

      {/* Pending orders tray */}
      {state.pendingOrders.length > 0 && (
        <div className="z-10 flex shrink-0 flex-wrap gap-2 border-b border-white/10 bg-black/20 px-4 py-2">
          {state.pendingOrders.map((order) => (
            <span
              key={order.id}
              className="flex items-center gap-1.5 rounded-lg bg-white/5 px-2 py-1 text-[0.7rem] font-semibold text-white/70"
            >
              <Clock size={11} />
              {order.actionName} — {order.roundsRemaining} {localizeUi("ui.game.triagecombatui.round")}
              {order.roundsRemaining === 1 ? "" : localizeUi("ui.noodle.stageprofileview.s")}
            </span>
          ))}
        </div>
      )}

      {/* Central case log — the screen's centerpiece: an auto-scrolling EMR-style feed */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed">
        {state.log.map((entry, i) => (
          <p key={i} className={cn("flex items-baseline gap-2 border-b border-white/5 py-1", logKindClass(entry.kind))}>
            <span className="shrink-0 font-mono text-[0.6rem] text-white/30">
              {localizeUi("ui.game.triagecombatui.r")}
              {entry.round}
            </span>
            <span>{entry.text}</span>
          </p>
        ))}
        <div ref={logEndRef} />
      </div>

      {/* Dealt hand: baseline supportive actions (always available) + this round's rotating hand */}
      <div className="z-20 shrink-0 border-t border-white/10 bg-black/30 px-4 py-2.5">
        <div className="mb-2 flex items-center gap-3 text-xs font-semibold text-white/60">
          <span>
            {localizeUi("ui.game.triagecombatui.ap")} {state.apRemaining}/{state.apPerRound}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {baselineActions.map(renderActionCard)}
          {handActions.map(renderActionCard)}
        </div>
      </div>

      {/* End round */}
      {!state.outcome && (
        <div className="z-20 flex shrink-0 justify-end border-t border-white/10 bg-black/40 px-4 py-2.5">
          <button
            type="button"
            onClick={onEndRound}
            className="rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/20 px-4 py-2 text-sm font-bold text-[var(--primary)] hover:bg-[var(--primary)]/30"
          >
            {localizeUi("ui.game.triagecombatui.endRound")}
          </button>
        </div>
      )}

      {/* "I'm not a doctor" coaching hint — general strategy nudge, never the answer */}
      {hintOpen && (
        <div
          className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setHintOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-sky-400/30 bg-slate-900 p-5 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <LifeBuoy className="mx-auto mb-2 h-6 w-6 text-sky-300" />
            <p className="mb-4 text-sm text-white/90">{coachingHint(state)}</p>
            <button
              type="button"
              onClick={() => setHintOpen(false)}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
            >
              {localizeUi("ui.game.tacticalcombatui.back")}
            </button>
          </div>
        </div>
      )}

      {/* Flee confirm */}
      {fleeConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-slate-900 p-5 text-center">
            <Flag className="mx-auto mb-2 h-6 w-6 text-amber-300" />
            <p className="mb-4 text-sm text-white/90">
              {localizeUi("ui.game.triagecombatui.handThisCaseOffToAnotherTeamTheGm")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setFleeConfirm(false);
                  onFlee();
                }}
                className="flex-1 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/20 px-3 py-2 text-sm font-bold text-[var(--primary)] hover:bg-[var(--primary)]/30"
              >
                {localizeUi("ui.game.triagecombatui.handOff")}
              </button>
              <button
                type="button"
                onClick={() => setFleeConfirm(false)}
                className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
              >
                {localizeUi("ui.game.tacticalcombatui.stay")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auto-resolve confirm */}
      {autoResolveConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-slate-900 p-5 text-center">
            <FastForward className="mx-auto mb-2 h-6 w-6 text-sky-300" />
            <p className="mb-4 text-sm text-white/90">
              {localizeUi("ui.game.triagecombatui.skipInteractivePlayAndLetTheTeamSSkill")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setAutoResolveConfirm(false);
                  onAutoResolve();
                }}
                className="flex-1 rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/20 px-3 py-2 text-sm font-bold text-[var(--primary)] hover:bg-[var(--primary)]/30"
              >
                {localizeUi("ui.game.triagecombatui.autoResolve")}
              </button>
              <button
                type="button"
                onClick={() => setAutoResolveConfirm(false)}
                className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
              >
                {localizeUi("ui.game.tacticalcombatui.stay")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel confirm */}
      {cancelConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-slate-900 p-5 text-center">
            <XCircle className="mx-auto mb-2 h-6 w-6 text-red-400" />
            <p className="mb-4 text-sm text-white/90">
              {localizeUi("ui.game.triagecombatui.discardThisCaseEntirelyAndRemoveTheGmTurn")}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setCancelConfirm(false);
                  onCancel();
                }}
                className="flex-1 rounded-lg border border-red-400/40 bg-red-500/20 px-3 py-2 text-sm font-bold text-red-300 hover:bg-red-500/30"
              >
                {localizeUi("ui.game.triagecombatui.cancelCase")}
              </button>
              <button
                type="button"
                onClick={() => setCancelConfirm(false)}
                className="flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm font-semibold text-white/70 hover:bg-white/10"
              >
                {localizeUi("ui.game.tacticalcombatui.stay")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Outcome screen */}
      {state.outcome && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/85 p-6 text-center backdrop-blur">
          {state.outcome === "victory" && <Trophy className="h-14 w-14 text-amber-300" />}
          {state.outcome === "defeat" && <SkullIcon className="h-14 w-14 text-red-400" />}
          {state.outcome === "flee" && <Flag className="h-14 w-14 text-[var(--primary)]" />}
          <h2
            className={cn(
              "text-2xl font-black uppercase tracking-widest",
              state.outcome === "victory" && "text-amber-300",
              state.outcome === "defeat" && "text-red-400",
              state.outcome === "flee" && "text-[var(--primary)]",
            )}
          >
            {state.debrief?.label ?? state.outcome}
          </h2>
          {state.debrief && <p className="max-w-xs text-sm text-white/70">{state.debrief.detail}</p>}
          {state.debrief?.recommendedWorkup && (
            <p className="max-w-xs text-xs italic text-white/50">
              {localizeUi("ui.game.triagecombatui.stillToCome")} {state.debrief.recommendedWorkup}
            </p>
          )}
          <button
            type="button"
            onClick={onContinue}
            className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
          >
            {localizeUi("ui.noodle.noodlerwizard.continue")}
          </button>
        </div>
      )}
    </div>
  );
}
