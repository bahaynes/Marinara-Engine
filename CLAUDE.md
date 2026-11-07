# CLAUDE.md

Fork-only file. `AGENTS.md` is upstream's agent guide, kept byte-identical to upstream so it never conflicts on a rebase. It is not imported here because most of it is upstream PR and Codex workflow; these rules are what apply to `custom-mods` work and they win over it.

## Fork engineering rules

- Impersonate turns are the recurring edge case (the last message may be a user message written as the character). Check every change that touches cache, state commits, trackers, or message history against an impersonate turn.
- Prefer Engine-owned logic (code-enforced gating, state, ordering) over prompt text that asks the model nicely. Propose a prompt-only fix only when code isn't viable, and say so.
- Prompt prefix order decides caching: stable content first, volatile content last.

## Custom-Mods Fork Guidelines (Local Fork & Rebase Discipline)

- **Fork Context**: This repository is the `custom-mods` fork (`bahaynes/Marinara-Engine`), maintained locally for our own use on top of upstream (`Pasta-Devs/Marinara-Engine`). See `CUSTOM_MODS.md` and the `custom-mods` skill (`.claude/skills/custom-mods/SKILL.md`) for full guidance.
- **Minor & Easily Rebased**: All changes must be minor, clean, and easily rebased onto `upstream/staging`. Keep diffs minimal, avoid unnecessary file churn or broad formatting/refactors across upstream code, and prefer modular additive files.
- **Drop Commits Fixed Upstream**: Commits on this fork are intentionally ephemeral. When upstream resolves a bug or implements equivalent functionality, we drop our local commit during rebase rather than carrying divergent code.
- **Separate Bug Fixes from Custom Features**: Never bundle temporary upstream bug fixes with custom mod features. Keep them in separate atomic commits so bug fixes can be cleanly dropped when upstream releases a fix.
- **Protect Working Tree**: Do not discard unstaged or uncommitted working-tree edits (such as diagnostic logging or user WIP); keep edits strictly non-destructive.

## custom-mods Branch Workflow

This fork's own trunk is `custom-mods`, separate from the upstream `staging`/`main`
workflow in `AGENTS.md`. Commit and push straight to `custom-mods`; PRs are optional (use
one only when a change wants a review record). The gate is `.githooks/pre-push`,
which runs `pnpm check` plus the full regression suite (`pnpm regression`) on
every push, PR or not.

- The pre-commit hook stays fast (staged-file-scoped lint/format only,
  `scripts/pre-commit-check.mjs`).
- Push once per coherent change, so a pre-push failure points at that change's
  own commits rather than a pile of unrelated ones. Topic branches or worktrees
  are fine for isolating work; merge them locally and push `custom-mods`.
- Do not add `CHANGELOG.md` entries for `custom-mods` work. This overrides the
  changelog rule in `AGENTS.md`, `CONTRIBUTING.md`, and
  `.github/agents/chai-workflow.md`: fork-local entries conflict on every rebase
  onto upstream and are never released from here. Describe the change in the
  commit message instead.
- The fork is opinionated, and its changes stay here. Upstream's coordination
  rules (draft PRs, tagging owners, self-assignment, filing issues) don't apply
  to `custom-mods` work. Never propose upstream issues or PRs, and never post to
  GitHub without the maintainer approving a draft first. The maintainer decides
  what goes upstream.

## Live Instances (homeserver)

Two instances run from `/home/bah/git/minecraftdocker/marinara`: `marinara` (Ben) and
`marinara-wife` (Erin). The `manage-marinara` skill (`.claude/skills/manage-marinara/SKILL.md`)
has the commands; these rules hold for every agent:

- **Erin's instance is hands-off.** No data, settings, agent, or rebuild changes to
  `marinara-wife` unless Ben says Erin wants that change. Never recreate both instances in
  one command. Her `marinara-engine:local` image is built by hand, from a clean worktree, only then.
- **Use the `marinara` MCP tools** (`scripts/mari-mcp.mjs`) or `mari` for data. Dry-run first. Never
  edit storage JSON on the host while a container runs. The MCP refuses writes to `marinara-wife`.
- **Restart and deploy only through the tools.** A recreate kills in-flight turns, and game turns can't
  be re-swiped. Check `marinara_idle` (or `python3 scripts/marinara-deploy.py idle`) before anything that
  restarts a container, agent installs included. Deploy with `marinara_deploy` (or
  `scripts/marinara-deploy.py deploy [REF]`). It deploys only commits that passed the pre-push checks,
  builds them from a clean worktree, waits for idle, keeps a rollback image and checks `/api/health`.
  Never run `docker compose up` or `docker build` against the instances yourself.
- **Logs**: Loki (`127.0.0.1:3100`) first; `docker logs` only when Loki has nothing.

## Ponytail Implementation Discipline

- Prefer simple code solutions, do not over-engineer things, and reuse code whenever possible.
- Apply [Ponytail](https://github.com/DietrichGebert/ponytail) as an additive minimalism overlay after understanding the task and tracing the affected flow. It never overrides repository rules, validation requirements, or the maintainer's latest request.
- Before adding code, stop at the first option that works: skip unnecessary work, reuse an existing helper or pattern, use the standard library, use a native platform capability, use an already-installed dependency, choose a clear inline solution, then write the minimum new code.
- Prefer shared root-cause fixes after checking every caller, deletion over addition, boring over clever, and the fewest files. Avoid speculative abstractions, dependencies, and boilerplate.
- Never trade away trust-boundary validation, data-loss prevention, security, accessibility, real-hardware calibration, or explicitly requested behavior.
- Non-trivial logic must leave behind the smallest runnable regression proof. Trivial one-line and instruction-only changes do not need a dedicated test.
- Mark a deliberate shortcut with a `ponytail:` comment that names its known ceiling and the upgrade path.

## Temporary Tests

- Do not keep `.test.ts` files in the repo. If an agent creates one for local proof, remove it after the test is done.

## Repo Boundaries

- Route changes to downloadable agents such as Illustrator, Music DJ, and Lorebook Keeper to [Pasta-Devs/Marinara-Agents](https://github.com/Pasta-Devs/Marinara-Agents). Agent definitions, default prompts, package-owned runtime code, metadata, artwork/assets, manifests, artifacts, and catalog entries must be fixed and submitted there against its `staging` branch, not in Marinara Engine.
- Keep host integration changes in Marinara Engine. Package loading, capability APIs and shared contracts, Engine UI/settings, storage, provider/model routing, orchestration, and compatibility handling remain Engine-owned even when the affected feature is an agent. Determine which side of this boundary owns a fix before opening an issue, branch, or PR; split cross-repository changes when both sides are affected.
- When writing or editing user guides under `docs/`, follow `.agents/skills/docs-writing/SKILL.md`.
- Server code logs through the shared Pino logger, never `console.*`. See `packages/server/CLAUDE.md`.
- Client UI copy uses semantic localization keys; read `packages/client/.instructions.md` before editing client code. See `packages/client/CLAUDE.md`.

## Read `AGENTS.md` on demand

Read the matching section of `AGENTS.md` first when doing any of these:

- Version numbers, release metadata or the storage format (Version Truth, Safe Multi-File Updates).
- Install, update or release behavior, a provider integration, or translated docs (Repo-Specific Cautions).
- Anything the maintainer sends to upstream (AI-Generated Pull Request, Expected Completion, `.github/agents/chai-workflow.md`).
