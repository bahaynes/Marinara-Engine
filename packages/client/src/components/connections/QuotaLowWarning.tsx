// Fork: toast as the active connection's 5-hour plan window runs low; the usage meter alone goes unnoticed.
import { useEffect } from "react";
import { useTranslation as useUiTranslation } from "react-i18next";
import { toast } from "sonner";
import { useChat } from "../../hooks/use-chats";
import { useConnections, useSubscriptionUsage } from "../../hooks/use-connections";
import { resolveUsageConnection } from "../../lib/connection-filters";

const WARNING_LEVELS = [10, 25, 50];
const WARNED_STORAGE_KEY = "marinara:quota-warned";
// A Claude reading starts a Claude Code process on the host, so poll gently.
const POLL_MS = 5 * 60_000;
const samples = new Map<string, Array<{ at: number; used: number }>>();

function readWarned(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(WARNED_STORAGE_KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeWarned(warned: Record<string, number>) {
  try {
    localStorage.setItem(WARNED_STORAGE_KEY, JSON.stringify(Object.fromEntries(Object.entries(warned).slice(-20))));
  } catch {
    // Without storage the warning may repeat after a reload; it still fires.
  }
}

export function QuotaLowWarning({ chatId }: { chatId: string }) {
  const { t: localizeUi } = useUiTranslation();
  const { data: chat } = useChat(chatId);
  const { data: connections } = useConnections();
  const connection = resolveUsageConnection(
    connections as Parameters<typeof resolveUsageConnection>[0],
    (chat as { connectionId?: string | null } | undefined)?.connectionId,
  );
  const connectionId = connection?.id ?? null;
  const { data, refetch } = useSubscriptionUsage(connectionId, true);

  useEffect(() => {
    if (!connectionId) return;
    const timer = window.setInterval(() => void refetch(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [connectionId, refetch]);

  const window5h = data && "windows" in data ? data.windows.find((w) => w.id === "five_hour") : undefined;
  const fraction = window5h?.percentUsed;
  const resetAt = window5h?.resetAt ?? null;
  const name = (connection as { name?: string } | null)?.name ?? "";

  useEffect(() => {
    if (!connectionId || typeof fraction !== "number") return;
    const used = Math.round(fraction * 100);
    const remaining = Math.max(0, 100 - used);
    const now = Date.now();
    // Samples from the last hour of this window (a lower reading means the window reset).
    const recent = (samples.get(connectionId) ?? []).filter((s) => now - s.at < 3_600_000 && s.used <= used);
    recent.push({ at: now, used });
    samples.set(connectionId, recent);

    const level = WARNING_LEVELS.find((candidate) => remaining <= candidate);
    if (level === undefined) return;
    // The reset time drifts between readings; round it so one window keeps one key.
    const windowKey = `${connectionId}:${resetAt ? Math.round(resetAt / 600_000) : ""}`;
    const warned = readWarned();
    if ((warned[windowKey] ?? Infinity) <= level) return;
    warned[windowKey] = level;
    writeWarned(warned);

    const hours = (now - recent[0]!.at) / 3_600_000;
    const rate = hours >= 1 / 6 ? Math.round((used - recent[0]!.used) / hours) : null;
    const resetTime = resetAt ? new Date(resetAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    toast.warning(localizeUi("ui.connections.quotaLowWarning.title", { name, remaining }), {
      id: `quota-warning-${connectionId}`,
      duration: 20_000,
      description: [
        rate !== null && rate > 0 ? localizeUi("ui.connections.quotaLowWarning.burnRate", { rate }) : null,
        resetTime ? localizeUi("ui.connections.quotaLowWarning.resetsAt", { time: resetTime }) : null,
      ]
        .filter(Boolean)
        .join(" "),
    });
  }, [connectionId, name, fraction, resetAt, localizeUi]);

  return null;
}
