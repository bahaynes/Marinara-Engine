// Fork: guards ComfyUI layout workflows (Create Bounding Boxes -> MOSS-Image Layout Prompt).
//
// A workflow holding %layout_bboxes% receives the Illustrator's per-character prompts as boxes
// ({ desc, bbox: [ymin, xmin, ymax, xmax] on 0-1000, type }) plus the 1-based box numbers in
// %layout_character_boxes%, and the base prompt is no longer flattened with the captions.
// Every other ComfyUI workflow, and SwarmUI/RunPod, keeps the flattened prompt.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { buildComfyLayoutReplacements } from "../../packages/server/src/services/image/comfyui-layout-placeholders.js";
import { buildIllustratorCharacterPromptInstruction } from "../../packages/server/src/services/image/character-prompts.js";
import {
  generateImage,
  replaceComfyUiPlaceholders,
} from "../../packages/server/src/services/image/image-generation.js";
import {
  resolveComfyLayoutCharacterPromptLimit,
  resolveIllustratorCharacterPromptInstruction,
} from "../../packages/server/src/services/generation/illustrator-background-generation.js";

type Element = { type: string; desc: string; bbox: number[] };
const parse = (replacements: Record<string, string>) => JSON.parse(replacements["%layout_bboxes%"]!) as Element[];

// Two characters at the default left/right centers split the canvas into two tall boxes.
const pair = [
  { name: "A", prompt: "a tall knight in silver armor", position: { x: 1 / 3, y: 0.5 } },
  { name: "B", prompt: "a small mage casting a blue spell", position: { x: 2 / 3, y: 0.5 } },
];
const pairReplacements = buildComfyLayoutReplacements(pair);
assert.deepEqual(parse(pairReplacements), [
  { type: "obj", desc: "a tall knight in silver armor", bbox: [50, 108, 950, 558] },
  { type: "obj", desc: "a small mage casting a blue spell", bbox: [50, 442, 950, 892] },
]);
assert.equal(pairReplacements["%layout_character_boxes%"], "1, 2");

// Four characters wrap onto rows of three; every box stays on the canvas and ordered yxyx.
const four = buildComfyLayoutReplacements(
  ["A", "B", "C", "D"].map((name, index) => ({
    name,
    prompt: `person ${name}`,
    position: { x: [0.25, 0.5, 0.75, 0.5][index]!, y: [1 / 3, 1 / 3, 1 / 3, 2 / 3][index]! },
  })),
);
for (const { bbox } of parse(four)) {
  const [ymin, xmin, ymax, xmax] = bbox as [number, number, number, number];
  assert.ok(ymin >= 0 && xmin >= 0 && ymax <= 1000 && xmax <= 1000, `on canvas: ${bbox}`);
  assert.ok(ymin < ymax && xmin < xmax, `yxyx order: ${bbox}`);
  assert.equal(xmax - xmin, 300, "three columns of 0.3");
  assert.equal(ymax - ymin, 450, "two rows of 0.45");
}
assert.equal(four["%layout_character_boxes%"], "1, 2, 3, 4");

// A box centered on the edge slides inward instead of leaving the canvas.
assert.deepEqual(
  parse(buildComfyLayoutReplacements([{ name: "A", prompt: "edge", position: { x: 0, y: 1 } }]))[0]!.bbox,
  [100, 0, 1000, 900],
);

// Gallery regenerations may omit position; the default layout fills it in.
assert.deepEqual(
  parse(
    buildComfyLayoutReplacements([
      { name: "A", prompt: "p" },
      { name: "B", prompt: "q" },
    ] as never),
  ).map((entry) => entry.bbox),
  [
    [50, 108, 950, 558],
    [50, 442, 950, 892],
  ],
);

// No captions: an empty element list, which MOSS turns back into the plain scene prompt.
assert.deepEqual(buildComfyLayoutReplacements(undefined), {
  "%layout_bboxes%": "[]",
  "%layout_character_boxes%": "",
});

// Exact-match substitution keeps the boxes a JSON string, which Create Bounding Boxes parses.
const substituted = replaceComfyUiPlaceholders(
  { bboxes: "%layout_bboxes%", character_boxes: "%layout_character_boxes%" },
  pairReplacements,
) as Record<string, unknown>;
assert.equal(typeof substituted.bboxes, "string");
assert.equal(substituted.character_boxes, "1, 2");

