---
name: drive-marinara-ui
description: See and drive the Marinara Engine UI with Playwright from a container - screenshots, browser console/network errors, page text, custom Playwright scripts, and the repo's `pnpm smoke:ui` suite. Use when a UI bug needs reproducing or a rebuilt instance needs a visual/console check. Host chromium cannot run on this NixOS box, so everything goes through `scripts/pw-container.sh`.
---

# Drive the Marinara UI (containerized Playwright)

Complements `manage-marinara` (data via `mari`, logs, rebuilds). Use this when the symptom is visible in the browser.

## Why a container
The host is NixOS: Playwright's downloaded chromium fails (`libglib-2.0.so.0` missing) and podman is not installed. `scripts/pw-container.sh` runs the official `mcr.microsoft.com/playwright:v<ver>-noble` image (version read from `node_modules/@playwright/test`) as a throwaway Docker container. For live runs it joins `caddy_network`, so it reaches `https://marinara:7860` by DNS inside `IP_ALLOWLIST` (no auth needed, private CA handled by `ignoreHTTPSErrors`). The first run for a new Playwright version pulls ~1.5 GB.

## Commands (run from the repo root)
| Command | Does |
| :--- | :--- |
| `scripts/pw-container.sh shot [url] [name.png]` | Navigate, print console errors/warnings, page errors, failed requests, HTTP >=400, title and the first 2000 chars of body text; save a full-page screenshot to `.tmp/pw-out/<name>` (default `shot.png`). Read the PNG with the Read tool. |
| `scripts/pw-container.sh console [url]` | Same without the screenshot. |
| `scripts/pw-container.sh run <script.mjs>` | Run your own script; the repo is mounted at `/work` and the script is copied to `.tmp/pw-out/`, so `import { chromium } from "@playwright/test"` works. `BASE_URL` is set; use `ignoreHTTPSErrors: true`. Write artifacts into the script's own directory. |
| `scripts/pw-container.sh smoke [playwright args]` | Repo `@smoke` e2e suite (~1.5 min, 7 tests). It boots its own throwaway server pair with an empty DB, so it never touches live data. Pass e.g. `e2e/core-flows.e2e.ts -g "title"` to narrow. |

`BASE_URL=https://marinara-wife:7860` targets the other instance - only if Ben explicitly asked, and see the Erin rule below.

## Safety: pick the mildest mode that answers the question
1. **Read-only live** (`shot`, `console`, or a `run` script that only navigates and reads). Never click send/generate/swipe/delete or save settings on the live instance: game turns cannot be re-swiped and chats are real data. Page text and screenshots contain real chat content - keep them under `.tmp/` (gitignored), never commit or paste them wholesale.
2. **Throwaway instance** for anything that writes or needs seeded state: `smoke` (or a specific `e2e/*.e2e.ts`). Seed with `seedUIState` from `e2e/ui-state-fixture.ts` and the mocking helpers in `e2e/`. To reproduce a bug, add a temporary `.e2e.ts` (delete afterwards; the repo keeps none) and run it through `smoke`.
3. `LOG_LEVEL=debug` (full prompts/responses) belongs on throwaway instances only.

Rules carried over from memory: check for in-flight generations before bouncing containers; nothing on `marinara-wife` unless Ben confirms Erin wants it; never put `MARINARA_ADMIN_SECRET` in scripts or output.

## Troubleshooting loop
1. `shot` the page (or reproduce in a throwaway `smoke` run) and read console/network lines.
2. Correlate server side at the same time: `docker logs --since 5m marinara` or Loki (`monitoring/query-logs.py`, see `manage-marinara`).
3. `docker exec -i marinara mari code health` and `mari db ...` for data-shaped suspicions.
4. Fix, `pnpm check`, rebuild per `manage-marinara`, re-run `shot` to confirm. The shot context is always fresh, so a stale PWA/service-worker bundle is not a false negative.

## Gotchas
- Live instance data paths and the container IP change on recreate; use the DNS name, not the IP.
- CSRF trusted origin is `https://story.bahaynes.com`; mutating requests through `marinara:7860` may be rejected. Expected - another reason writes belong on a throwaway instance.
- `smoke` mounts the repo read-write and runs as your uid; it writes `.tmp/playwright-data` and `test-results/` (both gitignored) and builds `packages/shared`. The image lacks pnpm, so the script shims it with corepack (downloads pnpm on each run).
- Failure traces/videos land in `test-results/`; `pnpm exec playwright show-trace` is unavailable in the container, so open the trace zip on playwright.dev/trace or read the screenshot.
