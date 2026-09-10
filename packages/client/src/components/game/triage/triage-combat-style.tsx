// ──────────────────────────────────────────────
// Triage Combat — pluggable CombatStyleSurface (issue #8109)
// ──────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { toast } from "sonner";
import { api } from "../../../lib/api-client";
import { queryClient } from "../../../lib/query-client";
import { chatKeys } from "../../../hooks/use-chats";
import {
  createTriageState,
  commitAction,
  endRound,
  fleeTriage,
  autoResolveTriage,
  buildTriageSummary,
  type Chat,
  type TriageInitResponse,
  type TriageState,
} from "@marinara-engine/shared";
import {
  registerCombatStyle,
  type CombatStyleStartContext,
  type CombatStyleSurface,
  type CombatSurfaceContext,
} from "../combat-styles";
import { TriageCombatUI } from "./TriageCombatUI";

const SNAPSHOT_KEY = "gameTriageCombatSnapshot";
const HISTORY_KEY = "gameTriageCaseHistory";
const HISTORY_LIMIT = 5;

type CaseHistoryEntry = { patientName: string; flavor: string };

interface TriageSession {
  state: TriageState | null;
  pending: boolean;
  error: string | null;
}

interface TriageGrowSkillResponse {
  grown: { characterId: string; characterName: string; attributeName: string; newValue: number }[];
}

const sessions = new Map<string, TriageSession>();
const listeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.error("[triage-combat-style] Listener notification failed", err);
    }
  }
}

