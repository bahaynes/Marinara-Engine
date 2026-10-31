// Fork: guards ComfyUI layout workflows (Create Bounding Boxes -> MOSS-Image Layout Prompt).
//
// A workflow holding %layout_bboxes% receives the Illustrator's per-character prompts as boxes
// ({ desc, bbox: [ymin, xmin, ymax, xmax] on 0-1000, type }) plus the 1-based box numbers in
// %layout_character_boxes%, and the base prompt is no longer flattened with the captions.
// Every other ComfyUI workflow, and SwarmUI/RunPod, keeps the flattened prompt.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  applyComfyLayoutCharacterCap,
  buildComfyLayoutReplacements,
  comfyLayoutLookSourcesFromContext,
  composeComfyLayoutCharacterPrompts,
  resolveComfyLayoutLooks,
} from "../../packages/server/src/services/image/comfyui-layout-placeholders.js";
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

// Two characters: two full-height columns side by side, inside an even 5% margin.
const pair = [
  { name: "A", prompt: "a tall knight in silver armor", position: { x: 1 / 3, y: 0.5 } },
  { name: "B", prompt: "a small mage casting a blue spell", position: { x: 2 / 3, y: 0.5 } },
];
const pairReplacements = buildComfyLayoutReplacements(pair);
assert.deepEqual(parse(pairReplacements), [
  { type: "obj", desc: "a tall knight in silver armor", bbox: [50, 50, 950, 500] },
  { type: "obj", desc: "a small mage casting a blue spell", bbox: [50, 500, 950, 950] },
]);
assert.equal(pairReplacements["%layout_character_boxes%"], "1, 2");

// Four characters stay in one row (stacked short boxes duplicated people), ordered by the
// writer's x; its y is ignored.
const four = buildComfyLayoutReplacements(
  ["A", "B", "C", "D"].map((name, index) => ({
    name,
    prompt: `person ${name}`,
    position: { x: [0.8, 0.2, 0.6, 0.4][index]!, y: [0.1, 0.9, 0.5, 0.5][index]! },
  })),
);
assert.deepEqual(
  parse(four).map((entry) => entry.desc),
  ["person B", "person D", "person C", "person A"],
);
for (const [index, { bbox }] of parse(four).entries()) {
  const [ymin, xmin, ymax, xmax] = bbox as [number, number, number, number];
  assert.deepEqual([ymin, ymax], [50, 950], `full height: ${bbox}`);
  assert.equal(xmin, 50 + index * 225, `column ${index}`);
  assert.equal(xmax - xmin, 225, "four columns of 0.225");
}
assert.equal(four["%layout_character_boxes%"], "1, 2, 3, 4");

// A single character gets one centred full-height box.
assert.deepEqual(
  parse(buildComfyLayoutReplacements([{ name: "A", prompt: "solo", position: { x: 0, y: 1 } }]))[0]!.bbox,
  [50, 50, 950, 950],
);

