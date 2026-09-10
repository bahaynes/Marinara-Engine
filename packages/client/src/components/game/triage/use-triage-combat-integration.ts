// ──────────────────────────────────────────────
// Triage Combat — client integration hook
// ──────────────────────────────────────────────
// Owns everything triage-specific (case init, engine state, chat-metadata
// snapshot persistence, the GM-narration handoff) behind a tiny, stable
// surface so GameSurface.tsx — a huge, fast-moving upstream file — only ever
// needs: one hook call, one early-return branch at its existing combat-start
// call site, and one ternary branch in its render. Nothing else in this
// feature reaches back into GameSurface's internals.
import { useCallback, useMemo, useRef, useState } from "react";
import { createElement, type ReactElement } from "react";
import { toast } from "sonner";
import { api } from "../../../lib/api-client";
import { useUpdateChatMetadata } from "../../../hooks/use-chats";
import { useTransitionGameState } from "../../../hooks/use-game";
import {
  createTriageState,
  commitAction,
  endRound,
  fleeTriage,
  autoResolveTriage,
  buildTriageSummary,
} from "@marinara-engine/shared";
import type { CombatSummary, GameCombatStyle, TriageInitResponse, TriageState } from "@marinara-engine/shared";
import { TriageCombatUI } from "./TriageCombatUI";

type CombatEndHandler = (outcome: "victory" | "defeat" | "flee", summary: CombatSummary) => void;
type CancelHandler = (messageId: string) => void;

interface TriageGrowSkillResponse {
  grown: { characterId: string; characterName: string; attributeName: string; newValue: number }[];
}

export interface UseTriageCombatIntegrationArgs {
  chatId: string | null;
  chatMeta: Record<string, unknown>;
  effectiveCombatStyle: GameCombatStyle;
}

export interface UseTriageCombatIntegrationResult {
  /** Feed into the same render gate the other combat UIs use (`combatUiActive || triageIntegration.active`). */
  active: boolean;
  /** Call from the existing combat-start seam instead of the classic `/encounter/init` path. */
  start: (messageId: string) => void;
  /** Mount when `active` is true. */
  render: () => ReactElement | null;
  /**
   * GameSurface's `handleCombatEnd` is declared later in the file than the combat-start seam this
   * hook is called from, so it can't be passed in as a constructor arg (temporal dead zone). Call
   * this once, unconditionally, right after `handleCombatEnd` is declared — it just refreshes a ref.
   */
  bindOnCombatEnd: (fn: CombatEndHandler) => void;
  /** Same temporal-dead-zone reason bindOnCombatEnd exists — bind GameSurface's message-delete handler. */
  bindOnCancel: (fn: CancelHandler) => void;
}

const SNAPSHOT_KEY = "gameTriageCombatSnapshot";
/** Last few cases' patientName + scenario flavor, fed back to /triage-init so the GM avoids repeating itself. */
const HISTORY_KEY = "gameTriageCaseHistory";
const HISTORY_LIMIT = 5;

type CaseHistoryEntry = { patientName: string; flavor: string };