export function subscribeTriage(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function isTriageActive(chatId: string): boolean {
  if (!chatId) return false;
  const chat = queryClient.getQueryData<Chat>(chatKeys.detail(chatId));
  const meta = chat?.metadata as Record<string, unknown> | undefined;
  if (meta && meta.gameActiveState !== "combat") {
    if (sessions.has(chatId)) {
      sessions.delete(chatId);
    }
    return false;
  }
  const session = sessions.get(chatId);
  if (session) {
    return session.pending || !!session.state;
  }
  return !!meta?.[SNAPSHOT_KEY];
}

export function startTriageCombat(ctx: CombatStyleStartContext): boolean {
  const { chatId, messageId } = ctx;
  if (!chatId) return false;
  const existing = sessions.get(chatId);
  if (existing?.pending || existing?.state) return false;

  sessions.set(chatId, { state: null, pending: true, error: null });
  notifyListeners();

  const chat = queryClient.getQueryData<Chat>(chatKeys.detail(chatId));
  const meta = (chat?.metadata ?? {}) as Record<string, unknown>;
  const recentPresentations = ((meta[HISTORY_KEY] as CaseHistoryEntry[] | null | undefined) ?? []).slice(
    -HISTORY_LIMIT,
  );

  api
    .post<TriageInitResponse>("/encounter/triage-init", {
      chatId,
      connectionId: null,
      recentPresentations,
      messageId,
    })
    .then((response) => {
      const seed = Math.floor(Math.random() * 0xffffffff);
      const state = createTriageState(response.case, seed, {
        partyNames: response.partyNames,
        skillBonus: response.skillBonus,
        skillSourceCharacterIds: response.skillSourceCharacterIds,
      });
      sessions.set(chatId, { state, pending: false, error: null });
      const history = [
        ...recentPresentations,
        { patientName: response.case.patientName, flavor: response.flavor },
      ].slice(-HISTORY_LIMIT);
      api
        .patch(`/chats/${chatId}/metadata`, {
          [SNAPSHOT_KEY]: state,
          [HISTORY_KEY]: history,
        })
        .catch((err) => console.error("[triage] failed to persist case metadata", err));
      notifyListeners();
    })
    .catch((err: unknown) => {
      const errorMsg = err instanceof Error ? err.message : "Failed to generate the case.";
      sessions.set(chatId, { state: null, pending: false, error: errorMsg });
      notifyListeners();
    });

  return true;
}

function TriageCombatSurfaceComponent({ ctx }: { ctx: CombatSurfaceContext }) {
  const { chatId, chatMeta, controlsSlot, onCombatEnd } = ctx;
  const { t: localizeUi } = useUiTranslation();

  const session = useSyncExternalStore(subscribeTriage, () => sessions.get(chatId));

  useEffect(() => {
    if (!sessions.has(chatId) && chatMeta[SNAPSHOT_KEY]) {
      sessions.set(chatId, {
        state: chatMeta[SNAPSHOT_KEY] as TriageState,
        pending: false,
        error: null,
      });
      notifyListeners();
    }
  }, [chatId, chatMeta]);

  useEffect(() => {
    if (chatMeta.gameActiveState !== "combat" || !chatMeta.gameCombatState) {
      if (sessions.has(chatId)) {
        sessions.delete(chatId);
        notifyListeners();
      }
    }
  }, [chatId, chatMeta.gameActiveState, chatMeta.gameCombatState]);

  const effectiveSession = useMemo(
    () =>
      session ??
      (chatMeta[SNAPSHOT_KEY] ? { state: chatMeta[SNAPSHOT_KEY] as TriageState, pending: false, error: null } : null),
    [session, chatMeta],
  );

  const persist = useCallback(
    (next: TriageState | null) => {
      if (!chatId) return;
      api.patch(`/chats/${chatId}/metadata`, { [SNAPSHOT_KEY]: next }).catch((err) => {
        console.error("[triage] failed to patch snapshot", err);
      });
    },
    [chatId],
  );

  const applyAction = useCallback(
    (actionId: string) => {
      const current = sessions.get(chatId)?.state ?? effectiveSession?.state;
      if (!current) return;
      const result = commitAction(current, actionId);
      if (!result.ok) return;
      sessions.set(chatId, { state: result.state, pending: false, error: null });
      persist(result.state);
      notifyListeners();
    },
    [chatId, effectiveSession, persist],
  );

  const applyEndRound = useCallback(() => {
    const current = sessions.get(chatId)?.state ?? effectiveSession?.state;
    if (!current) return;
    const next = endRound(current);
    sessions.set(chatId, { state: next, pending: false, error: null });
    persist(next);
    notifyListeners();
  }, [chatId, effectiveSession, persist]);

  const applyFlee = useCallback(() => {
    const current = sessions.get(chatId)?.state ?? effectiveSession?.state;
    if (!current) return;
    const next = fleeTriage(current);
    sessions.set(chatId, { state: next, pending: false, error: null });
    notifyListeners();
  }, [chatId, effectiveSession]);

  const applyAutoResolve = useCallback(() => {
    const current = sessions.get(chatId)?.state ?? effectiveSession?.state;
    if (!current) return;
    const next = autoResolveTriage(current);
    sessions.set(chatId, { state: next, pending: false, error: null });
    notifyListeners();
  }, [chatId, effectiveSession]);

  const finish = useCallback(() => {
    const current = sessions.get(chatId)?.state ?? effectiveSession?.state;
    if (!current) return;
    sessions.delete(chatId);
    persist(null);
    notifyListeners();

    const outcome = current.outcome === "flee" ? "flee" : (current.outcome ?? "defeat");
    onCombatEnd(outcome, buildTriageSummary(current));

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
  }, [chatId, effectiveSession, onCombatEnd, persist]);

  if (effectiveSession?.pending && !effectiveSession?.state) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950/60 text-sm text-white/80">
        {localizeUi("ui.game.triagecombatui.theTraumaBayIsPrepping")}
      </div>
    );
  }

  if (effectiveSession?.error && !effectiveSession?.state) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-slate-950/70 p-6 text-center text-white/80">
        {effectiveSession.error}
      </div>
    );
  }

  if (!effectiveSession?.state) {
    return null;
  }

  return (
    <TriageCombatUI
      state={effectiveSession.state}
      onCommitAction={applyAction}
      onEndRound={applyEndRound}
      onFlee={applyFlee}
      onAutoResolve={applyAutoResolve}
      controlsSlot={controlsSlot}
      onContinue={finish}
    />
  );
}

export const triageCombatStyle: CombatStyleSurface = {
  label: "Triage",
  ownsTopChrome: true,
  start: startTriageCombat,
  isActive: isTriageActive,
  subscribe: subscribeTriage,
  render: (ctx) => <TriageCombatSurfaceComponent ctx={ctx} />,
};

export function registerTriageCombatStyle(): () => void {
  return registerCombatStyle("triage", triageCombatStyle);
}
