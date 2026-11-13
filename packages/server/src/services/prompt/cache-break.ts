// ──────────────────────────────────────────────
// custom-mods: name the change that broke the prompt cache
// ──────────────────────────────────────────────
// A prompt cache reuses an identical prefix, so a turn that rewrites its history lost it to one early change.
// The next turn normally differs from the last one only at its end: the last user message of the previous
// prompt (it carried that turn's tail sections) and what was appended after it. A change earlier than that
// is a break. This finds the first such change and, when it can, the lorebook entry it came from.

import { extraHasCachedPrompt, readPromptSidecar } from "../storage/prompt-sidecar.js";

export interface CacheBreakSource {
  label: string;
  text: string;
}

export interface CacheBreak {
  /** Message in the new prompt where the text first differs. */
  messageIndex: number;
  role: string;
  /** Distance from the last message of the new prompt (0 = last). */
  fromEnd: number;
  charOffset: number;
  before: string;
  after: string;
  /** Message the old text now sits in, when it moved rather than vanished. */
  movedFromEnd: number | null;
  /** The lorebook entry (or other source) whose text matches the change, when one does. */
  source: string | null;
  /** True when the gap since the previous reply outlasted the cache's lifetime, so the miss may be that alone. */
  expired: boolean | null;
}

type PromptMessage = { role: string; content: unknown };

const SNIPPET_CHARS = 160;
const MATCH_CHARS = 40;

const text = (message: PromptMessage): string =>
  typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");

const squash = (value: string): string => value.replace(/\s+/g, " ").trim();

export function findCacheBreak(
  previous: PromptMessage[],
  next: PromptMessage[],
  sources: CacheBreakSource[] = [],
): Omit<CacheBreak, "expired"> | null {
  // The previous prompt's last message legitimately changes: it held that turn's tail.
  const stable = previous.length - 1;
  let index = 0;
  let charOffset = 0;
  for (; index < Math.min(stable, next.length); index++) {
    const a = text(previous[index]!);
    const b = text(next[index]!);
    if (previous[index]!.role === next[index]!.role && a === b) continue;
    while (charOffset < a.length && charOffset < b.length && a[charOffset] === b[charOffset]) charOffset++;
    break;
  }
  if (index >= Math.min(stable, next.length) && next.length >= stable) return null;

  const old = index < previous.length ? text(previous[index]!) : "";
  const now = index < next.length ? text(next[index]!) : "";
  const before = squash(old.slice(charOffset, charOffset + SNIPPET_CHARS));
  const after = squash(now.slice(charOffset, charOffset + SNIPPET_CHARS));
  const probe = squash(old.slice(charOffset, charOffset + MATCH_CHARS * 2)).slice(0, MATCH_CHARS);
  let moved: number | null = null;
  if (probe.length >= MATCH_CHARS) {
    for (let j = index + 1; j < next.length; j++) {
      if (squash(text(next[j]!)).includes(probe)) {
        moved = next.length - 1 - j;
        break;
      }
    }
  }
  const needles = [before, after].map((s) => s.slice(0, MATCH_CHARS)).filter((s) => s.length >= MATCH_CHARS);
  const source =
    sources.find((candidate) => needles.some((needle) => squash(candidate.text).includes(needle)))?.label ?? null;
  return {
    messageIndex: index,
    role: next[index]?.role ?? previous[index]?.role ?? "unknown",
    fromEnd: next.length - 1 - index,
    charOffset,
    before,
    after,
    movedFromEnd: moved,
    source,
  };
}

type StoredMessage = { id: string; role: string; createdAt: string; extra?: unknown };

const parseExtra = (extra: unknown): Record<string, unknown> => {
  if (typeof extra !== "string") return (extra as Record<string, unknown> | null) ?? {};
  try {
    return JSON.parse(extra) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const scanSources = (scan: unknown): CacheBreakSource[] => {
  const entries = (scan as { activatedEntries?: Array<{ name?: unknown; content?: unknown }> } | null)
    ?.activatedEntries;
  return (entries ?? [])
    .filter((entry) => typeof entry.content === "string" && entry.content)
    .map((entry) => ({ label: String(entry.name ?? "unnamed entry"), text: entry.content as string }));
};

/**
 * What changed in `next` against the prompt the chat's previous assistant reply sent, or null when nothing
 * before the tail did (or there is no earlier prompt to compare). `ttlMs` is the provider cache's lifetime,
 * null when the provider has no known one.
 */
export async function cacheBreakForReply(o: {
  messages: StoredMessage[];
  savedMessageId: string;
  savedCreatedAt: string;
  next: PromptMessage[];
  scan: unknown;
  ttlMs: number | null;
  now?: number;
}): Promise<CacheBreak | null> {
  const previous = o.messages
    .filter((m) => m.role === "assistant" && m.id !== o.savedMessageId && m.createdAt < o.savedCreatedAt)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .find((m) => extraHasCachedPrompt(parseExtra(m.extra)));
  if (!previous) return null;
  const extra = parseExtra(previous.extra);
  const stored = Array.isArray(extra.cachedPrompt)
    ? (extra.cachedPrompt as PromptMessage[])
    : await readPromptSidecar(extra.cachedPromptStored);
  if (!stored?.length) return null;
  const found = findCacheBreak(stored, o.next, [...scanSources(o.scan), ...scanSources(extra.lorebookScan)]);
  if (!found) return null;
  const gap = (o.now ?? Date.now()) - Date.parse(previous.createdAt);
  return { ...found, expired: o.ttlMs != null && Number.isFinite(gap) ? gap > o.ttlMs : null };
}
