import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, Dices, ChevronDown, Clock, ShieldCheck, Zap } from "lucide-react";
import { useConnections, useUpdateConnection } from "../../hooks/use-connections";
import { useChat, useUpdateChat } from "../../hooks/use-chats";
import { useSidecarStore } from "../../stores/sidecar.store";
import { appendLocalSidecarConnectionOption, isLocalSidecarConnectionOption } from "../../lib/connection-filters";
import { cn } from "../../lib/utils";
import { NEUTRAL_PANEL_SHELL, NEUTRAL_PANEL_SCROLL_AREA } from "../ui/neutral-surface-styles";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api-client";
import { useTranslation as useUiTranslation } from "react-i18next";

interface GameModelQuotaWidgetProps {
  chatId: string | null;
  className?: string;
  buttonClassName?: string;
  compact?: boolean;
  onOpen?: () => void;
}

type PlanType = "claude_sub" | "nanogpt" | "agy_sub" | "local" | "api";

interface QuotaData {
  provider: string;
  isUnlimited?: boolean;
  isQuotaTracked?: boolean;
  session?: {
    percentUsed: number;
    percentRemaining: number;
    resetsAt: string | null;
    resetsAtEpochMs?: number | null;
  };
  weekly?: {
    limitTokens?: number;
    usedTokens?: number;
    remainingTokens?: number;
    percentUsed: number;
    percentRemaining: number;
    resetsAt: string | null;
    resetsAtEpochMs?: number | null;
  };
  error?: string;
}

