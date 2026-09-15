import type { CSSProperties } from "react";
import type { SkillCheckResult } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { AnimatedDiceRoll } from "./AnimatedDiceRoll";
import { useTranslation as useUiTranslation } from "react-i18next";

export interface AnimatedSkillCheckResultProps {
  result: SkillCheckResult;
  accentColor?: string;
  animate?: boolean;
  onDismiss?: () => void;
  className?: string;
  canReroll?: boolean;
  inspirationCount?: number;
  onReroll?: () => void;
  isRerolling?: boolean;
}

type Tone = "critical-success" | "success" | "failure" | "critical-failure";

const TONE_ACCENT: Record<Tone, string> = {
  "critical-success": "oklch(0.82 0.15 86)",
  success: "oklch(0.72 0.16 158)",
  failure: "oklch(0.68 0.18 20)",
  "critical-failure": "oklch(0.60 0.22 20)",
};

function resultLabel(result: SkillCheckResult): string {
  if (result.criticalSuccess) return "CRITICAL SUCCESS";
  if (result.criticalFailure) return "CRITICAL FAILURE";
  return result.success ? "SUCCESS" : "FAILURE";
}

export function AnimatedSkillCheckResult({
  result,
  accentColor,
  animate = false,
  onDismiss,
  className,
  canReroll,
  inspirationCount,
  onReroll,
  isRerolling,
}: AnimatedSkillCheckResultProps) {
  const { t: localizeUi } = useUiTranslation();
  const label = resultLabel(result);
  const tone = result.criticalSuccess
    ? "critical-success"
    : result.criticalFailure
      ? "critical-failure"
      : result.success
        ? "success"
        : "failure";
  const rollMode = result.rollMode !== "normal" ? ` · ${result.rollMode}` : "";
  const resolvedAccent = accentColor ?? TONE_ACCENT[tone];
  const style = resolvedAccent ? ({ "--dice-accent": resolvedAccent } as CSSProperties) : undefined;

  return (
    <div
      className={cn("skill-check-roll", `skill-check-roll--${tone}`, animate && "is-animating", className)}
      style={style}
    >
      <div className="skill-check-roll-meta">
        <span>
          {result.skill} {localizeUi("ui.agents.customagentrepositoriesmodal.check")}
        </span>
        <span>
          {localizeUi("ui.dice.animatedskillcheckresult.dc")} {result.dc}
          {rollMode}
        </span>
      </div>
      <AnimatedDiceRoll
        notation={result.dice ?? `${result.rolls.length}d20`}
        rolls={result.rolls}
        modifier={result.modifier}
        total={result.total}
        accentColor={resolvedAccent}
        mode="game"
        animate={animate}
        onDismiss={onDismiss}
        hero
        highlightValue={result.rollMode !== "normal" ? result.usedRoll : undefined}
        resolution={result.resolution}
      />
      <div className="skill-check-roll-result">
        <span>
          {result.rollMode !== "normal"
            ? localizeUi("ui.dice.animatedskillcheckresult.usingValue1", { value1: result.usedRoll })
            : result.resolution === "sum" &&
                result.rolls.length === 1 &&
                result.usedRoll === result.rolls[0] &&
                result.total === result.usedRoll + result.modifier
              ? localizeUi("ui.dice.animatedskillcheckresult.rolledValue1", { value1: result.usedRoll })
              : localizeUi("ui.dice.animatedskillcheckresult.resultValue1", { value1: result.total })}
        </span>
        <strong>{label}</strong>
      </div>
      {canReroll && onReroll && !result.success && (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReroll();
            }}
            disabled={isRerolling || (inspirationCount ?? 0) <= 0}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all shadow-sm",
              "bg-amber-500/20 text-amber-200 border border-amber-500/30 hover:bg-amber-500/30 active:scale-95",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500/20 disabled:active:scale-100",
            )}
          >
            <span>✨</span>
            <span>
              {isRerolling
                ? localizeUi("ui.game.inspiration.rerolling", "Rerolling...")
                : localizeUi("ui.game.inspiration.rerollWithInspiration", {
                    count: inspirationCount ?? 0,
                    defaultValue: `Reroll with Inspiration (${inspirationCount ?? 0} left)`,
                  })}
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
