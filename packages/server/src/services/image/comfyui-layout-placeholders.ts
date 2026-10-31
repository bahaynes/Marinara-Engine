import type { SceneIllustrationCharacterPrompt } from "@marinara-engine/shared";
import {
  defaultCharacterPromptPosition,
  personaEntityId,
  readIllustratorImageAppearanceOverride,
} from "./character-prompts.js";

/**
 * Fork: ComfyUI layout workflows (Create Bounding Boxes -> MOSS-Image Layout Prompt) draw each
 * named character in its own box. A workflow opts in by holding `%layout_bboxes%` (the boxes'
 * JSON string) and usually `%layout_character_boxes%` (the 1-based box numbers to label as
 * characters, e.g. "1, 2").
 */
export const COMFYUI_LAYOUT_BBOXES_PLACEHOLDER = "%layout_bboxes%";
export const COMFYUI_LAYOUT_CHARACTER_BOXES_PLACEHOLDER = "%layout_character_boxes%";
export const COMFYUI_LAYOUT_MAX_CHARACTER_PROMPTS = 6;

// Share of the canvas width (and height) the boxes take together; the rest is an even margin.
const LAYOUT_FILL = 0.9;

export function comfyWorkflowTakesLayout(workflowText: string | null | undefined): boolean {
  return typeof workflowText === "string" && workflowText.includes(COMFYUI_LAYOUT_BBOXES_PLACEHOLDER);
}

function toGrid(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000);
}

/**
 * One full-height box per character, side by side in a single row of equal columns, ordered left
 * to right by the prompt writer's x position (its y is ignored: writers put everyone on the same
 * line, and short stacked boxes duplicated people in testing). Create Bounding Boxes reads each
 * element's `bbox` as [ymin, xmin, ymax, xmax] on a 0-1000 grid; an empty list leaves the MOSS
 * prompt as the plain scene prompt.
 */
export function buildComfyLayoutReplacements(
  characterPrompts: readonly SceneIllustrationCharacterPrompt[] | undefined,
): Record<string, string> {
  const entries = (characterPrompts ?? [])
    .slice(0, COMFYUI_LAYOUT_MAX_CHARACTER_PROMPTS)
    // Gallery regenerations may arrive without a position; they keep their order.
    .map((entry, index) => ({ entry, x: entry.position?.x ?? defaultCharacterPromptPosition(index, 1).x, index }))
    .sort((a, b) => a.x - b.x || a.index - b.index)
    .map(({ entry }) => entry);
  const margin = (1 - LAYOUT_FILL) / 2;
  const width = LAYOUT_FILL / Math.max(1, entries.length);
  const elements = entries.map((entry, index) => ({
    type: "obj",
    desc: entry.prompt,
    bbox: [
      toGrid(margin),
      toGrid(margin + index * width),
      toGrid(margin + LAYOUT_FILL),
      toGrid(margin + (index + 1) * width),
    ],
  }));
  return {
    [COMFYUI_LAYOUT_BBOXES_PLACEHOLDER]: JSON.stringify(elements),
    [COMFYUI_LAYOUT_CHARACTER_BOXES_PLACEHOLDER]: elements.map((_, index) => index + 1).join(", "),
  };
}

/**
 * Fork: chat setting for how many characters a layout image may box. The connection's own cap
 * (COMFYUI_LAYOUT_MAX_CHARACTER_PROMPTS) still applies; a missing or invalid value keeps it.
 */
export const COMFYUI_LAYOUT_MAX_CHARACTERS_SETTING = "illustratorLayoutMaxCharacters";

export function applyComfyLayoutCharacterCap(connectionLimit: number, chatMetadata?: Record<string, unknown>): number {
  if (connectionLimit <= 0) return connectionLimit;
  const raw = chatMetadata?.[COMFYUI_LAYOUT_MAX_CHARACTERS_SETTING];
  const cap = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isInteger(cap) || cap < 1) return connectionLimit;
  return Math.min(connectionLimit, cap);
}

/** Where a layout box's fixed look comes from, in Ben's priority order: card, lore `Looks:` line, tracker. */
export type ComfyLayoutLookSources = {
  /** Character cards and the persona; `appearance` should already prefer the image-only override. */
  cards: ReadonlyArray<{ name: string; appearance?: string | null }>;
  /** Activated lorebook entries; a `Looks:` line in an entry named for the character, or `<Name> looks:` anywhere. */
  lore: ReadonlyArray<{ name?: string | null; content: string }>;
  /** Character tracker rows. */
  tracker: ReadonlyArray<{ name: string; appearance?: string | null; outfit?: string | null }>;
};