function formatCountdown(targetMs: number | null | undefined): string {
  if (!targetMs) return "";
  const diffMs = targetMs - Date.now();
  if (diffMs <= 0) return "Ready now";

  const diffMins = Math.round(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  if (hours < 24) return `${hours}h ${mins}m`;

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return `${days}d ${remHours}h`;
}

function formatResetClockTime(target: string | number | null | undefined): string {
  if (!target) return "";
  try {
    const d = typeof target === "number" ? new Date(target) : new Date(target);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatTokenCount(tokens: number | undefined): string {
  if (tokens === undefined || tokens === null) return "0";
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(0)}k`;
  }
  return `${tokens}`;
}

function resolveConnectionPlan(
  conn:
    | {
        provider?: string;
        model?: string;
        name?: string;
      }
    | null
    | undefined,
): {
  planType: PlanType;
  label: string;
  badge: string;
  colorClass: string;
  dotClass: string;
  detail: string;
} {
  if (!conn) {
    return {
      planType: "api",
      label: "Default",
      badge: "Default",
      colorClass: "text-foreground/70 bg-foreground/10 border-foreground/15",
      dotClass: "bg-foreground/40",
      detail: "Using engine default connection",
    };
  }

  const provider = (conn.provider || "").toLowerCase();
  const model = (conn.model || "").toLowerCase();
  const name = (conn.name || "").toLowerCase();

  // Truly local models (gemma, llama, local-model, etc.). treatAsLocalEndpoint is
  // deliberately excluded here: it's a tool-call transport hint (native tool_use vs.
  // JSON-protocol fallback), not a signal about which model/provider is actually running.
  if (
    (provider === "custom" &&
      (model.includes("local") || model.includes("gemma") || model.includes("llama") || name.includes("local"))) ||
    provider === "local-sidecar"
  ) {
    return {
      planType: "local",
      label: "Local AI",
      badge: "Local AI (Free)",
      colorClass:
        "text-emerald-700 bg-emerald-500/15 border-emerald-500/30 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30",
      dotClass: "bg-emerald-500 dark:bg-emerald-400",
      detail: "Local LLM execution (Offline, unlimited & free)",
    };
  }

  // Google Antigravity / AGY via proxy
  const isAgy =
    name.includes("agy") ||
    name.includes("antigravity") ||
    model.includes("gemini-3") ||
    model.includes("agy") ||
    model.includes("antigravity") ||
    (provider === "custom" && (name.includes("google") || model.includes("gemini")));

  if (isAgy) {
    return {
      planType: "agy_sub",
      label: "AGY Sub",
      badge: "AGY Sub (5h/Wk)",
      colorClass:
        "text-indigo-700 bg-indigo-500/15 border-indigo-500/30 dark:text-indigo-300 dark:bg-indigo-500/15 dark:border-indigo-500/30",
      dotClass: "bg-indigo-500 dark:bg-indigo-400",
      detail: "Google Antigravity Subscription (5h Rolling & Weekly Quotas)",
    };
  }

  // Claude subscription (direct provider, model naming, or custom proxy connection)
  const isClaude =
    provider === "claude_subscription" ||
    model.includes("claude-subscription") ||
    name.includes("claude (sub") ||
    ((provider === "custom" || provider === "claude_subscription") &&
      (name.includes("claude") ||
        model.includes("claude") ||
        model.includes("sonnet") ||
        model.includes("haiku") ||
        model.includes("opus")));

  if (isClaude) {
    return {
      planType: "claude_sub",
      label: "Claude Sub",
      badge: "Claude Sub (5h/Wk)",
      colorClass:
        "text-amber-700 bg-amber-500/15 border-amber-500/30 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30",
      dotClass: "bg-amber-500 dark:bg-amber-400",
      detail: "Claude Pro/Max Subscription (5h Rolling & Weekly Quotas)",
    };
  }

  // NanoGPT subscription
  if (provider === "nanogpt" || model.includes("nanogpt") || name.includes("nanogpt")) {
    return {
      planType: "nanogpt",
      label: "NanoGPT",
      badge: "NanoGPT (60M/wk)",
      colorClass:
        "text-sky-700 bg-sky-500/15 border-sky-500/30 dark:text-sky-300 dark:bg-sky-500/15 dark:border-sky-500/30",
      dotClass: "bg-sky-500 dark:bg-sky-400",
      detail: "NanoGPT Plan (60M input tokens/week allowance)",
    };
  }

  return {
    planType: "api",
    label: conn.provider || "API",
    badge: conn.provider || "API",
    colorClass: "text-foreground/80 bg-foreground/10 border-foreground/20",
    dotClass: "bg-foreground/60",
    detail: `API Model (${conn.model || "Standard"})`,
  };
}

export function GameModelQuotaWidget({
  chatId,
  className,
  buttonClassName,
  compact = false,
  onOpen,
}: GameModelQuotaWidgetProps) {
  const { t: localizeUi } = useUiTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const { data: connections } = useConnections();
  const { data: chat } = useChat(chatId);
  const updateChat = useUpdateChat();
  const updateConnection = useUpdateConnection();

  const sidecarModelDownloaded = useSidecarStore((state) => state.modelDownloaded);
  const sidecarModelDisplayName = useSidecarStore((state) => state.modelDisplayName);

  const activeConnectionId = (chat as unknown as Record<string, unknown>)?.connectionId as string | null;
  const isRandom = activeConnectionId === "random";

  const allConnections = useMemo(
    () =>
      (connections ?? []) as Array<{
        id: string;
        name: string;
        provider?: string;
        model?: string;
        defaultParameters?: unknown;
        useForRandom?: string;
      }>,
    [connections],
  );

  const sorted = useMemo(() => {
    return appendLocalSidecarConnectionOption(allConnections, sidecarModelDownloaded, sidecarModelDisplayName)
      .filter((connection) => !isRandom || !isLocalSidecarConnectionOption(connection))
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [allConnections, isRandom, sidecarModelDownloaded, sidecarModelDisplayName]);

  const activeConn = useMemo(() => {
    if (!activeConnectionId || activeConnectionId === "random") return null;
    return allConnections.find((c) => c.id === activeConnectionId) ?? null;
  }, [allConnections, activeConnectionId]);

  const activePlan = useMemo(() => {
    return resolveConnectionPlan(activeConn);
  }, [activeConn]);

  // Fetch live quota for active connection (cached 30s)
  const { data: quota } = useQuery<QuotaData>({
    queryKey: ["connection-quota", activeConn?.id],
    queryFn: async () => {
      if (!activeConn?.id) return null as any;
      return await api.get<QuotaData>(`/connections/${activeConn.id}/quota`);
    },
    enabled: Boolean(activeConn?.id),
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const activeEffort = useMemo(() => {
    if (!activeConn?.defaultParameters) return null;
    try {
      const parsed =
        typeof activeConn.defaultParameters === "string"
          ? JSON.parse(activeConn.defaultParameters)
          : activeConn.defaultParameters;
      return (parsed as { reasoningEffort?: string })?.reasoningEffort ?? null;
    } catch {
      return null;
    }
  }, [activeConn]);

  const handleSwitch = useCallback(
    (connId: string | null) => {
      if (!chatId) return;
      updateChat.mutate({ id: chatId, connectionId: connId });
      setOpen(false);
    },
    [chatId, updateChat],
  );

  const handleToggleRandom = useCallback(() => {
    if (!chatId) return;
    updateChat.mutate({ id: chatId, connectionId: isRandom ? null : "random" });
  }, [chatId, isRandom, updateChat]);

  const handleTogglePool = useCallback(
    (connId: string, inPool: boolean) => {
      updateConnection.mutate({ id: connId, useForRandom: !inPool });
    },
    [updateConnection],
  );

  const toggleMenu = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && onOpen) onOpen();
      return next;
    });
  }, [onOpen]);

  // Click outside to dismiss
  useEffect(() => {
    if (!open) return;
    const handler = (e: PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        btnRef.current &&
        !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  // Calculate dropdown position
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuEl = menuRef.current;
    const menuHeight = menuEl?.offsetHeight || 360;
    const menuWidth = menuEl?.offsetWidth || 320;

    let left = rect.left;
    if (left + menuWidth > window.innerWidth - 8) {
      left = window.innerWidth - menuWidth - 8;
    }
    if (left < 8) left = 8;

    let top = rect.bottom + 6;
    if (top + menuHeight > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuHeight - 6);
    }

    setPos({ left, top });
  }, [open]);

  // Compute live quota display badge for pill
  const pillQuotaBadge = useMemo(() => {
    if (activePlan.planType === "local" || quota?.isUnlimited) {
      return "Unlimited (Free)";
    }
    if (!quota) return activePlan.badge;
    if (quota.session) {
      const pct = quota.session.percentRemaining;
      return `${pct}% left (5h)`;
    }
    if (quota.weekly?.remainingTokens !== undefined) {
      return `${formatTokenCount(quota.weekly.remainingTokens)} left`;
    }
    return activePlan.badge;
  }, [quota, activePlan]);

  if (!chatId) return null;

  const displayName = isRandom
    ? "🎲 Random Model"
    : activeConn
      ? activeConn.name || activeConn.model || "Active Model"
      : "Default Model";

  const dropdownMenu =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={localizeUi("ui.game.gamemodelquotawidget.activeGameModelAndConnections")}
            tabIndex={-1}
            data-chat-floating-panel
            onPointerDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setOpen(false);
                btnRef.current?.focus();
              }
            }}
            className={cn(
              NEUTRAL_PANEL_SHELL,
              "fixed z-[9999] flex min-w-[300px] max-w-[360px] max-h-[420px] flex-col overflow-hidden rounded-xl border border-foreground/15 shadow-2xl backdrop-blur-md",
            )}
            style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" as const }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-foreground/10 px-3 py-2 bg-foreground/[0.03]">
              <div className="flex items-center gap-1.5">
                <Bot size={13} className="text-foreground/60" />
                <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-foreground/80">
                  {localizeUi("ui.game.gamemodelquotawidget.activeModelQuota")}
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleRandom}
                title={
                  isRandom
                    ? localizeUi("ui.game.gamemodelquotawidget.randomPoolActiveClickToDisable")
                    : localizeUi("ui.game.gamemodelquotawidget.pickRandomConnectionFromPoolPerTurn")
                }
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md transition-all active:scale-90",
                  isRandom
                    ? "bg-foreground/15 text-foreground ring-1 ring-foreground/25"
                    : "text-foreground/40 hover:bg-foreground/10 hover:text-foreground/70",
                )}
              >
                <Dices size={13} />
              </button>
            </div>

            {/* Current Active Info Banner with Live Quota */}
            <div className="p-3 bg-foreground/[0.02] border-b border-foreground/10 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-foreground/50">{localizeUi("ui.game.gamemodelquotawidget.active")}</span>
                <span className="font-semibold text-foreground truncate max-w-[170px]">{displayName}</span>
              </div>

              {/* Session + Weekly Quota Cards (Claude & AGY) */}
              {activePlan.planType !== "local" && quota?.session && (
                <div className="rounded-lg bg-foreground/[0.04] p-2 space-y-1.5 border border-foreground/10 text-xs">
                  <div className="flex items-center justify-between text-[0.6875rem]">
                    <span
                      className={cn(
                        "font-medium flex items-center gap-1",
                        activePlan.planType === "agy_sub"
                          ? "text-indigo-600 dark:text-indigo-300"
                          : "text-amber-700 dark:text-amber-300",
                      )}
                    >
                      <Clock size={11} /> {localizeUi("ui.game.gamemodelquotawidget.text5hSessionQuota")}
                    </span>
                    <span className="text-foreground/75 font-semibold">
                      {quota.session.percentRemaining}
                      {localizeUi("ui.game.gamemodelquotawidget.remaining")}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-foreground/10 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-300 rounded-full",
                        activePlan.planType === "agy_sub"
                          ? quota.session.percentRemaining > 20
                            ? "bg-indigo-500"
                            : "bg-red-400"
                          : quota.session.percentRemaining > 30
                            ? "bg-amber-400"
                            : "bg-red-400",
                      )}
                      style={{ width: `${quota.session.percentRemaining}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[0.625rem] text-foreground/50">
                    <span>
                      {localizeUi("ui.game.gamemodelquotawidget.used")} {quota.session.percentUsed}%
                    </span>
                    <span>
                      {quota.session.resetsAtEpochMs
                        ? localizeUi("ui.game.gamemodelquotawidget.replenishesAtValue1Value2", {
                            value1: formatResetClockTime(quota.session.resetsAtEpochMs),
                            value2: formatCountdown(quota.session.resetsAtEpochMs),
                          })
                        : ""}
                    </span>
                  </div>

                  {quota.weekly && (
                    <div className="pt-1.5 border-t border-foreground/10">
                      <div className="flex items-center justify-between text-[0.625rem] text-foreground/60">
                        <span>{localizeUi("ui.game.gamemodelquotawidget.weeklyAllotted")}</span>
                        <span className="font-medium">
                          {quota.weekly.percentRemaining}
                          {localizeUi("ui.game.gamemodelquotawidget.remaining")}
                        </span>
                      </div>
                      <div className="text-[0.5625rem] text-foreground/45 text-right mt-0.5">
                        {quota.weekly.resetsAtEpochMs
                          ? localizeUi("ui.game.gamemodelquotawidget.weeklyResetsInValue1", {
                              value1: formatCountdown(quota.weekly.resetsAtEpochMs),
                            })
                          : ""}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* NanoGPT Quota Cards */}
              {quota?.weekly && !quota.session && (
                <div className="rounded-lg bg-foreground/[0.04] p-2 space-y-1.5 border border-foreground/10 text-xs">
                  <div className="flex items-center justify-between text-[0.6875rem]">
                    <span className="font-medium text-sky-300/90 flex items-center gap-1">
                      <ShieldCheck size={11} /> {localizeUi("ui.game.gamemodelquotawidget.weeklyAllowance")}
                    </span>
                    <span className="text-foreground/80 font-semibold">
                      {formatTokenCount(quota.weekly.remainingTokens)} / {formatTokenCount(quota.weekly.limitTokens)}
                    </span>
                  </div>
                  {/* Progress bar */}
                  <div className="h-1.5 w-full bg-foreground/10 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full transition-all duration-300 rounded-full",
                        quota.weekly.percentRemaining > 20 ? "bg-sky-400" : "bg-red-400",
                      )}
                      style={{ width: `${quota.weekly.percentRemaining}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[0.625rem] text-foreground/50">
                    <span>
                      {quota.weekly.percentRemaining}
                      {localizeUi("ui.game.gamemodelquotawidget.remaining")}
                    </span>
                    <span>
                      {quota.weekly.resetsAtEpochMs
                        ? localizeUi("ui.game.gamemodelquotawidget.resetsInValue1", {
                            value1: formatCountdown(quota.weekly.resetsAtEpochMs),
                          })
                        : ""}
                    </span>
                  </div>
                </div>
              )}

              {/* AGY Subscription fallback info (when no session metrics available) */}
              {activePlan.planType === "agy_sub" && !quota?.session && (
                <div className="rounded-lg bg-indigo-500/10 p-2 text-xs border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 space-y-1">
                  <div className="flex items-center justify-between text-[0.6875rem] font-semibold">
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {localizeUi("ui.game.gamemodelquotawidget.googleAntigravitySub")}
                    </span>
                    <span>{localizeUi("ui.game.gamemodelquotawidget.text5hWeeklyTierQuotas")}</span>
                  </div>
                  <div className="text-[0.625rem] text-foreground/60 leading-relaxed">
                    {localizeUi("ui.game.gamemodelquotawidget.routedThroughLocalProxyToAntigravityCli")}
                    <code className="text-foreground/80 font-mono">agy</code>
                    {localizeUi("ui.game.gamemodelquotawidget.uses5HourRollingSessionAndWeeklyTierQuotas")}
                  </div>
                </div>
              )}

              {/* Claude Subscription fallback info (when no session metrics available) */}
              {activePlan.planType === "claude_sub" && !quota?.session && (
                <div className="rounded-lg bg-amber-500/10 p-2 text-xs border border-amber-500/20 text-amber-700 dark:text-amber-300 space-y-1">
                  <div className="flex items-center justify-between text-[0.6875rem] font-semibold">
                    <span className="flex items-center gap-1">
                      <Clock size={11} /> {localizeUi("ui.game.gamemodelquotawidget.claudeSubscriptionSub")}
                    </span>
                    <span>{localizeUi("ui.game.gamemodelquotawidget.text5hWeeklyTierQuotas")}</span>
                  </div>
                  <div className="text-[0.625rem] text-foreground/60 leading-relaxed">
                    {localizeUi("ui.game.gamemodelquotawidget.routedThroughLocalClaudeProxy")}
                  </div>
                </div>
              )}

              {/* Local AI status */}
              {(quota?.isUnlimited || activePlan.planType === "local") && activePlan.planType === "local" && (
                <div className="rounded-lg bg-emerald-500/10 p-2 text-xs border border-emerald-500/20 text-emerald-300/90 flex items-center gap-2">
                  <Zap size={13} className="shrink-0" />
                  <span className="text-[0.6875rem]">
                    {localizeUi("ui.game.gamemodelquotawidget.localOfflineExecutionUnlimitedFree")}
                  </span>
                </div>
              )}

              {/* Badges */}
              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-medium border",
                    activePlan.colorClass,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", activePlan.dotClass)} />
                  {activePlan.label}
                </span>
                {activeEffort && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] bg-foreground/10 text-foreground/70">
                    {localizeUi("ui.game.gamemodelquotawidget.thinking")} {activeEffort}
                  </span>
                )}
              </div>
            </div>

            {/* Connection Switcher List */}
            <div className={cn(NEUTRAL_PANEL_SCROLL_AREA, "overflow-y-auto p-1 max-h-[180px]")}>
              {sorted.map((conn) => {
                const inPool = conn.useForRandom === "true";
                const isActive = activeConnectionId === conn.id;
                const plan = resolveConnectionPlan(conn);

                if (isRandom) {
                  return (
                    <button
                      type="button"
                      key={conn.id}
                      onClick={() => handleTogglePool(conn.id, inPool)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-foreground/10"
                    >
                      <span className="flex-1 truncate">{conn.name || conn.id}</span>
                      <span
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                          inPool
                            ? "border-foreground/35 bg-foreground/10 text-foreground/75"
                            : "border-foreground/20 bg-transparent",
                        )}
                      >
                        {inPool && <Check size={10} strokeWidth={3} />}
                      </span>
                    </button>
                  );
                }

                return (
                  <button
                    type="button"
                    key={conn.id}
                    onClick={() => handleSwitch(conn.id)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-foreground/10",
                      isActive && "bg-foreground/10 font-semibold text-foreground",
                    )}
                  >
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="truncate">{conn.name || conn.id}</span>
                      <span className="text-[0.625rem] text-foreground/45 truncate">{conn.model || conn.provider}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn("px-1 py-0.5 rounded text-[0.5625rem] font-medium border", plan.colorClass)}>
                        {plan.label}
                      </span>
                      {isActive && <Check size={12} className="text-foreground/80" />}
                    </div>
                  </button>
                );
              })}

              {sorted.length === 0 && (
                <div className="px-3 py-4 text-center text-[0.6875rem] italic text-foreground/45">
                  {localizeUi("ui.chat.newchatconnectiongate.noConnectionsFound")}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  if (compact) {
    return (
      <>
        <button
          type="button"
          ref={btnRef}
          onClick={toggleMenu}
          title={localizeUi("ui.game.gamemodelquotawidget.activeModelValue1Value2", {
            value1: displayName,
            value2: pillQuotaBadge,
          })}
          className={cn(
            "marinara-chat-toolbar-button flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--marinara-chat-chrome-button-border)] bg-[var(--marinara-chat-chrome-button-bg)] text-[var(--marinara-chat-chrome-button-text)] shadow-sm backdrop-blur-md transition-all hover:border-[var(--marinara-chat-chrome-button-border-hover)] hover:bg-[var(--marinara-chat-chrome-button-bg-hover)] hover:text-[var(--marinara-chat-chrome-button-text-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marinara-chat-chrome-focus-ring)]",
            open &&
              "marinara-chat-toolbar-button--open border-[var(--marinara-chat-chrome-button-border-active)] bg-[var(--marinara-chat-chrome-button-bg-hover)] text-[var(--marinara-chat-chrome-button-text-hover)]",
            buttonClassName,
            className,
          )}
        >
          <Bot size={14} />
        </button>
        {dropdownMenu}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        ref={btnRef}
        onClick={toggleMenu}
        title={localizeUi("ui.game.gamemodelquotawidget.activeModelValue1Value2_b8a3951", {
          value1: displayName,
          value2: activePlan.detail,
        })}
        className={cn(
          "marinara-chat-toolbar-button group pointer-events-auto flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--marinara-chat-chrome-button-border)] bg-[var(--marinara-chat-chrome-button-bg)] px-2.5 py-1 text-xs text-[var(--marinara-chat-chrome-button-text)] shadow-sm backdrop-blur-md transition-all duration-200 hover:border-[var(--marinara-chat-chrome-button-border-hover)] hover:bg-[var(--marinara-chat-chrome-button-bg-hover)] hover:text-[var(--marinara-chat-chrome-button-text-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--marinara-chat-chrome-focus-ring)] active:scale-[0.98]",
          open &&
            "marinara-chat-toolbar-button--open border-[var(--marinara-chat-chrome-button-border-active)] bg-[var(--marinara-chat-chrome-button-bg-hover)] text-[var(--marinara-chat-chrome-button-text-hover)]",
          buttonClassName,
          className,
        )}
      >
        <span className={cn("h-2 w-2 rounded-full shrink-0", activePlan.dotClass)} />
        <span className="font-medium truncate max-w-[110px] sm:max-w-[130px]">{displayName}</span>
        <span
          className={cn(
            "hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-semibold uppercase tracking-wider border shrink-0",
            activePlan.colorClass,
          )}
        >
          {pillQuotaBadge}
        </span>
        <ChevronDown size={12} className="opacity-60 transition-transform group-hover:opacity-100" />
      </button>
      {dropdownMenu}
    </>
  );
}
