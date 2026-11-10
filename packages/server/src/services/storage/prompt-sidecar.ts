// ──────────────────────────────────────────────
// custom-mods: Peek Prompt copies stored beside the chat, not in it
// ──────────────────────────────────────────────
// Every generation saves the exact prompt it sent (`extra.cachedPrompt`) for Peek Prompt. Kept on the message row,
// that copy loads into memory with the chat: in a long roleplay it was over half of a 250 MB shard, and the sweep
// that strips older copies only looks at assistant rows, so impersonated turns kept theirs forever.
//
// Here the prompt goes to its own file, one per message swipe, and the row keeps only a small reference
// (`extra.cachedPromptStored`). Peek Prompt reads the file when it is asked for; nothing else loads it. Files of a
// deleted chat are removed with the chat. Rows written before this change still carry an inline `cachedPrompt` and
// are read as before until the background migration moves them.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../../utils/data-dir.js";
import { logger } from "../../lib/logger.js";

export const PROMPT_SIDECAR_DIR = join(DATA_DIR, "prompt-cache");

/** What a message row keeps in `extra.cachedPromptStored`. */
export interface PromptSidecarRef {
  chatId: string;
  messageId: string;
  swipeIndex: number;
}

export type StoredPromptEntry = { role: string; content: string } & Record<string, unknown>;

/** Ids are opaque strings from the store; keep only file-name-safe characters, and make the mapping injective. */
function safeName(id: string): string {
  return encodeURIComponent(id).replace(/\./g, "%2E").replace(/%/g, "_");
}

function chatDir(chatId: string): string {
  return join(PROMPT_SIDECAR_DIR, safeName(chatId));
}

function sidecarPath(ref: PromptSidecarRef): string {
  return join(chatDir(ref.chatId), `${safeName(ref.messageId)}.${Math.trunc(ref.swipeIndex)}.json`);
}

export function parsePromptSidecarRef(value: unknown): PromptSidecarRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value as Record<string, unknown>;
  if (typeof ref.chatId !== "string" || !ref.chatId) return null;
  if (typeof ref.messageId !== "string" || !ref.messageId) return null;
  if (typeof ref.swipeIndex !== "number" || !Number.isFinite(ref.swipeIndex) || ref.swipeIndex < 0) return null;
  return { chatId: ref.chatId, messageId: ref.messageId, swipeIndex: Math.trunc(ref.swipeIndex) };
}

/** True when an extra holds a Peek Prompt copy, inline or stored in a file. */
export function extraHasCachedPrompt(extra: Record<string, unknown>): boolean {
  if (Array.isArray(extra.cachedPrompt) && extra.cachedPrompt.length > 0) return true;
  return parsePromptSidecarRef(extra.cachedPromptStored) !== null;
}

/** Writes the prompt atomically (temp file, then rename) and returns the reference for the row. */
export async function writePromptSidecar(
  ref: PromptSidecarRef,
  prompt: StoredPromptEntry[],
): Promise<PromptSidecarRef> {
  const path = sidecarPath(ref);
  await mkdir(chatDir(ref.chatId), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(prompt), "utf8");
  await rename(tmp, path);
  return { chatId: ref.chatId, messageId: ref.messageId, swipeIndex: Math.trunc(ref.swipeIndex) };
}

/** The stored prompt, or null when there is none (never written, or its chat was deleted). */
export async function readPromptSidecar(value: unknown): Promise<StoredPromptEntry[] | null> {
  const ref = parsePromptSidecarRef(value);
  if (!ref) return null;
  try {
    const parsed = JSON.parse(await readFile(sidecarPath(ref), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as StoredPromptEntry[]) : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      logger.warn(error, "[prompt-sidecar] Could not read the stored prompt for message %s", ref.messageId);
    }
    return null;
  }
}

/** Removes every stored prompt of a deleted chat. */
export async function removeChatPromptSidecars(chatId: string): Promise<void> {
  try {
    await rm(chatDir(chatId), { recursive: true, force: true });
  } catch (error) {
    logger.warn(error, "[prompt-sidecar] Could not remove the stored prompts of deleted chat %s", chatId);
  }
}
