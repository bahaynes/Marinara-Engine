# Custom-Mods Fork Documentation

This repository is a local fork of [**Pasta-Devs/Marinara-Engine**](https://github.com/Pasta-Devs/Marinara-Engine), maintained on the **`custom-mods`** branch for our personal use at [**bahaynes/Marinara-Engine**](https://github.com/bahaynes/Marinara-Engine).

---

## 1. Fork Purpose & Philosophy

This fork exists to host custom mods and operational enhancements that tailor Marinara Engine to our specific workflows and hardware. Examples include:

- **Tabletop Combat & Mini-games**: ATLS trauma triage mini-game (a combat style on the upstream combat-style registry).
- **Provider & Generation Tweaks**: GLM 5.x reasoning effort forwarding, custom quota telemetry & polling HUD, context sliding windows.
- **Deployment**: homeserver deploy tooling (`scripts/marinara-deploy.py`), Docker caching optimizations.
- **Developer & Diagnostic Tooling**: Fast staged pre-commit hooks, detailed world-state tracking logs.

Because we want to benefit from the continuous improvements of upstream Marinara Engine without maintaining a permanently diverging codebase, our core operational policy is:

> **1. All changes must be minor, clean, and easily rebased onto upstream.**
> **2. We frequently drop commits if upstream fixes the issue or ships equivalent functionality.**

---

## 2. Guidelines for Agents & Contributors

When implementing changes or fixing issues in this repository:

### A. Keep Changes Minor and Easily Rebased

- **Minimize the footprint in upstream files**: When adding a feature, place new logic in dedicated files/modules whenever possible (e.g. `packages/client/src/components/game/triage/`, `deploy/rulesets/`). Hook into upstream files with minimal, clean insertion points.
- **Do NOT edit `CHANGELOG.md`**: Upstream updates the changelog continuously across PRs and releases. Carrying local modifications in `CHANGELOG.md` creates guaranteed merge conflicts on every rebase. Local changes are documented in commit messages and this file.
- **Avoid sweeping changes**: Never perform cosmetic refactorings, wide-ranging file renames, or bulk formatting passes across upstream files. These create merge conflicts during rebasing.
- **Honor Ponytail discipline**: Skip unnecessary abstractions, reuse existing patterns, write the minimum viable code, and avoid speculative complexity.

### B. Commits Are Ephemeral — Drop When Fixed Upstream

- **Decouple bug fixes from custom features**: If you are fixing a bug in upstream code or working around an upstream issue, put it in a separate, isolated commit with a clear message (e.g. `fix(generation): ...`). Never combine a temporary upstream bug fix with a custom feature.
- **Drop superseded commits**: When rebasing onto new upstream releases, always check whether upstream has fixed the issue or introduced an upstream-native implementation. If so, **drop our local commit** during interactive rebase (`git rebase -i`). We do not keep redundant or competing implementations of things upstream already handles.

### C. Preserve Uncommitted Working Tree Edits

- The working tree frequently contains diagnostic logging, experimental changes, or WIP tasks from the user (for example, diagnostic logs in `generate.routes.ts` or tweaks in `GameSurface.tsx`).
- **Never run destructive git operations** (such as `git reset --hard` or `git checkout -- .`) without explicit user instruction.
- Check `git status` and `git diff` to ensure you only stage and touch files relevant to your task.

---

## 3. Remote Setup & Branching Model

| Remote         | URL                                                 | Role                                |
| :------------- | :-------------------------------------------------- | :---------------------------------- |
| **`upstream`** | `https://github.com/Pasta-Devs/Marinara-Engine.git` | Canonical upstream source of truth. |
| **`origin`**   | `https://github.com/bahaynes/Marinara-Engine.git`   | Personal fork repository.           |

- **Primary Branch**: `custom-mods`
- **Rebase Target**: `upstream/staging` (or `upstream/main`)

All custom commits sit directly on top of `upstream/staging`.

---

## 4. Upstream Rebase Runbook

Rebasing `custom-mods` onto upstream should be done regularly using the following workflow:

### Step 1: Inspect Current State

```bash
git fetch upstream

# Find the merge base
BASE=$(git merge-base upstream/staging HEAD)

# Review local commits on custom-mods
git log --oneline ${BASE}..HEAD

# Review incoming upstream commits
git log --oneline HEAD..upstream/staging
```

### Step 2: Check for Already-Upstreamed Changes

```bash
git cherry -v upstream/staging
```

Commits marked with `-` have already been applied upstream and should be dropped.

### Step 3: Interactive Rebase

```bash
git rebase -i upstream/staging
```

In the interactive todo list:

1. **`drop`** any commits that upstream has solved or superseded.
2. **`pick`** custom-mod features and remaining local fixes.
3. If conflicts arise, favor upstream's architectural direction and re-apply our custom delta with the minimal necessary diff.

### Step 4: Validate

After completing the rebase:

```bash
pnpm check
```

Verify that TypeScript compilation, linting, and tests pass cleanly.

---

## 5. Illustrator: reference cast and card-less characters

All of this runs on the stock **Illustrator**. The separate Illustrator 2 package (agents fork, `fork/packages/illustrator-2`) is deprecated: its behaviour is these engine settings plus its prompt template, which now lives on the stock agent as the **Reference Cast** template (instance config). Engine hooks: `packages/server/src/services/image/image-agent-comfy-extensions.ts` and `illustrator-npc-cast.ts`.

**Agent settings (on the Illustrator's agent config; inert unless set)**

- `presentCharactersOnly` (or chat metadata `illustratorPresentCharactersOnly`): trims character cards to the tracker's `presentCharacters` (plus anyone named in the reply) and drops absent names from references using this turn's tracker snapshot. A card whose ensemble Appearance names a present member stays. The agent gets its own batch so the trim never reaches other agents.
- `referenceOrder: "requested"`: references follow the writer's `characters` order, and only the image prompt (not the whole reply) is scanned for extra names.

Keep a chat's image **style profile** short (5-8 tags) and the image connection's `imagePromptInstructions` consistent with the template (e.g. "One frozen moment, 30-70 words, at most two people, placed left/right."); instructions like "fully describing the desired outcome" push the writer back to long, crowded prompts.

**Characters without a card of their own**

- **Members of a multi-character card**: write their looks in upstream's ensemble form, `[Name] traits | [Name] traits`, in the card's Appearance or image-only override, body only (no clothes). Each member then gets only their own segment, in layout boxes and on plain prompts (Attach Card Appearance on). `**Name:**` headers are not split.
- **NPCs met in play**: NPC Registry 0.3.0+ (agents fork) stores each NPC's `looks`, body only. The extractor fills them from the story; the roster modal (tracker panel) edits them, and an edited value is pinned. Promote to Card copies them to the card's Appearance.
- **Outfits** come from this turn's Character Tracker row, appended to plain prompts as "Name wears ..." (Attach Card Appearance or avatar references on) and put in layout boxes. The tracker's context lists present rows with a blank appearance or outfit and asks for them (`character-tracker-looks.ts`; still a model request).
- **Portraits**: with avatar references on, a requested card-less person with known looks and no portrait gets one generated from those looks before their first picture (`ensureIllustratorNpcPortraits`, body only), stored as their registry avatar and reused as their reference after that.
- Looks priority for a layout box: card (or its ensemble segment), lore `Looks:` line, NPC Registry looks, tracker appearance.

**Prompt tokens.** The writer may write `[[Name]]`; after references are resolved it becomes `image N` in actual slot order (Maps location first, avatar-less characters skipped, duplicates collapsed, 4 slots on ComfyUI, 6 elsewhere). `[[location]]` maps to the location slot. Names without a slot stay plain names. With `referenceOrder: "requested"`, plain mentions of a slotted character (full name or any name word of 3+ letters, possessives included) are rewritten to `image N` too; a name word shared by two slotted characters stays as written.

**Workflow placeholders (local ComfyUI only; not RunPod or SwarmUI)**

- `%reference_count%` (number) and `%reference_enabled_01%`..`%reference_enabled_04%` (JSON booleans, true only for real references). For the DaSiWa reference stack set `"enabled": "%reference_enabled_02%"` etc. on each `DaSiWa_OptionalLoadImage`, keeping `%reference_image_name_0N%` (with the placeholder-upload option on) as the image.
- Agent-chosen variables: add a top-level `marinara_variables` object to the workflow JSON. Marinara strips it before queueing, shows it to image agents, validates their `comfyVariables` answer and always fills a value (the default when absent or invalid). Read the values as `%var_<name>%`:

```json
{
  "marinara_variables": {
    "shot": {
      "type": "enum",
      "values": ["close-up", "medium shot", "wide shot"],
      "default": "medium shot",
      "description": "camera framing"
    },
    "detail_lora": {
      "type": "number",
      "min": 0,
      "max": 1,
      "default": 0.6,
      "description": "strength of the detail LoRA"
    }
  },
  "151": {
    "class_type": "PrimitiveStringMultiline",
    "inputs": { "value": "%prompt% %var_shot%. <lora:detail:%var_detail_lora%>" }
  }
}
```

Types: `string` (≤200 chars), `number` (clamped to `min`/`max`), `boolean`, `enum` (`values` required). Names are `[a-z0-9_]`, up to 16 variables.

**Why the Reference Cast template is this strict.** Measured on 86 stock-Illustrator prompts sent to FLUX.2 klein (2026-09-24..10-02, Gemma4 prompt writer): median 181 words; style text repeated in 75 (the engine asks for style in both the `style` field and the prompt, then prepends `style`); 3+ body traits in 71 despite avatar references; 3+ placed subjects in 42; mood/scent lines in 39; motion verbs (flickering, trembling) in 32; unnamed extras in 19; sequence words in 19. Each clause is drawn at the same instant, which shows up as fused objects and extra hands. Re-measure with `python3 scripts/fork/illustrator-prompt-metrics.py --since <iso> --model klein` (read-only, uses `mari` in the container).

---

## 6. Shared prompt cache for individual group roleplay

Chat setting **Shared Prompt Cache** (`groupSharedPromptCache`, individual roleplay groups only, off by default). Stock individual mode builds a different prompt per responder: other characters' cards are stripped from the system prompt and history roles are reassigned (the responder's turns become `assistant`, everyone else's `user`). Each character therefore has its own prompt cache, and every reply rewrites what the others said since its last turn (a 4-character Opus test chat cost ~1.6x its uncached size).

With the toggle on (`scopeSharedGroupMessagesForTarget` in `prompt-message-scope.ts`), every character's card is stripped from the prompt, history keeps its stored roles with speaker names, and the responder's own card plus `Respond ONLY as <name>.` go in a final user message. Everything before that message is identical for all responders, so each responder reads the previous one's prompt from cache, and no character ever sees another's card. Character-bound lorebook entries and Advanced Memory stay scoped to the responder (they can differ after the history); targeted regex scripts are not applied per responder.

Trade-offs: characters know who they are from the final instruction and their card, not from history roles; the card is billed every call (at 1x only with the passthrough's tail-marker drop). Gated by `usesSharedGroupPromptCache` in `generate-route-utils.ts`, mirrored in `dry-run-route.ts`. Measure with `chat_cache_report.py` (minecraftdocker) before and after.

---

## 7. Lorebook Keeper instance config (no code)

The live `marinara` Keeper is tuned through config, not fork code. As of 2026-10-11: `agent_configs` Lorebook Keeper `settings.runInterval` is **1** (was 8) and `contextSize` stays 5; the prompt is the stock-shaped one with **no example names**. Never put story names in an agent prompt: the model treats them as vocabulary (a "Brother Tamsin" example sat in the prompt and the name kept resurfacing in new characters).

Measured on the first 304 messages of one chat (one run per arm, so treat small differences as noise): the old cadence (every 8th message, 5-message window, prompt reads only the latest assistant message) left about 40% of assistant messages unread and the Keeper was only enabled 3 days into the story. Reading every message took tracker-NPC coverage from 7/16 to 13/16 and near-duplicate entry pairs from 6 to 2 with the same prompt. Adding dedup-by-containment, mandatory entries for named people, and "character never lore" rules did not beat it (broad version: 14/16 but 67 entries and 5 duplicate pairs; people-only version: 13/16, 50 entries, 5 duplicate pairs).

Reproduce: branch the chat at a message, point the branch's `lorebookKeeperTargetLorebookId` and `activeLorebookIds` at an empty scratch lorebook, then `POST /api/generate/retry-agents` with `{ chatId, agentTypes: ["lorebook-keeper"], lorebookKeeperBackfill: true }` (one local-model call per assistant message, about 25 s each). The backfill cursor is the chat's last successful Keeper run, so it cannot reach history from before the first run; a fresh branch has no runs. Per-chat `agentOverrides` only toggles agents, so a candidate prompt can only be tested by patching the global config.

---

## 8. Related Resources

- **Agent Skill**: [`.claude/skills/custom-mods/SKILL.md`](.claude/skills/custom-mods/SKILL.md)
- **Repo Agent Rules**: [`CLAUDE.md`](CLAUDE.md) (fork rules), [`AGENTS.md`](AGENTS.md) (upstream guide, read on demand)
- **Upstream Contribution Guide**: [`CONTRIBUTING.md`](CONTRIBUTING.md) (for upstream PR conventions when contributing back to `Pasta-Devs/Marinara-Engine`)

## RP skill checks from rulesets

RP chats pin a ruleset in Chat Settings > Skill Checks (the same `gameRuleset` pin a game uses). `[roll: ...]` skill and ability checks then take their modifier from each character's or persona's ruleset sheet; with no pin, or no sheet, they roll plain dice.

- **D&D**: install the 5e SRD 5.1 ruleset package (needs the staging preview catalog, `BUILD_BRANCH=staging`).
- **Medical**: `deploy/rulesets/medical.ruleset.json` is a fork-local ruleset with the Medical Drama skills. Import it once with `POST /api/game-rulesets/import` (body `{"definition": "<the file's text, as a JSON string>"}`); it files under `local/medical`.
- Give each character a sheet for the ruleset in the character editor's ruleset sheets section.
- **Inspiration**: a ruleset with a live pool whose id is `inspiration` (the medical ruleset has one: start 1, max 4) gives RP characters their own Inspiration. `[inspire]` awards the persona's pool; the reroll button on a failed roll spends the roller's own point. Rulesets without the pool keep the chat-wide `gameInspiration` counter. The reroll itself is engine code (`rerollRoleplayRoll`), because `resolution.spend` re-throws dice before the result is known and only for dice pools.

## ComfyUI layout scene composer (MOSS-Image bounding boxes)

Code: `packages/server/src/services/image/comfyui-layout-placeholders.ts`, plus short hooks in `generate.routes.ts` and `generate/retry-agents-route.ts` (look for `comfyLayoutActive`), the limit in `illustrator-background-generation.ts`, and the writer instruction in `character-prompts.ts`, and the template rewrite + result fold in `agent-executor.ts`. Test: `scripts/regressions/comfyui-layout.regression.ts`.

- **Opt-in by workflow.** A plain ComfyUI image connection whose workflow holds `%layout_bboxes%` (Create Bounding Boxes `bboxes` input) gets layout images: MOSS (`%layout_character_boxes%` on MOSS-Image Layout Prompt) or the Flux regional stack (`Flux2RegionalReferenceStack`, "Gaming: Flux Bounding"). Other connections are untouched. Use a separate connection for it rather than editing a shared one.
- **Writer vs engine.** The Illustrator's writer returns the empty set as `setting`, `lighting` and `props` (no people or animals; the engine joins them into `prompt`) and each character's pose/action in `characterPrompts`; companions ride in their person's action. Box instructions forbid cross-character mentions and motion/merging verbs. The writer prompt marks non-standard forms with `"transformed": true` and optional `role` or `bbox` staging instead of banning shadow or smoke bodies. The engine adds two things per box. **Body**: card/persona Appearance (image override first; an ensemble card gives a member only its own `[Name]` segment), then a lorebook `Looks:` line (entry named for the character) or `<Name> looks:` line, then NPC Registry looks, then the Character Tracker's appearance. A character with a reference image or transformed state gets no static card body text. **Outfit**: this turn's Character Tracker outfit, then a lorebook `Outfit:` / `<Name> outfit:` line. Transformed characters skip static outfits. Keep clothing out of Appearance and `Looks:` so the tracker can change it. A companion named in an action brings its `<Name> looks:` line. Each box logs `[illustrator] layout box <name>: looks from <source> (...), outfit from <source>`.
- **Form awareness.** `isCharacterTransformedInScene` detects non-standard forms via `transformed: true` on `characterPrompts` or a parenthetical `(... form)` tag in tracker `appearance`. Transformed characters drop human reference portraits in `filterLayoutCharacterReferences` and omit static card appearance and clothing. When `appearance` is empty, an outfit notation such as `None (Dragon form)` still resolves as an empty outfit rather than a form change.
- **Box text** reads action, outfit, then body (capped at 40 words): the Flux regional stack keeps about 128 tokens of a box, so the pose must come first. Repeated leading self-names in box actions are stripped before prepending `<Name>: `.
- **Box order = reference slot.** The Flux regional stack pairs box k with reference image k, and Create Bounding Boxes drops any other key (`ref_slot`, `name`). So boxes with a reference come first in slot order, references for unboxed or transformed people are dropped, and the Maps location image goes last, only when every box has a reference (`alignComfyLayoutReferences`).
- **Boxes.** `resolveCharacterBoundingBox1000` evaluates bounding boxes through a three-tier solver: explicit `bbox` coordinates clamped to 0..1000 with a minimum 150x150 span; named `role` presets (`ROLE_PRESETS_1000`), including overlapping `center_left` (`[120, 180, 960, 560]`) and `center_right` (`[120, 440, 960, 820]`); or full-height columns placed by horizontal position `x`. For two characters with close contact (`|x0 - x1| < 0.25`), column borders expand by 60 units inward to provide contact overlap.
- **Scene fields.** In layout mode, `rewriteIllustratorTemplateForComfyLayout` rewrites both the stock `Illustration` template and the `Reference Cast` template in `agent-executor.ts` (`applyComfyLayoutTemplate`) to swap `"prompt"` for `setting`, `lighting`, and `props`; any other template is left as is and logs `layout scene fields not applied`. Bench 2026-11-01, 20 scenes: an extra person in 5/18 images with `prompt`, 5/19 with the rule reworded, 0/20 with scene fields.
- **Cap.** Chat metadata `illustratorLayoutMaxCharacters` (integer, below the connection cap of 6).
- **Style.** The profile's Style text is writer guidance only (upstream #7357 strips a verbatim copy). Put image-facing style words in the profile's **Positive tags**, which always reach the image model.
- **Drop when** upstream sends `characterPrompts` to ComfyUI layout workflows itself.
