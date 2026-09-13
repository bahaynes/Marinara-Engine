# Decision: Inject RPG Stats into Custom Tool Hidden Context

**Date:** 2026-09-12  
**Status:** Accepted  
**Scope:** `packages/server/src/services/generation/tool-resolution-runtime.ts` (`buildCustomToolHiddenContext`)

## Context

Marinara supports custom webhook and script tools configured with `includeHiddenContext: true`. When enabled, the execution runtime passes a structured `context` object containing active chat metadata, participants, macros, and game state.

External game mechanics microservices (such as `dnd-engine` for D&D 5.5e checks, or external combat/resolution engines) need authoritative access to character attributes, ability scores, level, and HP pools to calculate modifiers and validate checks independently of the model's self-reported prompt arguments.

Previously, `buildCustomToolHiddenContext` mapped `characters` to basic `{ id, name }` tuples and omitted `rpgStats` for both the participant character cards and the user's active persona. This forced external tools to either:
1. Require the LLM to inspect the prompt and pass all relevant attributes manually as arguments (which is error-prone and vulnerable to hallucination), or
2. Fall back to un-modified baseline stats (e.g. all 10s, level 1).

## Decision

Inject `characterRpgStats` and `personaRpgStats` directly into the return object of `buildCustomToolHiddenContext()`:

1. **`characterRpgStats`**: A map from character name (and active persona name / `"Player"`) to their configured `RPGStatsConfig`.
   - Keys include active character names possessing `rpgStats`.
   - Keys include `personaName ?? "Player"` if the active persona has configured `rpgStats`.
2. **`personaRpgStats`**: The raw `persona.rpgStats` object (or `null` if disabled/absent).

## Daily Rebase & Conflict Profile

This fork (`custom-mods`) is rebased against upstream daily. The change has an exceptionally low conflict profile:
- **Zero Schema / DB Changes**: Operates solely in memory on the runtime `CustomToolHiddenContext` (which is typed as `Record<string, unknown>`).
- **Additive Return Properties**: Appends two fields to an existing object literal within a small private helper function in `tool-resolution-runtime.ts`.
- **Backward Compatible**: Existing custom tools that ignore these keys are unaffected. Tools expecting `characterRpgStats` or `personaRpgStats` receive structured stat blocks without model intervention.
