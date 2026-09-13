---
name: Manage Marinara
description: Inspect, troubleshoot, mutate database records, and rebuild Marinara Engine instances (primary `marinara` and secondary `marinara-wife`). Explains the dual-container profile architecture, storage concurrency rules, `mari` CLI commands, and rebuild lifecycles.
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

### Step 2: Build Base Docker Image
Rebuild the local base image that both containers inherit:
```bash
cd /home/bah/git/marinara-engine
docker build -t marinara-engine:local .
```

### Step 3: Recreate Container(s)
Switch to the docker compose directory and recreate the target container:
```bash
cd /home/bah/git/minecraftdocker/marinara

# Recreate primary instance:
docker compose up -d --build --force-recreate marinara

# OR recreate wife instance:
docker compose up -d --build --force-recreate marinara-wife

# OR recreate both if changing shared engine logic:
docker compose up -d --build --force-recreate marinara marinara-wife
```

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
