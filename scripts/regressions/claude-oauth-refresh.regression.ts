import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OAUTH_REFRESH_WINDOW_MS,
  ensureFreshOAuthCredentials,
} from "../../packages/server/src/services/llm/providers/claude-subscription/oauth-refresh.js";

const dir = mkdtempSync(join(tmpdir(), "claude-oauth-"));
const path = join(dir, ".credentials.json");
const env = { CLAUDE_CONFIG_DIR: dir } as NodeJS.ProcessEnv;
const now = 1_000_000_000;
const write = (expiresAt: number) =>
  writeFileSync(
    path,
    JSON.stringify({ other: "kept", claudeAiOauth: { accessToken: "a", refreshToken: "r", expiresAt, scopes: ["x"] } }),
    { mode: 0o600 },
  );
const read = () => JSON.parse(readFileSync(path, "utf-8"));

// Far from expiry: nothing happens.
write(now + OAUTH_REFRESH_WINDOW_MS + 60_000);
let calls = 0;
await ensureFreshOAuthCredentials(async () => void calls++, { env, now: () => now });
assert.equal(calls, 0);

// Near expiry: the stored token is marked expired before the direct request, so the CLI refreshes
// the real file; concurrent callers share one refresh.
write(now + 60_000);
let seenExpiresAt: number | null = null;
const refresh = async () => {
  calls++;
  seenExpiresAt = read().claudeAiOauth.expiresAt;
  const creds = read();
  creds.claudeAiOauth = {
    ...creds.claudeAiOauth,
    accessToken: "b",
    refreshToken: "r2",
    expiresAt: now + 8 * 3_600_000,
  };
  writeFileSync(path, JSON.stringify(creds));
};
await Promise.all([
  ensureFreshOAuthCredentials(refresh, { env, now: () => now }),
  ensureFreshOAuthCredentials(refresh, { env, now: () => now }),
]);
assert.equal(calls, 1, "one refresh for concurrent requests");
assert.ok(seenExpiresAt !== null && seenExpiresAt < now, "token marked expired before the direct request");
assert.equal(read().other, "kept");
assert.deepEqual(read().claudeAiOauth.scopes, ["x"]);

// The nudge keeps the file private.
write(now + 60_000);
await ensureFreshOAuthCredentials(async () => {}, { env, now: () => now });
assert.equal(statSync(path).mode & 0o777, 0o600);

// Env-provided credentials and failures are left alone.
calls = 0;
write(now + 60_000);
await ensureFreshOAuthCredentials(refresh, { env: { ...env, CLAUDE_CODE_OAUTH_TOKEN: "t" }, now: () => now });
assert.equal(calls, 0);
await ensureFreshOAuthCredentials(
  async () => {
    throw new Error("network");
  },
  { env, now: () => now },
);

console.log("Claude subscription OAuth refresh regression passed.");
