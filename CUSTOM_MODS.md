# Custom-Mods Fork Documentation

This repository is a local fork of [**Pasta-Devs/Marinara-Engine**](https://github.com/Pasta-Devs/Marinara-Engine), maintained on the **`custom-mods`** branch for our personal use at [**bahaynes/Marinara-Engine**](https://github.com/bahaynes/Marinara-Engine).

---

## 1. Fork Purpose & Philosophy

This fork exists to host custom mods and operational enhancements that tailor Marinara Engine to our specific workflows and hardware. Examples include:
- **Tabletop Combat & Mini-games**: ATLS trauma triage mini-game (a combat style on the upstream combat-style registry).
- **Provider & Generation Tweaks**: GLM 5.x reasoning effort forwarding, custom quota telemetry & polling HUD, context sliding windows.
- **Deployment Bundles**: Google Compute Engine + Cloudflare Tunnel zero-trust deployment bundle (`deploy/gcp/`), Docker caching optimizations.
- **Developer & Diagnostic Tooling**: Fast staged pre-commit hooks, detailed world-state tracking logs.

Because we want to benefit from the continuous improvements of upstream Marinara Engine without maintaining a permanently diverging codebase, our core operational policy is:

> **1. All changes must be minor, clean, and easily rebased onto upstream.**
> **2. We frequently drop commits if upstream fixes the issue or ships equivalent functionality.**

---

## 2. Guidelines for Agents & Contributors

When implementing changes or fixing issues in this repository:

### A. Keep Changes Minor and Easily Rebased
- **Minimize the footprint in upstream files**: When adding a feature, place new logic in dedicated files/modules whenever possible (e.g. `packages/client/src/components/combat/`, `deploy/gcp/`). Hook into upstream files with minimal, clean insertion points.
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

| Remote | URL | Role |
| :--- | :--- | :--- |
| **`upstream`** | `https://github.com/Pasta-Devs/Marinara-Engine.git` | Canonical upstream source of truth. |
| **`origin`** | `https://github.com/bahaynes/Marinara-Engine.git` | Personal fork repository. |

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

## 5. Illustrator 2 (custom image agent)

Illustrator 2 is an agent package for local multi-reference edit models (FLUX.2 [klein], Qwen-Image-Edit) on ComfyUI. Its definition lives in the agents fork (`bahaynes/Marinara-Agents`, branch `custom-mods`, `fork/packages/illustrator-2`) with all our other custom agents; see that repo's `CUSTOM_MODS.md`. It reuses the stock `image_prompt` pipeline (gallery, swipes, camera button, retry) and relies on the engine hooks in `packages/server/src/services/image/image-agent-comfy-extensions.ts`, which stay here.

**Install**
1. Point the instance at the fork catalog (`MARINARA_AGENT_CATALOG_URL`, see the agents fork's `CUSTOM_MODS.md`) and install **Illustrator 2** from Agents.
2. Set its image connection, then add it to a chat. It needs a text model for the prompt writer; a cheap one is fine.
3. Enable **Character Tracker** in the same chat for present-character gating (optional — without tracker data nothing is filtered).

Give Illustrator 2 chats one short image **style profile** (5-8 tags). The template writes no style words, so the profile is the only source of style and it appears once. Also keep the image connection's `imagePromptInstructions` short and consistent with the template (e.g. "One frozen moment, 30-70 words, at most two people, placed left/right."); instructions like "fully describing the desired outcome" push the prompt writer back to long, crowded prompts. The editor keeps the agent's `presentCharactersOnly` / `referenceOrder` options on save even though it has no fields for them.

The package agent's type is `illustrator-2`, so per-chat `customAgentImageSettings` overrides are keyed by that. The older folder import used `custom-import-illustrator-2-<uuid>`; chats bound to that type must be re-pointed when switching.

**Agent settings it uses (all opt-in, inert for the stock Illustrator)**
- `presentCharactersOnly`: trims character cards to the tracker's `presentCharacters` (plus anyone named in the reply) and drops absent names from references using this turn's tracker snapshot. The agent also gets its own batch so the trim never reaches other agents.
- `referenceOrder: "requested"`: references follow the agent's `characters` order, and only the image prompt (not the whole reply) is scanned for extra names.

**Prompt tokens.** The agent writes `[[Name]]`; after references are resolved it becomes `image N` in actual slot order (Maps location first, avatar-less characters skipped, duplicates collapsed, 4 slots on ComfyUI, 6 elsewhere). `[[location]]` maps to the location slot. Names without a slot stay plain names. Plain mentions of a slotted character (full name or any name word of 3+ letters, possessives included, e.g. "Hera's" for `Hera-Zaire`) are rewritten to `image N` too, because the prompt writer does not always keep to tokens; a name word shared by two slotted characters stays as written. The stock Illustrator keeps plain names.

**Workflow placeholders (local ComfyUI only; not RunPod or SwarmUI)**
- `%reference_count%` (number) and `%reference_enabled_01%`..`%reference_enabled_04%` (JSON booleans, true only for real references). For the DaSiWa reference stack set `"enabled": "%reference_enabled_02%"` etc. on each `DaSiWa_OptionalLoadImage`, keeping `%reference_image_name_0N%` (with the placeholder-upload option on) as the image.
- Agent-chosen variables: add a top-level `marinara_variables` object to the workflow JSON. Marinara strips it before queueing, shows it to image agents, validates their `comfyVariables` answer and always fills a value (the default when absent or invalid). Read the values as `%var_<name>%`:

```json
{
  "marinara_variables": {
    "shot": { "type": "enum", "values": ["close-up", "medium shot", "wide shot"], "default": "medium shot", "description": "camera framing" },
    "detail_lora": { "type": "number", "min": 0, "max": 1, "default": 0.6, "description": "strength of the detail LoRA" }
  },
  "151": { "class_type": "PrimitiveStringMultiline", "inputs": { "value": "%prompt% %var_shot%. <lora:detail:%var_detail_lora%>" } }
}
```

Types: `string` (≤200 chars), `number` (clamped to `min`/`max`), `boolean`, `enum` (`values` required). Names are `[a-z0-9_]`, up to 16 variables.

**Why the template is this strict.** Measured on 86 stock-Illustrator prompts sent to FLUX.2 klein (2026-09-24..10-02, Gemma4 prompt writer): median 181 words; style text repeated in 75 (the engine asks for style in both the `style` field and the prompt, then prepends `style`); 3+ body traits in 71 despite avatar references; 3+ placed subjects in 42; mood/scent lines in 39; motion verbs (flickering, trembling) in 32; unnamed extras in 19; sequence words in 19. Each clause is drawn at the same instant, which shows up as fused objects and extra hands. Re-measure with `python3 scripts/fork/illustrator-prompt-metrics.py --since <iso> --model klein` (read-only, uses `mari` in the container).

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

- **Agent Skill**: [`.agents/skills/custom-mods/SKILL.md`](.agents/skills/custom-mods/SKILL.md)
- **Repo Agent Rules**: [`AGENTS.md`](AGENTS.md)
- **Upstream Contribution Guide**: [`CONTRIBUTING.md`](CONTRIBUTING.md) (for upstream PR conventions when contributing back to `Pasta-Devs/Marinara-Engine`)
