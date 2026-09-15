// ──────────────────────────────────────────────
// Game: Skill Check Result Display
// ──────────────────────────────────────────────
import { useEffect, useState } from "react";
import type { SkillCheckResult } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { AnimatedSkillCheckResult } from "../dice/AnimatedSkillCheckResult";

interface GameSkillCheckResultProps {
  result: SkillCheckResult;
  onDismiss: () => void;
  canReroll?: boolean;
  inspirationCount?: number;
  onReroll?: () => void;
  isRerolling?: boolean;
}

export function GameSkillCheckResult({
  result,
  onDismiss,
  canReroll,
  inspirationCount,
  onReroll,
  isRerolling,
}: GameSkillCheckResultProps) {
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    setAnimate(false);
    const raf = requestAnimationFrame(() => setAnimate(true));
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [result]);

  return (
    <div
      className={cn(
        "pointer-events-auto mx-auto mb-2 flex w-full max-w-md justify-center transition-all duration-300",
        animate ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
      )}
    >
      <AnimatedSkillCheckResult
        result={result}
        animate
        onDismiss={onDismiss}
        className="skill-check-roll--game"
        canReroll={canReroll}
        inspirationCount={inspirationCount}
        onReroll={onReroll}
        isRerolling={isRerolling}
      />
    </div>
  );
}
