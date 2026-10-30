---
name: Manage Marinara
model: sonnet
description: Inspect, troubleshoot, mutate database records, and rebuild Marinara Engine instances (primary `marinara` and secondary `marinara-wife`). Explains the dual-container profile architecture, storage concurrency rules, `mari` CLI commands, and rebuild lifecycles. For UI/browser checks (screenshots, console errors) use the `drive-marinara-ui` skill.
---

# Manage Marinara Instances (`marinara` & `marinara-wife`)

Load this skill whenever diagnosing, troubleshooting, querying/mutating app data, or modifying and redeploying the Marinara Engine stack.

---

## 1. Multi-Container "Profiles": Primary vs. Wife

The deployment runs two separate instances of Marinara Engine from the same Docker Compose stack (`/home/bah/git/minecraftdocker/marinara/compose.yaml`). Both share the same LLM backend (`llama-server` / `llama-backend`) and base Docker image (`marinara-engine:local`), but have isolated storage, settings, and credentials:

| Attribute | Primary Profile (`marinara`) | Secondary Profile (`marinara-wife`) |
| :--- | :--- | :--- |
| **Default Target** | **YES (default for almost all tasks)** | Only when explicitly requested |
| **Container Name** | `marinara` | `marinara-wife` |
| **User / Role** | Ben (`bah`) | Erin (`wife`) |
| **Domain URL** | `https://story.bahaynes.com` | `https://marinara.bahaynes.com` |
| **Host Data Path** | `/mnt/faststorage/marinara/data` | `/mnt/faststorage/marinara-wife/data` |
| **Host Storage DB** | `/mnt/faststorage/marinara/data/storage` | `/mnt/faststorage/marinara-wife/data/storage` |
| **Admin Secret Env** | `MARINARA_ADMIN_SECRET` | `MARINARA_WIFE_ADMIN_SECRET` |
| **Claude Credentials** | `/home/bah/.claude` | `/home/bah/.claude-wife` |
| **Extra Services** | `pocket-tts` (TTS audio) | `lyrics-relay` (song mood agent) |

> [!IMPORTANT]
> **Target Rule**: Unless the user explicitly refers to "wife", "Erin", `marinara-wife`, or `marinara.bahaynes.com`, **always default to targeting `marinara`**.

---

## 2. Storage Architecture & Concurrency Rules

