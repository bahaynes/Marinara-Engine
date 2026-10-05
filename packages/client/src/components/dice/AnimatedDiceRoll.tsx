import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { X } from "lucide-react";
import { skillCheckDiceSumToTotal, type DiceRollResult } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { DiceGlyph, type DiceGlyphPhase, type DiceGlyphSize } from "./DiceGlyph";
import { getFaceLabel } from "./dice-shapes";
import { useTranslation as useUiTranslation } from "react-i18next";

type DiceRollMode = "chat" | "game" | "compact";

interface AnimatedDiceRollProps extends DiceRollResult {
  accentColor?: string;
  mode?: DiceRollMode;
  animate?: boolean;
  onDismiss?: () => void;
  hero?: boolean;
  highlightValue?: number;
  resolution?: "sum" | "successes";
  /** The per-die target a success pool counted with. Given, the dice that reached it are marked as
   *  the ones that counted and the rest are dimmed. Absent, every die reads as it always has. */
  threshold?: number;
}

function parseDiceSides(notation: string): number {
  const match = notation.trim().match(/^(?:\d+)?d(\d+)/i);
  return match ? Number.parseInt(match[1]!, 10) : 0;
}

function randomFace(sides: number): number {
  const safeSides = Math.max(1, sides || 20);
  return Math.floor(Math.random() * safeSides) + 1;
}

function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReducedMotion(query.matches);
    const handleChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", handleChange);
    return () => query.removeEventListener("change", handleChange);
  }, []);

  return reducedMotion;
}

export function shouldAnimateDiceRollMessage(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false;
  const createdMs = Date.parse(createdAt);
  if (!Number.isFinite(createdMs)) return false;
  return Date.now() - createdMs < 10_000;
}

