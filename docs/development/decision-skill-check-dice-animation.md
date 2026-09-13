# Decision: Render Animated Dice Cards for roll_skill_check

**Date:** 2026-09-13  
**Status:** Accepted  
**Scope:** `packages/server/src/routes/generate.routes.ts` (`cardEligible` tool result check)

## Context

Marinara provides an animated 3D/canvas dice glyph and result card component (`AnimatedDiceRoll`) for native dice rolls. When a tool call is executed during message generation, Marinara evaluates whether the tool result should be formatted as a player-facing dice card (`extra.diceRollResult` and SSE `tool_result` event).

Previously, this check was strictly limited to `tr.name === "roll_dice"`. As a result, custom dice engines or skill check tools like `roll_skill_check` (which return standard `{ notation, rolls, modifier, total }` dice results) were treated purely as background data passed to the model, with no visual dice roll animation or result card rendered in the chat UI.

## Decision

Expand `cardEligible` in `generate.routes.ts` to include `tr.name === "roll_skill_check"` whenever the tool call succeeds and the user is not impersonating.

Because `roll_skill_check` returns a compliant `DiceRollResult` shape:
1. `parseRollDiceToolResult(tr.result)` cleanly parses the notation, rolled dice, modifier, and total.
2. The live SSE `tool_result` event emits `diceRollResult`, triggering the animated roll during streaming.
3. The persisted message receives `extra.diceRollResult`, rendering the animated dice card and total in message history.

## Daily Rebase & Conflict Profile

This fork (`custom-mods`) is rebased against upstream daily.
- **Single-Line Predicate Change**: Modifies only the boolean condition inside the tool result iteration loop in `generate.routes.ts`.
- **No API / Schema / DB Changes**: Reuses existing `DiceRollResult` and message `extra` fields.
