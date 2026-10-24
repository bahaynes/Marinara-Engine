# Plan: optional Inspiration for the 5e SRD ruleset (Marinara-Agents repo)

Status: planned, not started. Written 2026-10-24. Work happens in `~/git/marinara-agents` (fork of `Pasta-Devs/Marinara-Agents`), not in this repo.

## Why

The Engine fork now gives each roleplay character their own Inspiration when the pinned ruleset declares a live pool with id `inspiration` (see `inspiration-in-ruleset-games.md`). `local/medical` has one. The 5e SRD 5.1 package (`packages/ruleset-5e-2014`, 0.9.1, Capability API 1.46, `layers: []`) has none, so 5e chats fall back to a single chat-wide counter. Ruleset packages ship from the agents repo, so the 5e option belongs there.

SRD 5.1 does define Inspiration (an optional award for roleplay; spend it for advantage on one roll), so a tracked pool is a legitimate 5e resource for every Engine user, not a fork convenience: in an upstream Engine it is simply a pool the GM awards and spends with `[sheet: ...]` commands. The fork's after-failure reroll is Engine-side and is not part of this package.

## Design (all inside today's ruleset schema; no Engine change)

Everything below uses only existing ruleset primitives. The agent must confirm each against `docs/extending/writing-rulesets.md` (in the Engine repo) and `node scripts/validate-catalog.mjs`.

- A sheet **enum field** `inspiration` (values `off`, `on`, default `off`). Section: identity.
- A live **pool** `inspiration`, label "Inspiration", `hideWhen: { field: "inspiration", equals: "off" }`, `start: "empty"` with `startFrom: { const: 1 }` or `start: "full"` (decide: the fork starts characters with 1).
- Pool **max** from a derived value `inspiration_max` (`enumTable` over a second enum field `inspiration_banking`: `single` -> 1 (SRD), `banked` -> 4). Default `single`.
- Two **layers** (the `layers` array; each can only remove enum values and set a new default, per `layerFieldSchema`):
  1. `inspiration` ("Inspiration"): removes `off` from field `inspiration`, default `on`. Summary: "Characters earn and spend Inspiration. The GM awards it for roleplay; spend it for advantage (or, in the fork, a reroll)."
  2. `inspiration-banked` ("Banked Inspiration"): removes `single` from `inspiration_banking`, default `banked`. Summary: "Characters can hold up to 4 points instead of 1." Conflicts: none; it should only matter when layer 1 is on.
- `gm.checkGuidance` addition via the layer's `gm.guidance`: when Inspiration is on, award it for clever problem-solving, bold in-character risks and heroic beats, not routinely; record awards and spends with the sheet command.

Check before building: the smallest Capability API that supports `layers` and layer `fields`; whether `startFrom` or `start: full` fits; that the layer-applied definition validates (`rulesetEffectiveDefinitionSchema`); that a pool hidden by default is skipped by the Engine's live-state reader (it is: `listRulesetLivePools` skips hidden pools) so the unlayered 5e behaves exactly as today.

## Why a layer and not an always-on pool

Rulesets must not teach a table a mechanic it did not choose (commit `5d994e95c` removed fork Inspiration from ruleset games for that reason). A default-off field plus an opt-in layer keeps 5e byte-identical until someone turns it on, and the Engine fork can detect the pool only when it is visible.

## Engine-side dependency

Layers only reach a chat through the pin's `options`. The Game setup wizard writes them; the RP picker does not yet (it pins `options: {}`). See "Prerequisite" in `inspiration-in-ruleset-games.md`. Until that lands, test the package with a pin that already carries the option, or in a Game Mode setup.

## Delivery (follow the agents repo's own rules)

- Branch from `staging`, open an issue first, draft PR when work starts, ready only after validation. Target `staging`; never `main`.
- Do not tag or assign maintainers, and do not volunteer anyone's time from the user's account (see `AGENTS.md` in that repo and the user's upstream etiquette notes).
- Bump `packages/ruleset-5e-2014` version (a minor bump needs a `CHANGELOG.md` entry), run `node scripts/build-ruleset-packages.mjs`, then the baseline gates: `npm run check`, `node scripts/test-catalog-lanes.mjs`, `node scripts/validate-package-locales.mjs`, `node scripts/validate-catalog.mjs`, `node scripts/tests/catalog-release-notes.regression.mjs`. Commit payload, manifest, ZIP, catalog entry and captured sources together; never hand-edit generated outputs or the generated catalog files.
- Locales: any new user-facing label or summary needs the package's `locales` entries (`validate-package-locales.mjs`).
- Fork copy (optional): the fork keeps its own packages under `fork/packages/` (for example `ruleset-wasteland-special`) and `fork/tools/check.sh` / `fork/tools/install.sh`. If upstream is slow, a fork-only copy of the layered 5e can ship there and be dropped when upstream merges. Medical could move there too, replacing the manual import of `deploy/rulesets/medical.ruleset.json` in the Engine repo.

## Prompt to hand to the executing agent

```
You are working in ~/git/marinara-agents (a fork of Pasta-Devs/Marinara-Agents). Read AGENTS.md and CONTRIBUTING.md first and follow them; they override anything below.

Task: add an optional Inspiration mechanic to the 5e SRD ruleset package packages/ruleset-5e-2014, as a default-off sheet field plus two ruleset layers, so 5e stays byte-identical until a table turns it on.

Facts:
- The Engine reads a live pool with id "inspiration" (a visible one) as a character's Inspiration. The max and start come from the pool; a hidden pool is ignored.
- The package currently has layers: [] and no Inspiration. It is hash-pinned and generated: do NOT hand-edit generated catalog files, ZIPs, hashes or catalog entries; edit ruleset.json (non-generated parts) and rebuild with node scripts/build-ruleset-packages.mjs.
- Ruleset format reference: docs/extending/writing-rulesets.md and docs/extending/ruleset.schema.json in the Marinara Engine repo (~/git/marinara-engine). A layer can only remove enum values from a field and give it a new default, append GM guidance, swap the ladder, hide catalog entries or remove coins. It cannot add a pool; so the pool must exist in the base ruleset and be hidden by default.

Design to implement (verify every piece with scripts/validate-catalog.mjs before building on it):
1. Sheet enum field "inspiration" (off/on, default off) and enum field "inspiration_banking" (single/banked, default single), both in the identity section.
2. Live pool "inspiration" (label "Inspiration"), hideWhen field inspiration equals off, max from a derived enumTable "inspiration_max" over inspiration_banking (single -> 1, banked -> 4), starting with 1 point.
3. Layer "inspiration": removes "off" from field inspiration, default "on", with a short summary and gm.guidance telling the GM to award Inspiration sparingly for clever play, bold in-character risks and heroic beats, and to record awards and spends with the sheet command.
4. Layer "inspiration-banked": removes "single" from inspiration_banking, default "banked"; summary says characters can hold up to 4 points instead of 1.
5. Find the lowest Capability API that supports layers and layer fields and raise the manifest's capabilityApi only as far as needed. Bump the package version, add a CHANGELOG.md entry in plain words, add package locale strings, update the README if it lists layers or options.

Proof required: validate-catalog passes; a unit or regression check (per the repo's conventions) that the unlayered ruleset's sheet and live pools are unchanged and that the layered effective definition has a visible inspiration pool with max 1, and 4 with both layers; all baseline gates pass. Do not claim any gate passed that you did not run.

Process: open an issue first, work on a branch from staging, open a draft PR early, mark it ready only after local validation and self-review. Do not tag or assign maintainers and do not volunteer anyone's time. Keep the diff minimal. Report what you ran and any gate you could not run.
```
