---
name: custom-mods
description: Use when planning or implementing changes, debugging, or performing git operations in this repository. Explains that this is a local custom-mods fork of upstream Marinara Engine, why all changes must be minor and easily rebased, and how to identify and drop commits when upstream resolves them.
---

# Custom-Mods Fork Maintenance & Rebase Discipline

This repository is a local fork of **Marinara Engine** ([`Pasta-Devs/Marinara-Engine`](https://github.com/Pasta-Devs/Marinara-Engine)) maintained on the **`custom-mods`** branch for our own use ([`bahaynes/Marinara-Engine`](https://github.com/bahaynes/Marinara-Engine)).

It carries local custom enhancements (such as tabletop combat, trauma triage mini-games, quota telemetry, Cloudflare Tunnel GCP deployment bundles, and custom reasoning controls) on top of upstream.

The foundational design rule for this fork is:
> **All changes must be minor, surgical, and easily rebased onto upstream.**
> **Commits are intentionally ephemeral: if a bug or feature is resolved upstream, our local commit is dropped.**

---

## 1. Core Principles

1. **Local Fork, Not an Upstream PR Branch**
   - The active working branch is `custom-mods`.
   - The remote `upstream` points to `https://github.com/pasta-devs/marinara-engine.git`.
   - The remote `origin` points to `https://github.com/bahaynes/Marinara-Engine.git`.
   - We do not make sprawling changes assuming upstream will accept them wholesale. We prioritize our own stable local usage while remaining close enough to upstream to rebase cleanly and frequently.

2. **Rebase-First Architecture**
   - Commits on `custom-mods` live directly on top of `upstream/staging` (or `upstream/main`).
   - We frequently rebase `custom-mods` onto `upstream/staging` to pull in the latest features, security patches, and fixes.
   - Any code change introduced must be designed so that future rebases will not suffer painful or unresolvable merge conflicts.

3. **Keep Changes Minor and Isolated (Minimize Merge Footprints)**
   - **Touch as few upstream files as possible.**
   - Prefer **additive** modules, separate files, helper functions, and clear extension points over inline modifications scattered across dozens of upstream files.
   - **Do NOT edit `CHANGELOG.md`.** Upstream updates the changelog on every PR and release; local changelog entries cause constant merge conflicts on every rebase. Local release notes live in commit messages and `CUSTOM_MODS.md`.
   - Do **NOT** perform sweeping formatting, style rewrites, or structural refactoring across upstream code.
   - Keep commits small, focused, and atomic. A single commit should implement one clear feature or fix (e.g. `feat(combat): ...`, `fix(quota): ...`).

4. **Commits Are Ephemeral: Drop When Fixed Upstream**
   - We frequently drop local commits during rebase when upstream provides their own fix or equivalent feature.
   - **Never tightly couple temporary bug fixes with permanent custom features.** Keep them in separate, isolated commits so the bug fix commit can be dropped with a single `git rebase -i` drop command without breaking our custom features.
   - When writing a workaround or bug fix for an upstream issue, clearly document the upstream context (e.g., upstream issue # or rationale) in the commit message and comments.

---

## 2. Decision Flow for New Work

Before writing any code or modifying any file:

```
                  ┌─────────────────────────────────────┐
                  │ Need a fix, tweak, or custom feature │
                  └──────────────────┬──────────────────┘
                                     │
                                     ▼
                  ┌─────────────────────────────────────┐
                  │   Check upstream repo / PRs / logs  │
                  │  Has upstream already fixed/built it│
                  └──────────────┬──────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
             [ YES ]                          [ NO ]
                 │                               │
                 ▼                               ▼
     ┌───────────────────────┐       ┌────────────────────────┐
     │ Pull/rebase upstream. │       │ Is it a temporary fix  │
     │ Drop local work if    │       │ or a permanent custom  │
     │ already superseded.   │       │ mod?                   │
     └───────────────────────┘       └───────────┬────────────┘
                                                 │
                             ┌───────────────────┴───────────────────┐
                             │                                       │
                      [ Temporary Fix ]                      [ Custom Feature ]
                             │                                       │
                             ▼                                       ▼
                 ┌───────────────────────┐               ┌───────────────────────┐
                 │ Write minimal patch.  │               │ Design modularly.     │
                 │ Mark clearly as hotfix│               │ Isolate from upstream │
                 │ so it is easy to drop │               │ code. Keep diff tiny. │
                 │ when fixed upstream.  │               │ Keep commit atomic.   │
                 └───────────────────────┘               └───────────────────────┘
```

---

## 3. Practical Git Commands & Runbook

### Checking Upstream Delta
To see how far `custom-mods` is ahead of upstream:
```bash
# Fetch latest upstream commits without modifying working tree
git fetch upstream

# Find the merge base between upstream/staging and custom-mods
MERGE_BASE=$(git merge-base upstream/staging HEAD)

# See the list of local commits unique to this fork
git log --oneline ${MERGE_BASE}..HEAD

# See what upstream has merged since our branch branched off
git log --oneline HEAD..upstream/staging
```

### Checking for Equivalent Upstream Commits
To see which local commits have already been applied or cherry-picked upstream:
```bash
git cherry -v upstream/staging
```
- Commits prefixed with `-` have already been applied upstream and should be dropped.
- Commits prefixed with `+` are still unique to `custom-mods`.

### Rebasing Onto Upstream
When rebasing onto upstream:
```bash
git fetch upstream
git rebase -i upstream/staging
```
During the interactive rebase:
1. Mark any commits that are now fixed upstream as `drop` (or delete their line).
2. For any merge conflicts, review upstream's new implementation. Favor upstream's structural changes and re-apply our custom delta surgically.
3. Once rebased, run validation:
   ```bash
   pnpm check
   ```

---

## 4. Preservation of Uncommitted Work

The local working directory may contain diagnostic logging, active experiments, or uncommitted edits (e.g. in `generate.routes.ts` or `GameSurface.tsx`).
- **Never run destructive git commands** like `git reset --hard` or `git checkout -- .` without explicit user permission.
- Always inspect `git status` and `git diff` before and after file edits.

---

## 5. Summary Reference

| Rule | What to Do | What to Avoid |
| :--- | :--- | :--- |
| **Scope** | Minor, self-contained, surgical edits. | Large-scale refactors, reorganizing upstream directories. |
| **File footprint** | Add new files for custom features; minimal hooks into upstream files. | Scattering custom logic across dozens of core upstream files. |
| **Commit separation** | 1 commit per discrete feature or fix. | Commits that combine custom features with upstream bugfixes or formatting. |
| **Upstream resolution** | Drop the local commit as soon as upstream merges a fix. | Carrying dead or divergent monkey-patches after upstream fixes them. |
| **Validation** | Run `pnpm check` to ensure clean TypeScript and builds. | Pushing broken builds or unverified rebase conflicts. |