export function useTriageCombatIntegration(args: UseTriageCombatIntegrationArgs): UseTriageCombatIntegrationResult {
  const { chatId, chatMeta } = args;
  const onCombatEndRef = useRef<CombatEndHandler | null>(null);
  const bindOnCombatEnd = useCallback((fn: CombatEndHandler) => {
    onCombatEndRef.current = fn;
  }, []);
  const onCancelRef = useRef<CancelHandler | null>(null);
  const bindOnCancel = useCallback((fn: CancelHandler) => {
    onCancelRef.current = fn;
  }, []);

  const updateMeta = useUpdateChatMetadata();
  const transitionGameState = useTransitionGameState();

  const snapshot = (chatMeta[SNAPSHOT_KEY] as TriageState | null | undefined) ?? null;
  const [localState, setLocalState] = useState<TriageState | null>(snapshot);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedForMessageRef = useRef<string | null>(null);

  const persist = useCallback(
    (next: TriageState | null) => {
      if (!chatId) return;
      updateMeta.mutate({ id: chatId, [SNAPSHOT_KEY]: next });
    },
    [chatId, updateMeta],
  );

  const start = useCallback(
    (messageId: string) => {
      if (!chatId || pending || localState) return;
      if (startedForMessageRef.current === messageId) return;
      startedForMessageRef.current = messageId;
      setPending(true);
      setError(null);
      const recentPresentations = ((chatMeta[HISTORY_KEY] as CaseHistoryEntry[] | null | undefined) ?? []).slice(
        -HISTORY_LIMIT,
      );
      api
        .post<TriageInitResponse>("/encounter/triage-init", { chatId, connectionId: null, recentPresentations })
        .then((response) => {
          const seed = Math.floor(Math.random() * 0xffffffff);
          const state = createTriageState(response.case, seed, {
            partyNames: response.partyNames,
            skillBonus: response.skillBonus,
            skillSourceCharacterIds: response.skillSourceCharacterIds,
          });
          setLocalState(state);
          persist(state);
          const history = [
            ...recentPresentations,
            { patientName: response.case.patientName, flavor: response.flavor },
          ].slice(-HISTORY_LIMIT);
          updateMeta.mutate({ id: chatId, [HISTORY_KEY]: history });
          transitionGameState.mutate({ chatId, newState: "combat" });
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Failed to generate the case.");
        })
        .finally(() => setPending(false));
    },
    [chatId, pending, localState, persist, transitionGameState, chatMeta, updateMeta],
  );

  const applyAction = useCallback(
    (actionId: string) => {
      setLocalState((current) => {
        if (!current) return current;
        const result = commitAction(current, actionId);
        if (!result.ok) return current;
        persist(result.state);
        return result.state;
      });
    },
    [persist],
  );

  const applyEndRound = useCallback(() => {
    setLocalState((current) => {
      if (!current) return current;
      const next = endRound(current);
      persist(next);
      return next;
    });
  }, [persist]);

  const applyFlee = useCallback(() => {
    setLocalState((current) => {
      if (!current) return current;
      return fleeTriage(current);
    });
  }, []);

  const applyAutoResolve = useCallback(() => {
    setLocalState((current) => {
      if (!current) return current;
      return autoResolveTriage(current);
    });
  }, []);

  /** Discard the case entirely — no summary, no chat post, no journal entry. GameSurface deletes the triggering GM message. */
  const cancel = useCallback(() => {
    const messageId = startedForMessageRef.current;
    persist(null);
    setLocalState(null);
    startedForMessageRef.current = null;
    if (chatId) transitionGameState.mutate({ chatId, newState: "exploration" });
    if (messageId) onCancelRef.current?.(messageId);
  }, [chatId, persist, transitionGameState]);

  const finish = useCallback(() => {
    setLocalState((current) => {
      if (!current) return current;
      persist(null);
      const outcome = current.outcome === "flee" ? "flee" : (current.outcome ?? "defeat");
      onCombatEndRef.current?.(outcome, buildTriageSummary(current));
      if (outcome === "victory" && current.skillSourceCharacterIds.length > 0 && chatId) {
        api
          .post<TriageGrowSkillResponse>("/encounter/triage-grow-skill", {
            chatId,
            characterIds: current.skillSourceCharacterIds,
          })
          .then((res) => {
            for (const g of res.grown) {
              toast(`${g.characterName}'s ${g.attributeName} improved!`);
            }
          })
          .catch(() => {});
      }
      return null;
    });
  }, [persist, chatId]);

  const active = !!localState || pending;

  const render = useCallback((): ReactElement | null => {
    if (pending && !localState) {
      return createElement(
        "div",
        { className: "flex h-full items-center justify-center bg-slate-950/60 text-sm text-white/80" },
        "The trauma bay is prepping…",
      );
    }
    if (error && !localState) {
      return createElement(
        "div",
        {
          className:
            "flex h-full flex-col items-center justify-center gap-3 bg-slate-950/70 p-6 text-center text-white/80",
        },
        error,
      );
    }
    if (!localState) return null;
    return createElement(TriageCombatUI, {
      state: localState,
      onCommitAction: applyAction,
      onEndRound: applyEndRound,
      onFlee: applyFlee,
      onAutoResolve: applyAutoResolve,
      onCancel: cancel,
      onContinue: finish,
    });
  }, [pending, localState, error, applyAction, applyEndRound, applyFlee, applyAutoResolve, cancel, finish]);

  return useMemo(
    () => ({ active, start, render, bindOnCombatEnd, bindOnCancel }),
    [active, start, render, bindOnCombatEnd, bindOnCancel],
  );
}
