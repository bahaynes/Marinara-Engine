// ──────────────────────────────────────────────
// Keep the subscription login fresh in the real credentials file
// ──────────────────────────────────────────────
//
// The Agent SDK's sessionStore resume copies `.credentials.json` into a throwaway
// `claude-resume-*` config dir and runs the CLI there. When the access token has
// expired, the CLI refreshes inside that copy: the single-use refresh token is spent
// and the new pair is deleted with the dir, so every later request fails with
// "401 OAuth access token has expired" until someone logs in again. Refreshing
// against the real file first, shortly before expiry, means the copy never has to.

import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../../../../lib/logger.js";

/** Refresh when the access token has less than this left. */
export const OAUTH_REFRESH_WINDOW_MS = 10 * 60_000;

let inflight: Promise<void> | null = null;

interface StoredCredentials {
  claudeAiOauth: { refreshToken: string; expiresAt: number; [key: string]: unknown };
  [key: string]: unknown;
}

export function claudeCredentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"), ".credentials.json");
}

async function readCredentials(path: string): Promise<StoredCredentials | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<StoredCredentials> | null;
    const oauth = parsed?.claudeAiOauth;
    return oauth?.refreshToken && typeof oauth.expiresAt === "number" ? (parsed as StoredCredentials) : null;
  } catch {
    return null;
  }
}

/**
 * Before a resumed SDK request, refresh the login against the real credentials file when it is
 * about to expire. `refreshDirect` must run one CLI request against the real config dir (no
 * sessionStore); marking the stored token expired first makes that request refresh it.
 * Never throws: on any failure the request proceeds as before.
 * ponytail: one tiny direct request per token lifetime; drop once the SDK writes refreshed
 * credentials back from its resume dir.
 */
export async function ensureFreshOAuthCredentials(
  refreshDirect: () => Promise<void>,
  options: { env?: NodeJS.ProcessEnv; now?: () => number } = {},
): Promise<void> {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  // Env-provided credentials are not ours to refresh.
  if (env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) return;
  const path = claudeCredentialsPath(env);
  const creds = await readCredentials(path);
  if (!creds || creds.claudeAiOauth.expiresAt - now() > OAUTH_REFRESH_WINDOW_MS) return;

  inflight ??= (async () => {
    const minutesLeft = Math.round((creds.claudeAiOauth.expiresAt - now()) / 60_000);
    try {
      const { mode } = await stat(path);
      const tmp = `${path}.marinara-refresh`;
      await writeFile(
        tmp,
        JSON.stringify({ ...creds, claudeAiOauth: { ...creds.claudeAiOauth, expiresAt: now() - 1 } }),
        { mode: mode & 0o777 },
      );
      await rename(tmp, path);
      await refreshDirect();
      const after = await readCredentials(path);
      if (after && after.claudeAiOauth.expiresAt > now() + OAUTH_REFRESH_WINDOW_MS) {
        logger.info("[claude-subscription] Refreshed the OAuth login (%d min were left)", minutesLeft);
      } else {
        logger.warn("[claude-subscription] OAuth refresh did not extend the login (%d min were left)", minutesLeft);
      }
    } catch (err) {
      logger.warn(err, "[claude-subscription] OAuth refresh before a resumed request failed");
    }
  })().finally(() => {
    inflight = null;
  });
  await inflight;
}