Marinara uses a custom file-backed database engine ([`packages/server/src/db/file-backed-store.ts`](file:///home/bah/git/marinara-engine/packages/server/src/db/file-backed-store.ts)):
- **In-Memory Caching**: Active tables are cached in memory in the Node.js server process.
- **On-Disk Snapshots**: Persisted as JSON files under `/app/data/storage/tables/<table_name>/`.
- **Transactions & Recovery**: Journaled under `/app/data/storage/journal/`, tracked via `manifest.json`.
- **Concurrency Guard**: A `.writer-lease` file prevents multiple processes from mutating storage simultaneously.

### The Concurrency Golden Rule
> [!CAUTION]
> **NEVER directly edit `/mnt/faststorage/<instance>/data/storage/tables/*.json` on the host while the container is running.**
> Direct file modifications bypass the in-memory cache and writer lease. The running engine will overwrite your edits, desynchronize state, or corrupt `manifest.json`.
>
> - **Live / Hot System**: Always use the container's built-in `mari` CLI: `docker exec -i <container> mari ...`.
> - **Stopped / Cold System**: Direct file access is strictly for emergency recovery when the container is stopped.

---

## 3. Live Operations via the `mari` CLI

The container environment includes `mari` ([`packages/server/src/bin/mari.ts`](file:///home/bah/git/marinara-engine/packages/server/src/bin/mari.ts)) in its `$PATH`. It safely communicates with the live engine via internal privileged APIs, ensuring atomic writes, dry-run previews, and journaled rollbacks.

### Target Container Variable
Set the target container in your shell (defaulting to `marinara`):
```bash
TARGET="marinara"        # or TARGET="marinara-wife"
```

### A. Health, Integrity & Diagnostics
```bash
# Full database integrity & dangling foreign key audit:
docker exec -i "$TARGET" mari code health

# Storage status (data dir, table count):
docker exec -i "$TARGET" mari db status

# Validate database schema compliance (optionally for a specific table):
docker exec -i "$TARGET" mari db validate
docker exec -i "$TARGET" mari db validate --table characters
```

### B. Querying Data
```bash
# List all tables:
docker exec -i "$TARGET" mari db tables

# List rows in a table (e.g. app_settings, characters, lorebooks, chats):
docker exec -i "$TARGET" mari db list app_settings --limit 20

# Query with safe expressions (SQL-like WHERE):
# Expression supports row.<field>, string methods (.includes, .startsWith), and logical operators
docker exec -i "$TARGET" mari db select characters --where "row.name.includes('Mari')"
docker exec -i "$TARGET" mari db select app_settings --where "row.id.startsWith('seed:')"

# Get a single record:
docker exec -i "$TARGET" mari db get characters <character-id>
```

### C. Domain Entity Subcommands
Marinara provides specialized high-level handlers that validate domain-specific schemas:
```bash
# Characters
docker exec -i "$TARGET" mari characters list
docker exec -i "$TARGET" mari characters get <id>

# Personas
docker exec -i "$TARGET" mari personas list

# Lorebooks
docker exec -i "$TARGET" mari lorebooks list
docker exec -i "$TARGET" mari lorebooks entries <lorebook-id>
docker exec -i "$TARGET" mari lorebooks get-entry <entry-id>

# Presets
docker exec -i "$TARGET" mari presets list
docker exec -i "$TARGET" mari presets sections <preset-id>

# Chats (Read-only)
docker exec -i "$TARGET" mari chats list --limit 10
docker exec -i "$TARGET" mari chats messages <chat-id> --last 20
```

### D. Safe Data Mutations (Dry-Run by Default)
All mutations dry-run by default to show what would change. To commit, pass `--apply --reason "<text>"`:

```bash
# 1. Preview changes (Dry-Run):
docker exec -i "$TARGET" mari db patch app_settings <id> --json '{"value": true}'

# 2. Review the preview diff output in the response.

# 3. Apply and persist if satisfied:
docker exec -i "$TARGET" mari db patch app_settings <id> --json '{"value": true}' --apply --reason "Enabling setting"

# Delete a record (dry-run first, then apply):
docker exec -i "$TARGET" mari db delete <table-name> <id> --apply --reason "Removing obsolete record"
```

---

## 4. Modifying Engine Code & Deployment Lifecycle

When fixing bugs or adding features in `~/git/marinara-engine`:

### Repositories & Working Directory
- **App Code**: `/home/bah/git/marinara-engine` (on branch `custom-mods`).
- **Compose & Deployment**: `/home/bah/git/minecraftdocker/marinara`.

### Step 1: Validate Code on the Host
Always run TypeScript compilation and lint checks before building containers:
```bash
cd /home/bah/git/marinara-engine
pnpm check
```

### Step 2: Deploy to Ben's instance (`marinara`)
Use the `marinara_deploy` MCP tool, or the same script directly:
```bash
cd /home/bah/git/marinara-engine
python3 scripts/marinara-deploy.py idle            # {"idle": true|false, "reason": ...}
python3 scripts/marinara-deploy.py deploy          # custom-mods; or pass a commit/branch
```
It refuses commits whose tree never passed the pre-push checks (push first), storage-format changes
(back up, then deploy by hand), and a second concurrent deploy. It builds `marinara-engine:nightly` from a
clean worktree, waits up to `--wait-minutes` (default 30, retry every `--retry-seconds` 60) for both
instances and `llama-backend` to be idle, tags the running image `:nightly-prev`, recreates `marinara`, and
rolls back if `/api/health` doesn't report the commit. Never `docker build` from the main working tree:
other sessions' uncommitted edits ship under the wrong commit.

### Step 3: Erin's instance (`marinara-wife`), only when she wants the change
Build `:local` by hand from a clean worktree of the commit, check `marinara-deploy.py idle` in the same
command, then recreate only `marinara-wife`:
```bash
cd /home/bah/git/marinara-engine && git worktree add --detach /tmp/mw-build <commit>
docker build --build-arg BUILD_BRANCH=staging --build-arg BUILD_COMMIT=$(git -C /tmp/mw-build rev-parse --short HEAD) -t marinara-engine:local /tmp/mw-build
python3 scripts/marinara-deploy.py idle | grep -q '"idle": true' && (cd /home/bah/git/minecraftdocker/marinara && docker compose up -d --build --force-recreate marinara-wife)
git worktree remove /tmp/mw-build
```

### Nightly deploys (primary only)
bah-nixos's `marinara-rebase` systemd timer (01:00) rebases `custom-mods` onto `upstream/staging` in `~/.cache/marinara-rebase/repo`, runs `pnpm check` and `pnpm regression`, and when they pass builds `marinara-engine:nightly` and recreates `marinara` once both instances are idle (until 03:30), rolling back to `marinara-engine:nightly-prev` if `/api/health` doesn't report the new commit. It skips the deploy when `storage-format.json` changed. The report is `~/.claude/handoffs/marinara-nightly-rebase.md`; `/api/health`'s `commit` is a `nightly/rebased` commit, not a `custom-mods` one. A manual deploy to `marinara` replaces the nightly until the next night.

---

## 5. Inspecting Container Logs

Always check logs via Loki (`monitoring/query-logs.py`) rather than raw `docker logs`, because Loki retains logs across container restarts:

```bash
cd /home/bah/git/minecraftdocker

# Check latest logs for the target:
python3 monitoring/query-logs.py -c marinara -n 50
python3 monitoring/query-logs.py -c marinara-wife -n 50

# Filter by error:
python3 monitoring/query-logs.py -c marinara -s "error" -n 25

# Check proxy requests (llama-server) if diagnosing LLM generation:
python3 monitoring/query-logs.py -c llama-server -s "TRACKER_DETECTED" -n 20
```

---

## 6. Cold / Disaster Recovery (Container Down or In Boot-Loop)

If an instance cannot start (e.g. storage format error, locked lease, or corrupt manifest):

1. **Stop the Container**:
   ```bash
   cd /home/bah/git/minecraftdocker/marinara
   docker compose stop "$TARGET"
   ```

2. **Inspect Host Storage**:
   Storage directory: `/mnt/faststorage/$TARGET/data/storage`

3. **Check Writer Lease**:
   If the container was hard-killed (SIGKILL / power outage), an orphaned lease may block startup:
   ```bash
   ls -la /mnt/faststorage/$TARGET/data/storage/.writer-lease
   # Inspect contents:
   cat /mnt/faststorage/$TARGET/data/storage/.writer-lease
   # Remove stale lease only if container is confirmed completely stopped:
   rm -f /mnt/faststorage/$TARGET/data/storage/.writer-lease
   ```

4. **Verify Manifest**:
   ```bash
   cat /mnt/faststorage/$TARGET/data/storage/manifest.json
   # If corrupt or invalid JSON, compare with backup:
   diff -u /mnt/faststorage/$TARGET/data/storage/manifest.json /mnt/faststorage/$TARGET/data/storage/manifest.json.bak
   ```

5. **Restart & Validate**:
   ```bash
   docker compose up -d "$TARGET"
   docker exec -i "$TARGET" mari code health
   ```