export function AnimatedDiceRoll({
  notation,
  rolls,
  modifier,
  total,
  dc,
  character,
  skill,
  attribute,
  attributeModifier,
  proficiency,
  situationalModifier,
  reason,
  accentColor,
  mode = "chat",
  animate = false,
  onDismiss,
  hero,
  highlightValue,
  resolution = "sum",
  threshold,
}: AnimatedDiceRollProps) {
  const { t: localizeUi } = useUiTranslation();
  const sides = parseDiceSides(notation);
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animate && !reducedMotion;
  const rollKey = `${notation}:${rolls.join(",")}:${modifier}:${total}`;
  const isHero = rolls.length === 1 && hero !== false;
  const isLargePool = rolls.length >= 10;
  const glyphSize: DiceGlyphSize = isHero ? "hero" : isLargePool || mode === "compact" ? "compact" : "standard";
  const [phase, setPhase] = useState<DiceGlyphPhase>(shouldAnimate ? "cast" : "settled");
  const [displayValues, setDisplayValues] = useState(rolls);

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayValues(rolls);
      setPhase("settled");
      return;
    }

    setPhase("cast");
    setDisplayValues(rolls.map(() => randomFace(sides)));

    const castTimer = window.setTimeout(() => setPhase("tumble"), 130);
    const interval = window.setInterval(() => {
      setDisplayValues(rolls.map(() => randomFace(sides)));
    }, 72);
    const impactTimer = window.setTimeout(
      () => {
        window.clearInterval(interval);
        setDisplayValues(rolls);
        setPhase("impact");
      },
      Math.min(980, 620 + rolls.length * 46),
    );
    const settledTimer = window.setTimeout(() => setPhase("settled"), Math.min(1180, 820 + rolls.length * 48));

    return () => {
      window.clearTimeout(castTimer);
      window.clearInterval(interval);
      window.clearTimeout(impactTimer);
      window.clearTimeout(settledTimer);
    };
  }, [rollKey, rolls, shouldAnimate, sides]);

  const style = accentColor ? ({ "--dice-accent": accentColor } as CSSProperties) : undefined;
  const modifierText = modifier !== 0 ? `${modifier > 0 ? "+" : ""}${modifier}` : "";
  const sumsToTotal = resolution === "sum" && skillCheckDiceSumToTotal({ rolls, modifier, total, resolution });
  const rollText = useMemo(() => rolls.map((roll) => getFaceLabel(sides, roll)).join(", "), [rolls, sides]);
  const totalVisible = phase === "impact" || phase === "settled";
  // A pool that reported the target it counted with marks the dice that reached it.
  const countedFrom = resolution === "successes" && threshold != null ? threshold : null;

  const hasFormulaBreakdown =
    sumsToTotal && (attributeModifier !== undefined || proficiency !== undefined || situationalModifier !== undefined);
  const breakdownRemainder = useMemo(() => {
    if (!hasFormulaBreakdown) return 0;
    const accounted = (attributeModifier ?? 0) + (proficiency ?? 0) + (situationalModifier ?? 0);
    return modifier - accounted;
  }, [hasFormulaBreakdown, modifier, attributeModifier, proficiency, situationalModifier]);
  const reasonDescription = useMemo(() => {
    if (!reason) return "";
    const parts = reason.split(" · ");
    if (parts.length >= 3) return parts.slice(2).join(" · ").trim();
    if (parts.length === 2 && !parts[1]?.includes("(")) return parts[1]?.trim() ?? "";
    if (parts.length === 1 && !parts[0]?.includes("(") && !parts[0]?.includes(notation)) return parts[0]?.trim() ?? "";
    return "";
  }, [reason, notation]);

  return (
    <div
      className={cn(
        "dice-roll-card",
        "dice-tray",
        `dice-roll-card--${mode}`,
        isHero && "dice-tray--hero",
        isLargePool && "dice-tray--pool",
        shouldAnimate && "is-animated",
        phase === "settled" && "is-settled",
        phase === "impact" && "is-impacting",
      )}
      style={style}
    >
      <div className="dice-roll-header">
        <span className="dice-roll-header-mark" aria-hidden="true">
          ✦
        </span>
        <span className="min-w-0 truncate">
          {skill ? (
            <>
              {character && <span className="opacity-80 font-normal">{character} · </span>}
              <strong className="font-semibold text-[var(--foreground)]">{skill}</strong>
              {attribute && <span className="opacity-75 font-normal"> ({attribute.toUpperCase()})</span>}
              {" · "}
              <span className="opacity-90">{notation}</span>
            </>
          ) : (
            <>
              {character && <span className="opacity-80 font-normal">{character} · </span>}
              {notation}
            </>
          )}
          {dc !== undefined && (
            <>
              {" "}
              · {localizeUi("ui.dice.animatedskillcheckresult.dc")} {dc}
            </>
          )}
        </span>
      </div>

      {reasonDescription && (
        <div
          className="px-2 py-0.5 text-xs italic text-[var(--muted-foreground)] line-clamp-2 select-text"
          title={reasonDescription}
        >
          {reasonDescription}
        </div>
      )}

      <div
        className="dice-stage"
        aria-label={localizeUi("ui.dice.animateddiceroll.rolledValue1Value2", { value1: notation, value2: rollText })}
      >
        {rolls.map((roll, index) => {
          const shown = displayValues[index] ?? roll;
          const emphasized =
            countedFrom == null ? highlightValue == null || roll === highlightValue : roll >= countedFrom;
          return (
            <DiceGlyph
              key={`${index}-${roll}`}
              sides={sides}
              value={shown}
              phase={phase}
              size={glyphSize}
              index={index}
              emphasized={emphasized}
              hero={isHero}
            />
          );
        })}
      </div>

      {/* Which dice counted is shown by dimming the ones that did not, which is a picture. The rule
          behind it is said in words here so it reaches a screen reader too. */}
      {countedFrom != null && (
        <span className="sr-only">{localizeUi("ui.dice.animateddiceroll.countedFrom", { value: countedFrom })}</span>
      )}

      <div className="dice-roll-footer">
        <span className="dice-roll-breakdown">
          {/* Only show the addition when the dice genuinely add up to the total.
              They do not under advantage/disadvantage (one die is discarded) or
              in pool systems that count successes, and printing "4 + 1 + 9 = 1"
              makes correct results look like broken arithmetic. */}
          {sumsToTotal ? (
            <>
              {rolls.join(" + ")}
              {hasFormulaBreakdown ? (
                <>
                  {attributeModifier !== undefined && attributeModifier !== 0 && (
                    <>
                      {" "}
                      {attributeModifier > 0
                        ? localizeUi("ui.dice.breakdown.plus", { value: attributeModifier })
                        : localizeUi("ui.dice.breakdown.minus", { value: Math.abs(attributeModifier) })}{" "}
                      ({attribute ? attribute.toUpperCase() : localizeUi("ui.dice.breakdown.attribute")})
                    </>
                  )}
                  {proficiency !== undefined && proficiency !== 0 && (
                    <>
                      {" "}
                      {localizeUi("ui.dice.breakdown.plus", { value: proficiency })} (
                      {localizeUi("ui.dice.breakdown.proficiency")})
                    </>
                  )}
                  {situationalModifier !== undefined && situationalModifier !== 0 && (
                    <>
                      {" "}
                      {situationalModifier > 0
                        ? localizeUi("ui.dice.breakdown.plus", { value: situationalModifier })
                        : localizeUi("ui.dice.breakdown.minus", { value: Math.abs(situationalModifier) })}{" "}
                      ({localizeUi("ui.dice.breakdown.bonus")})
                    </>
                  )}
                  {breakdownRemainder !== 0 && (
                    <>
                      {" "}
                      {breakdownRemainder > 0
                        ? localizeUi("ui.dice.breakdown.plus", { value: breakdownRemainder })
                        : localizeUi("ui.dice.breakdown.minus", { value: Math.abs(breakdownRemainder) })}
                    </>
                  )}
                </>
              ) : (
                modifierText && ` ${modifierText}`
              )}
            </>
          ) : (
            <>
              {rolls.join(" · ")}
              {resolution === "sum" && modifierText && ` ${modifierText}`}
            </>
          )}
        </span>
        <span className={cn("dice-roll-total", totalVisible && "is-visible")}>
          {sumsToTotal ? " = " : " → "}
          {total}
          {resolution === "successes" ? (
            <> {localizeUi("ui.dice.animateddiceroll.successCount", { count: total })}</>
          ) : null}
        </span>
      </div>

      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="dice-roll-dismiss"
          aria-label={localizeUi("ui.dice.animateddiceroll.dismissDiceRollResult")}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
