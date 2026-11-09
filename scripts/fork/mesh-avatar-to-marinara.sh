#!/usr/bin/env bash
# Export a Mesh Avatar Studio project and import it as a character's (or persona's) avatar in Marinara.
#
#   scripts/fork/mesh-avatar-to-marinara.sh <project> <ownerId> [character|persona] [container]
#
# Studio's export API answers localhost only, so it runs inside the mesh-avatar container; the import
# goes to the Marinara container's own port (BASE_URL, default https://localhost:7860). Default container:
# marinara (Ben's). Refuses marinara-wife unless ERIN_APPROVED=1: Erin's instance is hands-off unless Ben
# says she wants the change (hers serves http: BASE_URL=http://localhost:7860).
# ponytail: homeserver-only (container names, port 7860, self-signed TLS); upgrade path is a mari command.
set -euo pipefail

project=${1:?project name, e.g. nia}
owner_id=${2:?character or persona id}
owner_type=${3:-character}
container=${4:-marinara}
[[ $owner_type == character || $owner_type == persona ]] || { echo "owner type must be character or persona" >&2; exit 2; }
[[ $container != marinara-wife || ${ERIN_APPROVED:-} == 1 ]] || { echo "marinara-wife is hands-off; set ERIN_APPROVED=1 only when Ben says Erin asked" >&2; exit 2; }
base=${BASE_URL:-https://localhost:7860}

tmp=$(mktemp --suffix=.mavatar)
trap 'rm -f "$tmp"' EXIT

docker exec -e P="$project" mesh-avatar node -e '
  fetch("http://localhost:5173/__studio/export", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ project: process.env.P, includeSource: true }) })
  .then(async (r) => { if (!r.ok) throw new Error(r.status + " " + await r.text());
    process.stdout.write(Buffer.from(await r.arrayBuffer())); })
  .catch((e) => { console.error("export failed:", e.message); process.exit(1); });' > "$tmp"
echo "exported $project ($(stat -c %s "$tmp") bytes)"

docker exec -i -e NODE_TLS_REJECT_UNAUTHORIZED=0 -e NODE_NO_WARNINGS=1 -e P="$project" \
  -e URL="$base/api/avatar-models/$owner_type/$owner_id" "$container" node -e '
  (async () => {
    const chunks = []; for await (const c of process.stdin) chunks.push(c);
    const form = new FormData();
    form.append("kind", "mesh-avatar");
    form.append("file", new Blob([Buffer.concat(chunks)]), process.env.P + ".mavatar");
    const r = await fetch(process.env.URL + "/import", { method: "POST", body: form });
    const text = await r.text();
    if (!r.ok) { console.error("import failed:", r.status, text.slice(0, 400)); process.exit(1); }
    const { kind, config } = JSON.parse(text);
    console.log("imported", kind, "->", config.kinds[kind].file, "enabled:", config.enabled);
  })();' < "$tmp"
