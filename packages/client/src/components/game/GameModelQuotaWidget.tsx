import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { Bot, Check, Dices, ChevronDown } from "lucide-react";
import { useConnections, useUpdateConnection } from "../../hooks/use-connections";
import { useChat, useUpdateChat } from "../../hooks/use-chats";
import { useSidecarStore } from "../../stores/sidecar.store";
import { appendLocalSidecarConnectionOption, isLocalSidecarConnectionOption } from "../../lib/connection-filters";
import { cn } from "../../lib/utils";
import { NEUTRAL_PANEL_SHELL, NEUTRAL_PANEL_SCROLL_AREA } from "../ui/neutral-surface-styles";

interface GameModelQuotaWidgetProps {
  chatId: string | null;
  className?: string;
  buttonClassName?: string;
  compact?: boolean;
  onOpen?: () => void;
}

type PlanType = "claude_sub" | "nanogpt" | "local" | "api";

function resolveConnectionPlan(conn: { provider?: string; model?: string } | null | undefined): {
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
      label: "Default Model",
      badge: "Default",
      colorClass: "text-foreground/70 bg-foreground/10 border-foreground/15",
      dotClass: "bg-foreground/40",
      detail: "Using engine default connection",
    };
  }

  const provider = (conn.provider || "").toLowerCase();
  const model = (conn.model || "").toLowerCase();

  if (provider === "claude_subscription" || model.includes("claude-subscription")) {
    return {
      planType: "claude_sub",
      label: "Claude Sub",
      badge: "Claude Sub",
      colorClass: "text-amber-300/90 bg-amber-500/10 border-amber-500/25",
      dotClass: "bg-amber-400",
      detail: "Claude Pro/Max Subscription (5h Rolling Capacity)",
    };
  }

  if (provider === "nanogpt" || model.includes("nanogpt")) {
    return {
      planType: "nanogpt",
      label: "NanoGPT",
      badge: "NanoGPT (60M/wk)",
      colorClass: "text-sky-300/90 bg-sky-500/10 border-sky-500/25",
      dotClass: "bg-sky-400",
      detail: "NanoGPT Plan (60M input tokens/week allowance)",
    };
  }

  if (
    provider === "custom" && (model.includes("local") || model.includes("gemma") || model.includes("llama")) ||
    provider === "local-sidecar"
  ) {
    return {
      planType: "local",
      label: "Local AI",
      badge: "Local AI (Free)",
      colorClass: "text-emerald-300/90 bg-emerald-500/10 border-emerald-500/25",
      dotClass: "bg-emerald-400",
      detail: "Local LLM execution (Offline, unlimited & free)",
    };
  }

  return {
    planType: "api",
    label: conn.provider || "API",
    badge: conn.provider || "API",
    colorClass: "text-foreground/75 bg-foreground/10 border-foreground/15",
    dotClass: "bg-foreground/50",
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

  const allConnections = (connections ?? []) as Array<{
    id: string;
    name: string;
    provider?: string;
    model?: string;
    defaultParameters?: unknown;
    useForRandom?: string;
  }>;

  const sorted = useMemo(() => {
    return appendLocalSidecarConnectionOption(
      allConnections,
      sidecarModelDownloaded,
      sidecarModelDisplayName,
    )
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

  const activeEffort = useMemo(() => {
    if (!activeConn?.defaultParameters) return null;
    try {
      const parsed = typeof activeConn.defaultParameters === "string"
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
    const menuHeight = menuEl?.offsetHeight || 320;
    const menuWidth = menuEl?.offsetWidth || 300;

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
            aria-label="Active Game Model and Connections"
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
              "fixed z-[9999] flex min-w-[280px] max-w-[340px] max-h-[380px] flex-col overflow-hidden rounded-xl border border-foreground/15 shadow-2xl backdrop-blur-md",
            )}
            style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" as const }}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-foreground/10 px-3 py-2 bg-foreground/[0.03]">
              <div className="flex items-center gap-1.5">
                <Bot size={13} className="text-foreground/60" />
                <span className="text-[0.6875rem] font-semibold tracking-wide uppercase text-foreground/80">
                  Game Model & Quota
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleRandom}
                title={
                  isRandom
                    ? "Random pool active. Click to disable."
                    : "Pick random connection from pool per turn"
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

            {/* Current Active Info Banner */}
            <div className="px-3 py-2 bg-foreground/[0.02] border-b border-foreground/10">
              <div className="text-[0.6875rem] text-foreground/50 flex items-center justify-between">
                <span>Active Connection:</span>
                <span className="font-medium text-foreground/85 truncate max-w-[150px]">{displayName}</span>
              </div>
              <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.625rem] font-medium border",
                    activePlan.colorClass,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", activePlan.dotClass)} />
                  {activePlan.badge}
                </span>
                {activeEffort && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[0.625rem] bg-foreground/10 text-foreground/70">
                    Effort: {activeEffort}
                  </span>
                )}
              </div>
            </div>

            {/* Connection List */}
            <div className={cn(NEUTRAL_PANEL_SCROLL_AREA, "overflow-y-auto p-1 max-h-[220px]")}>
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
                      <span className="text-[0.625rem] text-foreground/45 truncate">
                        {conn.model || conn.provider}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={cn(
                          "px-1 py-0.5 rounded text-[0.5625rem] font-medium border",
                          plan.colorClass,
                        )}
                      >
                        {plan.label}
                      </span>
                      {isActive && <Check size={12} className="text-foreground/80" />}
                    </div>
                  </button>
                );
              })}

              {sorted.length === 0 && (
                <div className="px-3 py-4 text-center text-[0.6875rem] italic text-foreground/45">
                  No connections found
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
          title={`Active Model: ${displayName} (${activePlan.badge})`}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
            open
              ? "bg-foreground/15 text-foreground ring-1 ring-foreground/25"
              : "text-foreground/50 hover:bg-foreground/10 hover:text-foreground/80",
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
        title={`Active Model: ${displayName} — ${activePlan.detail}`}
        className={cn(
          "group pointer-events-auto flex h-8 items-center gap-1.5 rounded-xl border border-foreground/10 bg-foreground/[0.04] px-2.5 py-1 text-xs transition-all duration-200 hover:border-foreground/20 hover:bg-foreground/[0.08] active:scale-[0.98]",
          open && "border-foreground/25 bg-foreground/10 ring-1 ring-foreground/20",
          buttonClassName,
          className,
        )}
      >
        <span className={cn("h-2 w-2 rounded-full shrink-0", activePlan.dotClass)} />
        <span className="font-medium text-foreground/80 truncate max-w-[110px] sm:max-w-[140px]">
          {displayName}
        </span>
        <span
          className={cn(
            "hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[0.5625rem] font-semibold uppercase tracking-wider border shrink-0",
            activePlan.colorClass,
          )}
        >
          {activePlan.badge}
        </span>
        <ChevronDown size={12} className="text-foreground/40 transition-transform group-hover:text-foreground/70" />
      </button>
      {dropdownMenu}
    </>
  );
}
