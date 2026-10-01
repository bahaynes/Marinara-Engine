# Custom-Mods Fork Documentation

This repository is a local fork of [**Pasta-Devs/Marinara-Engine**](https://github.com/Pasta-Devs/Marinara-Engine), maintained on the **`custom-mods`** branch for our personal use at [**bahaynes/Marinara-Engine**](https://github.com/bahaynes/Marinara-Engine).

---

## 1. Fork Purpose & Philosophy

This fork exists to host custom mods and operational enhancements that tailor Marinara Engine to our specific workflows and hardware. Examples include:
- **Tabletop Combat & Mini-games**: D&D 5.5e combat engine, tactical battlemaps, ATLS trauma triage mini-game.
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

`custom-agents/illustrator-2/` is a custom agent for local multi-reference edit models (FLUX.2 [klein], Qwen-Image-Edit) on ComfyUI. It reuses the stock `image_prompt` pipeline (gallery, swipes, camera button, retry) and relies on the engine hooks in `packages/server/src/services/image/image-agent-comfy-extensions.ts`.

**Install**
1. Settings → Advanced → Danger Zone → **Allow custom Agent imports**.
2. Agents → **Import agent folder** → pick `custom-agents/illustrator-2`. Review the permission request (Image generation).
3. Open the imported agent and set its image connection (connection IDs are stripped on import), then add it to a chat. It needs a text model for the prompt writer; a cheap one is fine.
4. Enable **Character Tracker** in the same chat for present-character gating (optional — without tracker data nothing is filtered).

Leave the chat's image **style profile** unset for chats using Illustrator 2: a profile adds style text after the prompt, which works against the short single-style prompt. The editor keeps the agent's `presentCharactersOnly` / `referenceOrder` options on save even though it has no fields for them.

Import gives the agent a `custom-import-illustrator-2-<uuid>` type, so per-chat `customAgentImageSettings` overrides are keyed by that type, not `illustrator-2`.

**Agent settings it uses (all opt-in, inert for the stock Illustrator)**
- `presentCharactersOnly`: trims character cards to the tracker's `presentCharacters` (plus anyone named in the reply) and drops absent names from references using this turn's tracker snapshot. The agent also gets its own batch so the trim never reaches other agents.
- `referenceOrder: "requested"`: references follow the agent's `characters` order, and only the image prompt (not the whole reply) is scanned for extra names.

**Prompt tokens.** The agent writes `[[Name]]`; after references are resolved it becomes `image N` in actual slot order (Maps location first, avatar-less characters skipped, duplicates collapsed, 4 slots on ComfyUI, 6 elsewhere). `[[location]]` maps to the location slot. Names without a slot stay plain names.

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

**If images stay blurry**, test the workflow before blaming the prompt: queue a fixed prompt in ComfyUI with the full FLUX.2 VAE decoder instead of `full_encoder_small_decoder`, and compare Q5 GGUF vs fp8 and `target_megapixels` 0.66 vs 1.0.

---

## 6. Related Resources

- **Agent Skill**: [`.agents/skills/custom-mods/SKILL.md`](.agents/skills/custom-mods/SKILL.md)
- **Repo Agent Rules**: [`AGENTS.md`](AGENTS.md)
- **Upstream Contribution Guide**: [`CONTRIBUTING.md`](CONTRIBUTING.md) (for upstream PR conventions when contributing back to `Pasta-Devs/Marinara-Engine`)
