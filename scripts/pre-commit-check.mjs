#!/usr/bin/env node
// ──────────────────────────────────────────────
// Fast, staged-files-scoped validation for the pre-commit hook.
// ──────────────────────────────────────────────
// `pnpm check` is the authoritative check (full monorepo lint, a from-scratch
// production build, and a full localization audit) — reserved for `pnpm run
// hooks:pre-push` / CI, where a slow, fully-clean run is worth it. This script
// only runs the real per-package `lint` scripts for packages that actually
// have staged changes (they already do real tsc type-checking, just scoped
// per-package with their own caches), plus prettier on the staged files
// themselves. It never runs the full production build or the full-repo
// localization/format sweep — that's what pre-push/CI is for.
/* global console, process */
import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32", ...options });
  return result.status ?? 1;
}

function stagedFiles() {
  const result = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

const files = stagedFiles();
if (files.length === 0) {
  console.log("[pre-commit] No staged files — skipping.");
  process.exit(0);
}

const tsFiles = files.filter((f) => /\.(ts|tsx)$/.test(f));
const touches = (prefix) => files.some((f) => f.startsWith(prefix));

const touchesShared = touches("packages/shared/");
const touchesServer = touches("packages/server/");
const touchesClient = touches("packages/client/");
const touchesLocales = files.some((f) => f === "packages/client/src/localization/locales/en.json") || touchesClient;

let failed = false;

if (tsFiles.length > 0) {
  console.log(`[pre-commit] prettier --check on ${tsFiles.length} staged file(s)...`);
  if (run("npx", ["prettier", "--check", ...tsFiles]) !== 0) failed = true;
}

// Shared is a dependency of both server and client, so a stale shared build
// can mask real type errors in either — cheap enough (~2-4s) to always run
// when anything in the workspace changed.
if (touchesShared || touchesServer || touchesClient) {
  console.log("[pre-commit] packages/shared lint...");
  if (run("pnpm", ["--filter", "@marinara-engine/shared", "run", "lint"]) !== 0) failed = true;
}

if (!failed && touchesServer) {
  console.log("[pre-commit] packages/server lint...");
  if (run("pnpm", ["--filter", "@marinara-engine/server", "run", "lint"]) !== 0) failed = true;
}

if (!failed && touchesClient) {
  console.log("[pre-commit] packages/client lint...");
  if (run("pnpm", ["--filter", "@marinara-engine/client", "run", "lint"]) !== 0) failed = true;
}

if (!failed && touchesLocales) {
  console.log("[pre-commit] localization check...");
  if (run("pnpm", ["run", "localization:check"]) !== 0) failed = true;
}

if (failed) {
  console.error(
    "\n[pre-commit] FAILED. This is the fast, changed-files-only check — `pnpm check` (full, clean) still runs on push.",
  );
  process.exit(1);
}

console.log("[pre-commit] OK.");
process.exit(0);
