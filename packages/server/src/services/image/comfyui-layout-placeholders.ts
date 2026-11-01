import type { SceneIllustrationCharacterPrompt } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import {
  COMFY_LAYOUT_INSTRUCTION_MARKER,
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
  /** Activated lorebook entries: `Looks:` / `Outfit:` lines in an entry named for the character, or `<Name> looks:` / `<Name> outfit:` anywhere. */
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

function loreField(name: string, field: "looks" | "outfit", lore: ComfyLayoutLookSources["lore"]): string {
  const fullName = escapeRegExp(name.trim());
  const firstName = escapeRegExp(name.trim().split(/\s+/)[0] ?? "");
  const named = new RegExp(`^\\s*(?:${fullName}|${firstName})\\s+${field}\\s*:\\s*(.+)$`, "imu");
  for (const entry of lore) {
    const match = entry.content.match(named);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  const bare = new RegExp(`^\\s*${field}\\s*:\\s*(.+)$`, "imu");
  for (const entry of lore) {
    if (!entry.name || !sameLookName(entry.name, name)) continue;
    const match = entry.content.match(bare);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

/** The tracker writes "none" or "n/a" for an empty outfit. */
function trackerValue(value: string | null | undefined): string {
  const text = value?.trim() ?? "";
  return /^(?:none|n\/?a|unknown|-)?$/iu.test(text) ? "" : text;
}

export type ComfyLayoutLookSource = "card" | "lore" | "tracker" | "none";

/**
 * Body: fixed traits, card or persona first, then the lore `Looks:` line, then the tracker.
 * Outfit: current clothes, the tracker first (it follows the story), then the lore `Outfit:` line.
 * Card text may still carry clothing; split it into Appearance and an `Outfit:` lore line to let
 * the tracker take over.
 */
export function resolveComfyLayoutLookWithSource(
  name: string,
  sources: ComfyLayoutLookSources,
): { looks: string; source: ComfyLayoutLookSource; outfit: string; outfitSource: ComfyLayoutLookSource } {
  const row = sources.tracker.find((entry) => sameLookName(entry.name, name));
  const trackerOutfit = trackerValue(row?.outfit);
  const loreOutfit = loreField(name, "outfit", sources.lore);
  const outfit = trackerOutfit
    ? { outfit: trackerOutfit, outfitSource: "tracker" as const }
    : loreOutfit
      ? { outfit: loreOutfit, outfitSource: "lore" as const }
      : { outfit: "", outfitSource: "none" as const };
  const card = sources.cards.find((entry) => sameLookName(entry.name, name))?.appearance?.trim();
  if (card) return { looks: card, source: "card", ...outfit };
  const lore = loreField(name, "looks", sources.lore);
  if (lore) return { looks: lore, source: "lore", ...outfit };
  const tracker = trackerValue(row?.appearance);
  return tracker ? { looks: tracker, source: "tracker", ...outfit } : { looks: "", source: "none", ...outfit };
}

export function resolveComfyLayoutLooks(name: string, sources: ComfyLayoutLookSources): string {
  return resolveComfyLayoutLookWithSource(name, sources).looks;
}

/** Every `<Name> looks: ...` line in the lore: pets, companion animals and mounts described on their person's entry. */
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

/** The `onLook` log line for composeComfyLayoutCharacterPrompts. */
export function logComfyLayoutBox(prefix: string) {
  return ({
    name,
    source,
    looks,
    outfitSource,
    companions,
  }: {
    name: string;
    source: ComfyLayoutLookSource;
    looks: string;
    outfitSource: ComfyLayoutLookSource;
    companions: string[];
  }) =>
    logger.info(
      `${prefix} %s: looks from %s (%s), outfit from %s%s`,
      name,
      source,
      looks.slice(0, 60),
      outfitSource,
      companions.length ? `, with ${companions.join(", ")}` : "",
    );
}

/**
 * Fork scene composer: the prompt writer supplies each boxed character's action and pose; the
 * engine supplies who they look like, so looks stay the same from one picture to the next. A
 * companion the action names (a cat on a shoulder, a horse being ridden) gets its lore
 * `<Name> looks:` line in the same box.
 */
export function composeComfyLayoutCharacterPrompts(
  characterPrompts: SceneIllustrationCharacterPrompt[],
  sources: ComfyLayoutLookSources,
  onLook?: (line: {
    name: string;
    source: ComfyLayoutLookSource;
    looks: string;
    outfitSource: ComfyLayoutLookSource;
    companions: string[];
  }) => void,
): SceneIllustrationCharacterPrompt[] {
  const companions = loreCompanionLooks(sources.lore);
  return characterPrompts.map((entry) => {
    const { looks, source, outfit, outfitSource } = resolveComfyLayoutLookWithSource(entry.name, sources);
    const action = entry.prompt.trim();
    const carried = companions.filter(
      (companion) =>
        !characterPrompts.some((other) => sameLookName(other.name, companion.name)) && mentions(action, companion.name),
    );
    onLook?.({ name: entry.name, source, looks, outfitSource, companions: carried.map((companion) => companion.name) });
    const parts = [
      looks ? `${entry.name}: ${trimLook(looks)}.` : `${entry.name}:`,
      ...(outfit ? [`Wearing ${trimLook(outfit)}.`] : []),
      action,
      ...carried.map((companion) => `${companion.name}: ${trimLook(companion.looks)}.`),
    ];
    return { ...entry, prompt: parts.join(" ") };
  });
}

/** Look sources from an agent context, for the generate and retry routes. */
export function comfyLayoutLookSourcesFromContext(
  context: {
    characters: ReadonlyArray<{ id: string; name: string; appearance?: string }>;
    persona?: { name: string; appearance?: string } | null;
    activatedLorebookEntries?: ReadonlyArray<{ name?: string; content: string }>;
    gameState?: {
      presentCharacters?: ReadonlyArray<{ name: string; appearance?: string | null; outfit?: string | null }>;
    } | null;
    memory: Record<string, unknown>;
  },
  turnTracker?: ComfyLayoutLookSources["tracker"] | null,
): ComfyLayoutLookSources {
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
    // This turn's tracker update when the caller has it; outfits change with the story.
    tracker: turnTracker ?? context.gameState?.presentCharacters ?? [],
  };
}

/**
 * Fork: on a layout workflow the Illustrator's scene prompt is split into setting, lighting and
 * props that never mention a person. The default template's "describe every visible character"
 * rule made the writer put people in the scene prompt, and MOSS drew them as extra figures outside
 * the boxes (bench 2026-11-01, 20 scenes: 5/18 images with an extra person as shipped, 5/19 with
 * the rule reworded, 0/20 with these fields). Only the default template's exact wording is
 * rewritten; any other template is left alone and the caller logs it.
 */
const UPSTREAM_ILLUSTRATOR_PROMPT_FIELD = '"prompt": "detailed prompt if shouldGenerate is true",';
const UPSTREAM_ILLUSTRATOR_PEOPLE_RULES =
  "Prompt rules: describe composition, lighting, mood, environment, and every visible character/persona directly. For each visible character/persona, " +
  "include available body build (chubby, slim, muscular, etc.), clothing/outfit, hair, face, distinguishing features, and other appearance details from context. Do not invent missing traits.";
const COMFY_LAYOUT_SCENE_FIELDS =
  '"setting": "the place itself: architecture, ground, plants, furniture. No people or animals.",\n' +
  '  "lighting": "light, weather, time of day and mood. No people or animals.",\n' +
  '  "props": "loose objects in the scene that nobody is holding. No people or animals.",';
const COMFY_LAYOUT_SCENE_RULES =
  "Prompt rules: setting, lighting and props describe the empty set the characters stand in and never mention a person, animal or body. " +
  "Everything about a character (pose, action, expression, what they hold, who they look at) goes only in their characterPrompts entry.";
const COMFY_LAYOUT_SCENE_KEYS = ["setting", "lighting", "props"] as const;

export function isComfyLayoutCharacterPromptInstruction(instruction: unknown): boolean {
  return typeof instruction === "string" && instruction.includes(COMFY_LAYOUT_INSTRUCTION_MARKER);
}

/** The Illustrator template with the scene-field contract swapped in, or null when its wording isn't the default's. */
export function rewriteIllustratorTemplateForComfyLayout(template: string): string | null {
  if (!template.includes(UPSTREAM_ILLUSTRATOR_PROMPT_FIELD) || !template.includes(UPSTREAM_ILLUSTRATOR_PEOPLE_RULES)) {
    return null;
  }
  return template
    .replace(UPSTREAM_ILLUSTRATOR_PROMPT_FIELD, () => COMFY_LAYOUT_SCENE_FIELDS)
    .replace(UPSTREAM_ILLUSTRATOR_PEOPLE_RULES, () => COMFY_LAYOUT_SCENE_RULES);
}

const UPSTREAM_MANUAL_PROMPT_FIELD = '{"prompt":"detailed provider-ready image prompt",';
const UPSTREAM_MANUAL_DESCRIBE_RULE =
  "The prompt should describe subjects, actions, expressions, environment, camera/framing, lighting, atmosphere, and important props without narrating your reasoning.";
const UPSTREAM_MANUAL_CARD_TRAITS =
  "keep identities, clothing, physical traits, relationships, and setting details consistent.";
const COMFY_LAYOUT_MANUAL_SCENE_FIELDS =
  '{"setting":"the place itself: architecture, ground, plants, furniture. No people or animals.",' +
  '"lighting":"light, weather, time of day and mood. No people or animals.",' +
  '"props":"loose objects in the scene that nobody is holding. No people or animals.",';

/**
 * The manual Illustrate (Gallery button) writer has its own schema that demands "prompt"; on a
 * layout workflow it gets the same scene fields and rule as the automatic writer. Unmatched
 * wording is left as is.
 */
export function adaptManualIllustratorPromptForComfyLayout(systemPrompt: string): string {
  return systemPrompt
    .replace(UPSTREAM_MANUAL_PROMPT_FIELD, () => COMFY_LAYOUT_MANUAL_SCENE_FIELDS)
    .replace(UPSTREAM_MANUAL_DESCRIBE_RULE, () => COMFY_LAYOUT_SCENE_RULES)
    .replace(UPSTREAM_MANUAL_CARD_TRAITS, () => "keep identities, relationships, and setting details consistent.");
}

/**
 * Joins setting, lighting and props into "prompt" whenever the writer returned any of them, so
 * every reader of the Illustrator result keeps reading one scene prompt, built only from the
 * people-free fields as in the bench. Writers outside layout mode never return these fields, so
 * their results pass through unchanged.
 */
export function foldComfyLayoutSceneFields<T>(data: T): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const parts = COMFY_LAYOUT_SCENE_KEYS.map((key) =>
    typeof record[key] === "string" ? (record[key] as string).trim() : "",
  ).filter(Boolean);
  if (parts.length === 0) return data;
  return { ...record, prompt: parts.join(" ") } as T;
}
