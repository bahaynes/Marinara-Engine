import { useTranslation } from "react-i18next";
import type { GenerationInfo } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";

/**
 * "Cache break" beside a reply whose prompt changed ahead of its tail since the last reply (custom-mods).
 * The server names where, what, and the lorebook entry behind it when one matches; Erin can tell a prompt
 * change from a cache that simply expired.
 */
export function CacheBreakMarker({
  cacheBreak,
  className,
}: {
  cacheBreak: GenerationInfo["cacheBreak"];
  className?: string;
}) {
  const { t } = useTranslation();
  if (!cacheBreak) return null;
  const note = [
    t("generation.cacheBreak.where", {
      index: cacheBreak.messageIndex,
      role: cacheBreak.role,
      fromEnd: cacheBreak.fromEnd,
    }),
    cacheBreak.source ? t("generation.cacheBreak.source", { source: cacheBreak.source }) : null,
    cacheBreak.movedFromEnd != null ? t("generation.cacheBreak.moved", { fromEnd: cacheBreak.movedFromEnd }) : null,
    cacheBreak.before ? t("generation.cacheBreak.was", { text: cacheBreak.before }) : null,
    cacheBreak.after ? t("generation.cacheBreak.now", { text: cacheBreak.after }) : null,
    cacheBreak.expired ? t("generation.cacheBreak.expired") : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <HelpTooltip
      label={t("generation.cacheBreak.marker")}
      text={note}
      ariaLabel={note}
      size="0.625rem"
      className={cn("shrink-0", className)}
      buttonClassName="text-[0.5625rem] italic"
      wide
    />
  );
}