function normalizeLookName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** "Hedda" matches "Hedda Halden" when it is the only name sharing that first word. */
function sameLookName(a: string, b: string): boolean {
  const left = normalizeLookName(a);
  const right = normalizeLookName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftWords = left.split(" ");
  const rightWords = right.split(" ");
  return leftWords[0] === rightWords[0] && (leftWords.length === 1 || rightWords.length === 1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loreLooks(name: string, lore: ComfyLayoutLookSources["lore"]): string {
  const fullName = escapeRegExp(name.trim());
  const firstName = escapeRegExp(name.trim().split(/\s+/)[0] ?? "");
  const named = new RegExp(`^\\s*(?:${fullName}|${firstName})\\s+looks\\s*:\\s*(.+)$`, "imu");
  for (const entry of lore) {
    const match = entry.content.match(named);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  for (const entry of lore) {
    if (!entry.name || !sameLookName(entry.name, name)) continue;
    const match = entry.content.match(/^\s*looks\s*:\s*(.+)$/imu);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

export type ComfyLayoutLookSource = "card" | "lore" | "tracker" | "none";

export function resolveComfyLayoutLookWithSource(
  name: string,
  sources: ComfyLayoutLookSources,
): { looks: string; source: ComfyLayoutLookSource } {
  const card = sources.cards.find((entry) => sameLookName(entry.name, name))?.appearance?.trim();
  if (card) return { looks: card, source: "card" };
  const lore = loreLooks(name, sources.lore);
  if (lore) return { looks: lore, source: "lore" };
  const row = sources.tracker.find((entry) => sameLookName(entry.name, name));
  const tracker = [row?.appearance?.trim(), row?.outfit?.trim()].filter(Boolean).join(". ");
  return tracker ? { looks: tracker, source: "tracker" } : { looks: "", source: "none" };
}

export function resolveComfyLayoutLooks(name: string, sources: ComfyLayoutLookSources): string {
  return resolveComfyLayoutLookWithSource(name, sources).looks;
}

/** Every `<Name> looks: ...` line in the lore: companions, familiars and mounts described on their person's entry. */
function loreCompanionLooks(lore: ComfyLayoutLookSources["lore"]): Array<{ name: string; looks: string }> {
  const found: Array<{ name: string; looks: string }> = [];
  for (const entry of lore) {
    for (const match of entry.content.matchAll(/^\s*([\p{L}][\p{L}\p{N}' -]{0,40}?)\s+looks\s*:\s*(.+)$/gimu)) {
      const name = match[1]!.trim();
      const looks = match[2]!.trim();
      if (looks && !found.some((item) => sameLookName(item.name, name))) found.push({ name, looks });
    }
  }
  return found;
}

function mentions(text: string, name: string): boolean {
  return new RegExp(`(^|[^\\p{L}])${escapeRegExp(name)}(?![\\p{L}])`, "iu").test(text);
}

const trimLook = (value: string) => value.replace(/[.\s]+$/u, "");

/**
 * Fork scene composer: the prompt writer supplies each boxed character's action and pose; the
 * engine supplies who they look like, so looks stay the same from one picture to the next. A
 * companion the action names (a familiar on a shoulder, a horse being ridden) gets its lore
 * `<Name> looks:` line in the same box.
 */
export function composeComfyLayoutCharacterPrompts(
  characterPrompts: SceneIllustrationCharacterPrompt[],
  sources: ComfyLayoutLookSources,
  onLook?: (line: { name: string; source: ComfyLayoutLookSource; looks: string; companions: string[] }) => void,
): SceneIllustrationCharacterPrompt[] {
  const companions = loreCompanionLooks(sources.lore);
  return characterPrompts.map((entry) => {
    const { looks, source } = resolveComfyLayoutLookWithSource(entry.name, sources);
    const action = entry.prompt.trim();
    const carried = companions.filter(
      (companion) =>
        !characterPrompts.some((other) => sameLookName(other.name, companion.name)) && mentions(action, companion.name),
    );
    onLook?.({ name: entry.name, source, looks, companions: carried.map((companion) => companion.name) });
    const parts = [
      looks ? `${entry.name}: ${trimLook(looks)}.` : `${entry.name}:`,
      action,
      ...carried.map((companion) => `${companion.name}: ${trimLook(companion.looks)}.`),
    ];
    return { ...entry, prompt: parts.join(" ") };
  });
}

/** Look sources from an agent context, for the generate and retry routes. */
export function comfyLayoutLookSourcesFromContext(context: {
  characters: ReadonlyArray<{ id: string; name: string; appearance?: string }>;
  persona?: { name: string; appearance?: string } | null;
  activatedLorebookEntries?: ReadonlyArray<{ name?: string; content: string }>;
  gameState?: {
    presentCharacters?: ReadonlyArray<{ name: string; appearance?: string | null; outfit?: string | null }>;
  } | null;
  memory: Record<string, unknown>;
}): ComfyLayoutLookSources {
  const cards = context.characters.map((character) => ({
    name: character.name,
    appearance: readIllustratorImageAppearanceOverride(context.memory, character.id) ?? character.appearance ?? "",
  }));
  if (context.persona) {
    cards.push({
      name: context.persona.name,
      appearance:
        readIllustratorImageAppearanceOverride(context.memory, personaEntityId(context.memory)) ??
        context.persona.appearance ??
        "",
    });
  }
  return {
    cards,
    lore: context.activatedLorebookEntries ?? [],
    tracker: context.gameState?.presentCharacters ?? [],
  };
}
