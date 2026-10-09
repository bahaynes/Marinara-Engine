#!/usr/bin/env bash
# Run Playwright in the official container: host chromium can't start on NixOS, and the
# container can reach the live instances by DNS on caddy_network (inside IP_ALLOWLIST).
# Usage: scripts/pw-container.sh shot [url] [name.png] | console [url] | run <script.mjs> | smoke [pw args]
# Live-app runs must stay read-only; see .claude/skills/drive-marinara-ui/SKILL.md.
set -euo pipefail
cd "$(dirname "$0")/.."
ver=$(node -p 'require("./node_modules/@playwright/test/package.json").version')
out=.tmp/pw-out
mkdir -p "$out"
cmd=${1:?usage: pw-container.sh shot|console|run|smoke}; shift
base=${BASE_URL:-https://marinara:7860}
mode=ro; [ "$cmd" = smoke ] && mode=rw # the e2e suite builds and writes into the tree
args=(--rm --ipc=host --user "$(id -u):$(id -g)" -e HOME=/tmp -e BASE_URL="$base"
  -v "$PWD:/work:$mode" -v "$PWD/$out:/work/$out" -w /work)
[ "$cmd" = smoke ] || args+=(--network caddy_network)
run() { docker run "${args[@]}" "mcr.microsoft.com/playwright:v$ver-noble" "$@"; }
case $cmd in
  shot)
    name=${2:-shot.png}
    cp "$(dirname "$0")/pw-shot.mjs" "$out/pw-shot.mjs"
    run node "$out/pw-shot.mjs" "${1:-$base}" "$out/$name" ;;
  console)
    cp "$(dirname "$0")/pw-shot.mjs" "$out/pw-shot.mjs"
    run node "$out/pw-shot.mjs" "${1:-$base}" ;;
  run) cp "$1" "$out/"; run node "$out/$(basename "$1")" ;;
  smoke) # the image has no pnpm; shim it via corepack so the suite's server launcher finds it
    run bash -c 'mkdir -p /tmp/bin && corepack enable --install-directory /tmp/bin && PATH=/tmp/bin:$PATH exec pnpm exec playwright test -c playwright.config.ts --project=desktop-chromium --grep @smoke --workers=1 "$@"' _ "$@" ;;
  *) echo "unknown command: $cmd" >&2; exit 2 ;;
esac
