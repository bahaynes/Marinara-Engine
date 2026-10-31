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

// Share of the canvas the boxes of one row (or one column) take together; the rest is margin.
const LAYOUT_FILL = 0.9;
const LAYOUT_COLUMNS = 3;

export function comfyWorkflowTakesLayout(workflowText: string | null | undefined): boolean {
  return typeof workflowText === "string" && workflowText.includes(COMFYUI_LAYOUT_BBOXES_PLACEHOLDER);
}

function toGrid(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 1000);
}

/**
 * One box per character, centred on the prompt writer's normalized position and sized to the
 * same rows of three as `defaultCharacterPromptPosition`. Create Bounding Boxes reads each
 * element's `bbox` as [ymin, xmin, ymax, xmax] on a 0-1000 grid; an empty list leaves the MOSS
 * prompt as the plain scene prompt.
 */
export function buildComfyLayoutReplacements(
  characterPrompts: readonly SceneIllustrationCharacterPrompt[] | undefined,
): Record<string, string> {
  const entries = (characterPrompts ?? []).slice(0, COMFYUI_LAYOUT_MAX_CHARACTER_PROMPTS);
  const columns = Math.min(entries.length, LAYOUT_COLUMNS);
  const rows = Math.ceil(entries.length / LAYOUT_COLUMNS);
  const width = LAYOUT_FILL / Math.max(1, columns);
  const height = LAYOUT_FILL / Math.max(1, rows);
  const elements = entries.map((entry, index) => {
    // Gallery regenerations may arrive without a position.
    const center = entry.position ?? defaultCharacterPromptPosition(index, entries.length);
    // Keep the whole box on the canvas by sliding it inward rather than shrinking it.
    const left = Math.min(1 - width, Math.max(0, center.x - width / 2));
    const top = Math.min(1 - height, Math.max(0, center.y - height / 2));
    return {
      type: "obj",
      desc: entry.prompt,
      bbox: [toGrid(top), toGrid(left), toGrid(top + height), toGrid(left + width)],
    };
  });
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

export function resolveComfyLayoutLooks(name: string, sources: ComfyLayoutLookSources): string {
  const card = sources.cards.find((entry) => sameLookName(entry.name, name))?.appearance?.trim();
  if (card) return card;
  const lore = loreLooks(name, sources.lore);
  if (lore) return lore;
  const row = sources.tracker.find((entry) => sameLookName(entry.name, name));
  return [row?.appearance?.trim(), row?.outfit?.trim()].filter(Boolean).join(". ");
}

/**
 * Fork scene composer: the prompt writer supplies each boxed character's action and pose; the
 * engine supplies who they look like, so looks stay the same from one picture to the next.
 */
export function composeComfyLayoutCharacterPrompts(
  characterPrompts: SceneIllustrationCharacterPrompt[],
  sources: ComfyLayoutLookSources,
): SceneIllustrationCharacterPrompt[] {
  return characterPrompts.map((entry) => {
    const looks = resolveComfyLayoutLooks(entry.name, sources).replace(/[.\s]+$/u, "");
    const action = entry.prompt.trim();
    return { ...entry, prompt: looks ? `${entry.name}: ${looks}. ${action}` : `${entry.name}: ${action}` };
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
