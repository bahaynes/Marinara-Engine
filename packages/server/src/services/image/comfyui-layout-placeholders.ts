import type { SceneIllustrationCharacterPrompt } from "@marinara-engine/shared";
import { defaultCharacterPromptPosition } from "./character-prompts.js";

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