// Gallery regenerations may omit position; entries keep their order.
assert.deepEqual(
  parse(
    buildComfyLayoutReplacements([
      { name: "A", prompt: "p" },
      { name: "B", prompt: "q" },
    ] as never),
  ).map((entry) => [entry.desc, entry.bbox]),
  [
    ["p", [50, 50, 950, 500]],
    ["q", [50, 500, 950, 950]],
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

// Lore text with quotes, backslashes and newlines survives substitution as the same JSON.
const awkward = [
  { name: "Q", prompt: 'a scarf reading "home", a path C:\\road\nand a second line', position: { x: 0.5, y: 0.5 } },
];
const awkwardReplacements = buildComfyLayoutReplacements(awkward);
const awkwardRun = replaceComfyUiPlaceholders(
  JSON.parse(JSON.stringify({ node: { inputs: { bboxes: "%layout_bboxes%" } } })),
  awkwardReplacements,
) as { node: { inputs: { bboxes: string } } };
assert.equal((JSON.parse(awkwardRun.node.inputs.bboxes) as Element[])[0]!.desc, awkward[0]!.prompt);

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

// The chat setting caps boxes below the connection's own cap; nonsense keeps the connection cap.
assert.equal(
  resolveComfyLayoutCharacterPromptLimit(comfy("comfyui", layoutWorkflow), { illustratorLayoutMaxCharacters: 3 }),
  3,
);
assert.equal(applyComfyLayoutCharacterCap(6, { illustratorLayoutMaxCharacters: "2" }), 2);
assert.equal(applyComfyLayoutCharacterCap(6, { illustratorLayoutMaxCharacters: 9 }), 6, "never above the connection");
assert.equal(applyComfyLayoutCharacterCap(6, { illustratorLayoutMaxCharacters: 0 }), 6);
assert.equal(applyComfyLayoutCharacterCap(6, { illustratorLayoutMaxCharacters: 1.5 }), 6);
assert.equal(applyComfyLayoutCharacterCap(0, { illustratorLayoutMaxCharacters: 3 }), 0, "no layout stays off");

// Looks come from the card first, then a lore Looks: line, then the tracker.
const lookSources = {
  cards: [
    { name: "Mira Vale", appearance: "card look for Mira" },
    { name: "Oren", appearance: "" },
  ],
  lore: [
    { name: "Oren Hask", content: "Oren Hask (he/him).\nLooks: lore look for Oren\nFamiliar: Pip, a ferret." },
    { name: "Mira Vale", content: "Looks: lore look Mira should not use\nPip looks: lore look for Pip" },
  ],
  tracker: [
    { name: "Mira Vale", appearance: "tracker look Mira", outfit: null },
    { name: "Tess", appearance: "tracker look for Tess", outfit: "a grey cloak" },
  ],
};
assert.equal(resolveComfyLayoutLooks("Mira Vale", lookSources), "card look for Mira", "card wins");
assert.equal(resolveComfyLayoutLooks("Oren", lookSources), "lore look for Oren", "empty card falls to lore");
assert.equal(resolveComfyLayoutLooks("Pip", lookSources), "lore look for Pip", "a <Name> looks: line anywhere");
assert.equal(resolveComfyLayoutLooks("Tess", lookSources), "tracker look for Tess. a grey cloak", "tracker last");
assert.equal(resolveComfyLayoutLooks("Nobody", lookSources), "");

// The composer puts the engine's looks in front of the writer's action.
assert.deepEqual(
  composeComfyLayoutCharacterPrompts(
    [
      { name: "Oren", prompt: "kneels by the fire.", position: { x: 0.3, y: 0.5 } },
      { name: "Nobody", prompt: "waves.", position: { x: 0.7, y: 0.5 } },
    ],
    lookSources,
  ).map((entry) => entry.prompt),
  ["Oren: lore look for Oren. kneels by the fire.", "Nobody: waves."],
);

// A companion the action names brings its lore "<Name> looks:" line into its person's box;
// another boxed character named in the action does not.
const companionSources = {
  cards: [],
  lore: [
    { name: "Oren Hask", content: "Looks: a broad smith\nFamiliar: Pip, a ferret.\nPip looks: a sleek white ferret" },
    { name: "Mira Vale", content: "Mira looks: a small archer" },
  ],
  tracker: [],
};
const logged: string[] = [];
assert.deepEqual(
  composeComfyLayoutCharacterPrompts(
    [
      { name: "Oren Hask", prompt: "holds Pip up to the light and grins at Mira.", position: { x: 0.3, y: 0.5 } },
      { name: "Mira Vale", prompt: "laughs.", position: { x: 0.7, y: 0.5 } },
    ],
    companionSources,
    (line) => logged.push(`${line.name}:${line.source}:${line.companions.join("+")}`),
  ).map((entry) => entry.prompt),
  [
    "Oren Hask: a broad smith. holds Pip up to the light and grins at Mira. Pip: a sleek white ferret.",
    "Mira Vale: a small archer. laughs.",
  ],
);
assert.deepEqual(logged, ["Oren Hask:lore:Pip", "Mira Vale:lore:"]);

// Context adapter: the image-only appearance override beats the card text, persona included.
const adapted = comfyLayoutLookSourcesFromContext({
  characters: [{ id: "c1", name: "Mira Vale", appearance: "card text" }],
  persona: { name: "Rowan", appearance: "persona text" },
  activatedLorebookEntries: [],
  gameState: null,
  memory: { _illustratorImageAppearanceOverrides: { c1: "override text" }, _personaId: "p1" },
});
assert.deepEqual(adapted.cards, [
  { name: "Mira Vale", appearance: "override text" },
  { name: "Rowan", appearance: "persona text" },
]);

// The layout instruction asks for natural language and drops NovelAI-only syntax.
const layoutInstruction = buildIllustratorCharacterPromptInstruction(6, "comfyui_layout");
assert.match(layoutInstruction, /characterPrompts/);
assert.match(layoutInstruction, /natural-language/);
assert.match(layoutInstruction, /x=0 is left/, "position semantics are taught");
assert.doesNotMatch(layoutInstruction, /NovelAI|source#/);
assert.match(layoutInstruction, /setting and the moment/, "the base prompt holds no people");
assert.match(layoutInstruction, /engine adds each character's fixed looks/);
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