// Only a plain ComfyUI connection whose workflow holds the placeholder takes layout captions.
const layoutWorkflow = JSON.stringify({
  "20": { class_type: "PrimitiveStringMultiline", inputs: { value: "%prompt%" } },
  "21": { class_type: "CreateBoundingBoxes", inputs: { bboxes: "%layout_bboxes%" } },
  "22": { class_type: "MOSSImageLayoutPrompt", inputs: { character_boxes: "%layout_character_boxes%" } },
});
const plainWorkflow = JSON.stringify({ "6": { class_type: "CLIPTextEncode", inputs: { text: "%prompt%" } } });
const comfy = (imageService: string, comfyuiWorkflow: string | null) => ({
  model: "moss_image_base_bf16.safetensors",
  baseUrl: "http://127.0.0.1:8188",
  imageService,
  comfyuiWorkflow,
});
assert.equal(resolveComfyLayoutCharacterPromptLimit(comfy("comfyui", layoutWorkflow)), 6);
assert.equal(resolveComfyLayoutCharacterPromptLimit(comfy("comfyui", plainWorkflow)), 0);
assert.equal(resolveComfyLayoutCharacterPromptLimit(comfy("comfyui", null)), 0);
assert.equal(resolveComfyLayoutCharacterPromptLimit(comfy("swarmui", layoutWorkflow)), 0);
assert.equal(resolveComfyLayoutCharacterPromptLimit(comfy("runpod_comfyui", layoutWorkflow)), 0);

// The layout instruction asks for natural language and drops NovelAI-only syntax.
const layoutInstruction = buildIllustratorCharacterPromptInstruction(6, "comfyui_layout");
assert.match(layoutInstruction, /characterPrompts/);
assert.match(layoutInstruction, /natural-language/);
assert.match(layoutInstruction, /x=0 is left/, "position semantics are taught");
assert.doesNotMatch(layoutInstruction, /NovelAI|source#/);
assert.match(buildIllustratorCharacterPromptInstruction(6), /NovelAI/, "the default flavor is unchanged");

const resolved = await resolveIllustratorCharacterPromptInstruction({
  connections: {
    getWithKey: async () => null,
    getDefaultForImageGeneration: async () => ({ id: "moss", ...comfy("comfyui", layoutWorkflow) }),
  } as never,
  illustratorAgent: { settings: { imageConnectionId: null } } as never,
  chatMode: "roleplay",
  chatMetadata: {},
});
assert.equal(resolved.limit, 6);
assert.equal(resolved.instruction, layoutInstruction);

// End to end: the queued workflow carries the boxes and the unflattened scene prompt.
const queued: Array<Record<string, { inputs: Record<string, unknown> }>> = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    if (req.url === "/prompt") queued.push(JSON.parse(body).prompt);
    // Refuse the queue so generateImage stops right after building the workflow.
    res.writeHead(500).end("stop");
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  for (const workflow of [layoutWorkflow, plainWorkflow]) {
    await assert.rejects(
      generateImage("comfyui", baseUrl, "", "comfyui", {
        prompt: "two adventurers in a moonlit forest",
        model: "moss_image_base_bf16.safetensors",
        comfyWorkflow: workflow,
        characterPrompts: pair,
        allowLocalUrls: true,
      }),
      /ComfyUI queue failed/,
    );
  }
} finally {
  server.close();
}
assert.equal(queued.length, 2);
const [layoutRun, plainRun] = queued as [
  Record<string, { inputs: Record<string, unknown> }>,
  Record<string, { inputs: Record<string, unknown> }>,
];
assert.equal(layoutRun["20"]!.inputs.value, "two adventurers in a moonlit forest", "base prompt stays unflattened");
assert.equal(layoutRun["21"]!.inputs.bboxes, pairReplacements["%layout_bboxes%"]);
assert.equal(layoutRun["22"]!.inputs.character_boxes, "1, 2");
assert.match(String(plainRun["6"]!.inputs.text), /A: a tall knight in silver armor/, "other workflows still flatten");

console.log("ComfyUI layout regression passed");
