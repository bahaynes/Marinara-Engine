# Plan: Inspiration in Game Mode with a ruleset

Status: planned, not started. Written 2026-10-24 after commits `305f76e76` (per-character RP Inspiration) and `0eebacfe4` (fork skill systems removed).

## Where things stand

- **RP chats**: a ruleset that declares a live pool with id `inspiration` gives each character their own count (`metadata.gameRpInspiration`, keyed by normalized name). Helpers: `rpInspirationOf` / `rpInspirationAfter` in `packages/shared/src/utils/rp-inspiration.ts`; server: `applyRpInspirationChange` (`inspiration.service.ts`), `POST /game/inspiration-award`, the RP branch of `POST /game/inspiration-reroll`.
- **Game Mode, no ruleset**: one chat counter (`metadata.gameInspiration`, start 1, cap 4), `[inspiration: +1]` tags from the GM, a reroll button on failed `[skill_check]` results.
- **Game Mode, ruleset pinned**: Inspiration is switched off on purpose (commit `5d994e95c`): the GM reminder drops the `[inspiration:` tag and failing-forward coaching, the counter is hidden, and `/game/inspiration-reroll` refuses (`setupConfig?.enableInspiration === false || meta.gameRuleset`, `game.routes.ts`). Reason: a ruleset brings its own GM text and its own resources, and a fork D&D mechanic leaked into rulesets that did not have it.

## Goal

A ruleset that declares the `inspiration` pool gets Inspiration in Game Mode too, per character, using the same pool the RP side reads. A ruleset without the pool is unchanged (still off).

## Design

The pool is data; the after-failure reroll stays engine code (`resolution.spend` only re-throws dice before a roll and only for dice pools, `sheet-math.ts:1341`).

1. **Where the count lives.** Game-mode live state is `game_state_snapshots.ruleset_live`, keyed by normalized card name, and rides the snapshot so a swipe rewinds it. Spend and award write there, not to chat metadata. Template to copy: `useGameRulesetItem` / `restGameRulesetCharacter` in `services/game/game-item-use.service.ts` (read `parseStoredRulesetLive(row.rulesetLive)`, change the pool, write with `states.updateLatest(chatId, { rulesetLive: next })`).
2. **Award.**
   - Existing `[sheet: ...]` commands already change pools (`sheet-commands.ts`), and the GM sees the pool in the sheet block, so no new tag is strictly needed.
   - Optional: map the fork's `[inspiration: +1]` tag to the player's card pool when the pinned ruleset has the pool, so the GM prompt wording stays the same across modes. Prefer the sheet command if the GM already uses it reliably; decide after trying a real turn.
3. **Spend (reroll).**
   - In `POST /game/inspiration-reroll` (non-RP branch): when `meta.gameRuleset` resolves and the rolling card has a visible `inspiration` pool with value > 0, spend one point from `rulesetLive` and reroll through `resolveChatSkillCheck` (it already resolves the ruleset context). Keep the "cannot use on a check that already succeeded" guard.
   - Which card spends: the check's `who=` card (shared games: the named room card, as `resolveSkillCheckWithContext` does).
4. **GM prompt.** `gm-prompts.ts`: restore the Inspiration coaching line only when the ruleset has the pool; keep the natural-1 failing-forward block out of ruleset games.
5. **Client.** `GameSurface` already holds the ruleset and live state. The reroll button (`GameSkillCheckResult` / `AnimatedSkillCheckResult`, props `canReroll`, `inspirationCount`) takes its count and its gate from the roller's pool instead of `gameInspiration`; the HUD counter shows the player's pool.
6. **Setup toggle.** `GameSetupWizard` has `enableInspiration`; under a ruleset with the pool it should default on and stay a table choice.

## Prerequisite (engine, small)

The RP picker (`RoleplayRulesetSettings.tsx`) pins `options: {}`. If the package ships Inspiration as a ruleset **layer** (see `agents-5e-inspiration-layer.md`), RP chats need the layer toggles too. Reuse how the Game setup wizard lists `definition.layers` and writes `ruleset.options`.

## Tests

- Regression: pinned ruleset with the pool, snapshot with a card at 1 point, failed check, reroll route spends to 0, a second reroll is refused, a swipe (older snapshot) restores the point. Model on the item-use regressions for the snapshot handling.
- Regression: ruleset without the pool still refuses the reroll and still drops the coaching (extend `game-ruleset-fork-coaching.regression.ts`).
- Throwaway e2e on the smoke server (as done for RP): import `deploy/rulesets/medical.ruleset.json`, start a game on it, seed a failed check, hit the reroll route.

## Risks and open questions

- Reroll acts on an older message's check: live state is per snapshot, so only allow the latest turn, as item use does.
- Multiplayer rooms: the spender must be the card's owner; check `roomHostIdentity` / room character rules before exposing the button.
- The fork's reroll differs from SRD Inspiration (advantage). Name the pool/button "Inspiration (reroll)" in fork UI copy if both ever coexist.
- Cap: RP currently reads max/start from the ruleset's default sheet build (`ponytail` comment in `rp-inspiration.ts`). If a ruleset derives the max from a sheet field, game mode can use the card's real build; RP cannot until the client has each character's sheet. Decide whether that gap matters before shipping a field-driven max.

## Commit shape

1. `feat(game): Inspiration pool in ruleset games` (route, prompt, client count/gate)
2. `feat(roleplay): layer toggles in the RP ruleset picker` (only if the package ships a layer)
3. Regressions with each.
