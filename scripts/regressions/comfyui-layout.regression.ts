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
  foldComfyLayoutSceneFields,
  isComfyLayoutCharacterPromptInstruction,
  resolveComfyLayoutLooks,
  rewriteIllustratorTemplateForComfyLayout,
} from "../../packages/server/src/services/image/comfyui-layout-placeholders.js";
import type { AgentContext } from "../../packages/shared/src/index.js";
import { alignComfyLayoutReferences } from "../../packages/server/src/services/image/image-agent-comfy-extensions.js";
import { renderAgentPromptTemplate } from "../../packages/server/src/services/agents/agent-executor.js";
import {
  buildManualIllustratorPromptMessages,
  parseManualIllustratorPromptPlan,
} from "../../packages/server/src/services/generation/illustrator-manual-prompt-generation.js";
import {
  buildIllustratorCharacterPromptInstruction,
  readComfyLayoutCharacterLimit,
} from "../../packages/server/src/services/image/character-prompts.js";
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

// Four characters stay in one row (stacked short boxes duplicated people), placed in columns by
// the writer's x (its y is ignored). Elements keep the caller's order: the Flux regional stack
// pairs element k with reference image k.
const four = buildComfyLayoutReplacements(
  ["A", "B", "C", "D"].map((name, index) => ({
    name,
    prompt: `person ${name}`,
    position: { x: [0.8, 0.2, 0.6, 0.4][index]!, y: [0.1, 0.9, 0.5, 0.5][index]! },
  })),
);
assert.deepEqual(
  parse(four).map((entry) => entry.desc),
  ["person A", "person B", "person C", "person D"],
);
for (const [index, { bbox }] of parse(four).entries()) {
  const [ymin, xmin, ymax, xmax] = bbox as [number, number, number, number];
  const column = [3, 0, 2, 1][index]!;
  assert.deepEqual([ymin, ymax], [50, 950], `full height: ${bbox}`);
  assert.equal(xmin, 50 + column * 225, `element ${index} sits in column ${column}`);
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
    { name: "Oren Hask", content: "Oren Hask (he/him).\nLooks: lore look for Oren\nPet: Pip, a ferret." },
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
assert.equal(resolveComfyLayoutLooks("Tess", lookSources), "tracker look for Tess", "tracker last");

// Outfit is the other way round: this turn's tracker outfit first, then the lore Outfit: line.
const outfitSources = {
  cards: [{ name: "Mira Vale", appearance: "small, freckled" }],
  lore: [
    { name: "Mira Vale", content: "Outfit: green hunting leathers" },
    { name: "Oren Hask", content: "Looks: a broad smith\nOutfit: a scorched apron" },
  ],
  tracker: [
    { name: "Mira Vale", appearance: null, outfit: "a soaked white wedding dress" },
    { name: "Oren Hask", appearance: null, outfit: "none" },
  ],
};
assert.deepEqual(
  composeComfyLayoutCharacterPrompts(
    [
      { name: "Mira Vale", prompt: "wrings out her hem.", position: { x: 0.3, y: 0.5 } },
      { name: "Oren Hask", prompt: "laughs.", position: { x: 0.7, y: 0.5 } },
    ],
    outfitSources,
  ).map((entry) => entry.prompt),
  [
    "Mira Vale: wrings out her hem. Wearing a soaked white wedding dress. small, freckled.",
    "Oren Hask: laughs. Wearing a scorched apron. a broad smith.",
  ],
  "tracker outfit wins; a tracker 'none' falls back to the lore outfit",
);
assert.deepEqual(
  comfyLayoutLookSourcesFromContext(
    {
      characters: [],
      gameState: { presentCharacters: [{ name: "Old", outfit: "stale" }] },
      memory: {},
    },
    [{ name: "New", outfit: "fresh" }],
  ).tracker,
  [{ name: "New", outfit: "fresh" }],
  "this turn's tracker update beats the context's older state",
);
assert.equal(resolveComfyLayoutLooks("Nobody", lookSources), "");

// The writer's action comes first and the engine's looks last: the Flux regional stack keeps
// only about 128 tokens of a box.
assert.deepEqual(
  composeComfyLayoutCharacterPrompts(
    [
      { name: "Oren", prompt: "kneels by the fire.", position: { x: 0.3, y: 0.5 } },
      { name: "Nobody", prompt: "waves.", position: { x: 0.7, y: 0.5 } },
    ],
    lookSources,
  ).map((entry) => entry.prompt),
  ["Oren: kneels by the fire. lore look for Oren.", "Nobody: waves."],
);

// A referenced character's box carries no looks (the reference shows them); outfit stays.
assert.deepEqual(
  composeComfyLayoutCharacterPrompts(
    [{ name: "Mira Vale", prompt: "wrings out her hem.", position: { x: 0.5, y: 0.5 } }],
    outfitSources,
    undefined,
    ["Mira Vale"],
  ).map((entry) => entry.prompt),
  ["Mira Vale: wrings out her hem. Wearing a soaked white wedding dress."],
);

// Looks are capped so the box text stays inside the region's token budget.
const longLooks = Array.from({ length: 60 }, (_, index) => `w${index}`).join(" ");
const cappedBox = composeComfyLayoutCharacterPrompts([{ name: "Ivo", prompt: "sits.", position: { x: 0.5, y: 0.5 } }], {
  cards: [{ name: "Ivo", appearance: longLooks }],
  lore: [],
  tracker: [],
})[0]!.prompt;
assert.ok(cappedBox.includes("w39") && !cappedBox.includes("w40"), cappedBox);

// An ensemble card ("[Name] traits | [Name] traits") gives each member only their own segment,
// with markdown flattened; the card's own name gets no looks from it.
const ensembleSources = {
  cards: [
    { name: "Shadow Pair", appearance: "[Nyx] **Ink-black** hair,\nviolet eyes | [Jinx] fair skin, purple streak" },
    { name: "Lena", appearance: "## Lena\nemerald eyes" },
  ],
  lore: [],
  tracker: [],
};
assert.equal(resolveComfyLayoutLooks("Nyx", ensembleSources), "Ink-black hair, violet eyes");
assert.equal(resolveComfyLayoutLooks("Jinx", ensembleSources), "fair skin, purple streak");
assert.equal(resolveComfyLayoutLooks("Shadow Pair", ensembleSources), "");
assert.equal(resolveComfyLayoutLooks("Lena", ensembleSources), "Lena emerald eyes");

// Box k is paired with reference slot k: boxes with a reference go first in slot order, references
// for people without a box are dropped, and a location image comes last, only when no box would
// be paired with it.
const boxes = [
  { name: "Petra", prompt: "left", position: { x: 0.2, y: 0.5 } },
  { name: "Avery", prompt: "middle", position: { x: 0.5, y: 0.5 } },
  { name: "Rani", prompt: "right", position: { x: 0.8, y: 0.5 } },
];
const alignedRefs = alignComfyLayoutReferences({
  characterPrompts: boxes,
  referenceImages: ["img-tilly", "img-rani", "img-avery"],
  referenceNames: ["Tilly", "Rani Stanhope", "Avery"],
  locationImage: "img-location",
  maxSlots: 4,
});
assert.deepEqual(
  alignedRefs.characterPrompts.map((entry) => entry.name),
  ["Rani", "Avery", "Petra"],
);
assert.deepEqual(alignedRefs.referenceImages, ["img-rani", "img-avery"], "Petra has no reference, so no location");
const fullyReferenced = alignComfyLayoutReferences({
  characterPrompts: boxes.slice(1),
  referenceImages: ["img-rani", "img-avery"],
  referenceNames: ["Rani", "Avery"],
  locationImage: "img-location",
  maxSlots: 4,
});
assert.deepEqual(fullyReferenced.referenceImages, ["img-rani", "img-avery", "img-location"]);
assert.deepEqual(fullyReferenced.referenceNames, ["Rani", "Avery", "location"]);
// The columns still follow the writer's x after the reorder.
assert.deepEqual(
  parse(buildComfyLayoutReplacements(alignedRefs.characterPrompts)).map((entry) => [entry.desc, entry.bbox[1]]),
  [
    ["right", 650],
    ["middle", 350],
    ["left", 50],
  ],
);

// A companion the action names brings its lore "<Name> looks:" line into its person's box;
// another boxed character named in the action does not.
const companionSources = {
  cards: [],
  lore: [
    { name: "Oren Hask", content: "Looks: a broad smith\nPet: Pip, a ferret.\nPip looks: a sleek white ferret" },
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
    "Oren Hask: holds Pip up to the light and grins at Mira. a broad smith. Pip: a sleek white ferret.",
    "Mira Vale: laughs. a small archer.",
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
assert.match(
  layoutInstruction,
  /Leave "prompt" out; setting, lighting and props replace it\./,
  "the base prompt holds no people",
);
assert.ok(isComfyLayoutCharacterPromptInstruction(layoutInstruction));
assert.ok(
  !isComfyLayoutCharacterPromptInstruction(buildIllustratorCharacterPromptInstruction(6)),
  "NovelAI block is not layout",
);

// The default Illustrator template trades "prompt" and its describe-everyone rule for people-free scene fields.
// Illustrator capability package 1.0.4 defaultPromptTemplate (data/ is a runtime install, not in git).
const defaultIllustratorTemplate = [
  "Create an image-generation prompt only when the latest assistant response contains a visually important moment. Use recent context only for continuity; do not illustrate older scenes.",
  "Generate for: dramatic action, key emotion, major reveal, transformation, important location, or newly described character. If not worth illustrating, set shouldGenerate false and keep prompt empty.",
  'Independently set generateBackground true only when an <illustrator_background_generation enabled="true"> block is present and the latest scene enters a meaningfully different reusable location or setting. Prefer tracker location changes; otherwise infer from recent context. Background generation is independent of shouldGenerate. Keep it false when the block is absent or the location is unchanged.',
  "Return valid JSON only:",
  "{",
  '  "shouldGenerate": boolean,',
  '  "generateBackground": boolean,',
  '  "reason": "why generate or why not",',
  '  "prompt": "detailed prompt if shouldGenerate is true",',
  '  "negativePrompt": "what to avoid",',
  '  "style": "visual style",',
  '  "aspectRatio": "landscape|portrait|square",',
  '  "characters": ["visible character name"]',
  "}",
  "Prompt rules: describe composition, lighting, mood, environment, and every visible character/persona directly. For each visible character/persona, include available body build (chubby, slim, muscular, etc.), clothing/outfit, hair, face, distinguishing features, and other appearance details from context. Do not invent missing traits. Put all visible names in characters. Include no UI, watermark, logo, signature, captions, speech bubbles, subtitles, manga SFX, or meta-instructions.",
].join("\n");
const layoutTemplate = rewriteIllustratorTemplateForComfyLayout(defaultIllustratorTemplate);
assert.ok(layoutTemplate, "default template wording is recognised");
assert.doesNotMatch(layoutTemplate, /"prompt": "detailed prompt/);
assert.doesNotMatch(layoutTemplate, /every visible character\/persona/);
assert.match(
  layoutTemplate,
  /\n {2}"setting": "the place itself[^\n]*\n {2}"lighting": [^\n]*\n {2}"props": [^\n]*No people or animals\.",\n {2}"negativePrompt"/,
);
assert.match(
  layoutTemplate,
  /Prompt rules: setting, lighting and props describe the empty set[^\n]*characterPrompts entry\. Put all visible names/,
);
assert.equal(
  rewriteIllustratorTemplateForComfyLayout('Return JSON: {"prompt": "anything"}'),
  null,
  "custom templates untouched",
);

// The hook: agent templates are rewritten only while the layout block is on the context.
const hookContext = (instruction?: string) =>
  ({
    chatId: "fixture",
    chatMode: "roleplay",
    recentMessages: [],
    mainResponse: null,
    characters: [],
    persona: null,
    gameState: null,
    memory: instruction === undefined ? {} : { _illustratorCharacterPromptInstruction: instruction },
    writableLorebookIds: null,
    chatSummary: null,
  }) satisfies AgentContext;
assert.match(renderAgentPromptTemplate(defaultIllustratorTemplate, {}, hookContext(layoutInstruction)), /"setting": /);
for (const context of [hookContext(), hookContext(buildIllustratorCharacterPromptInstruction(6))]) {
  assert.equal(renderAgentPromptTemplate(defaultIllustratorTemplate, {}, context), defaultIllustratorTemplate);
}

// The manual Illustrate (Gallery) writer gets the same scene fields on a layout workflow and reads them back.
const manualSystem = (instruction?: string) =>
  buildManualIllustratorPromptMessages({
    context: hookContext(),
    selectedPromptTemplate: defaultIllustratorTemplate,
    characterPromptInstruction: instruction,
  })[0]!.content as string;
const manualLayout = manualSystem(layoutInstruction);
assert.doesNotMatch(manualLayout, /"prompt":"detailed provider-ready image prompt"/);
assert.match(manualLayout, /\{"setting":"the place itself[^\n]*"props":"[^"]*","negativePrompt"/);
assert.doesNotMatch(manualLayout, /every visible character\/persona|clothing, physical traits/);
assert.match(manualSystem(), /\{"prompt":"detailed provider-ready image prompt"/, "non-layout manual writer unchanged");
assert.match(manualSystem(buildIllustratorCharacterPromptInstruction(6)), /\{"prompt":"detailed provider-ready/);
assert.equal(
  parseManualIllustratorPromptPlan('{"setting":"a frozen pass","lighting":"moonlight","characters":["A"]}')?.prompt,
  "a frozen pass moonlight",
);

// The box cap replaces the "name everyone" sentences instead of sitting beside them.
assert.equal(readComfyLayoutCharacterLimit(buildIllustratorCharacterPromptInstruction(3, "comfyui_layout")), 3);
assert.equal(readComfyLayoutCharacterLimit(buildIllustratorCharacterPromptInstruction(6)), 0);
const cappedTemplate = renderAgentPromptTemplate(
  defaultIllustratorTemplate,
  {},
  hookContext(buildIllustratorCharacterPromptInstruction(3, "comfyui_layout")),
);
assert.match(cappedTemplate, /"characters": \["up to 3 names"\]/);
assert.match(cappedTemplate, /Put at most 3 names in characters: the ones this moment is about\./);
assert.doesNotMatch(cappedTemplate, /Put all visible names in characters/);
const cappedManual = manualSystem(buildIllustratorCharacterPromptInstruction(3, "comfyui_layout"));
assert.match(cappedManual, /"characters":\["up to 3 names"\]/);
assert.match(cappedManual, /Put at most 3 names in characters/);
assert.doesNotMatch(cappedManual, /Name every character who should be visible/);
assert.match(manualSystem(), /Name every character who should be visible/, "non-layout manual writer unchanged");

// A tracker outfit of "None (...)" is no outfit, not clothing called "None".
const noneOutfit = composeComfyLayoutCharacterPrompts(
  [{ name: "Tora", prompt: "stands at the hearth.", position: { x: 0.5, y: 0.5 } }],
  {
    cards: [{ name: "Tora", appearance: "a tall woman with amethyst horns" }],
    lore: [],
    tracker: [{ name: "Tora", appearance: "", outfit: "None (Dragon form)" }],
  },
);
assert.equal(noneOutfit[0]!.prompt, "Tora: stands at the hearth. a tall woman with amethyst horns.");
const realOutfit = composeComfyLayoutCharacterPrompts(
  [{ name: "Tora", prompt: "stands.", position: { x: 0.5, y: 0.5 } }],
  { cards: [], lore: [], tracker: [{ name: "Tora", appearance: "", outfit: "Nonesuch-silk robes" }] },
);
assert.match(realOutfit[0]!.prompt, /Wearing Nonesuch-silk robes\./, "only a bare none word empties the outfit");

// Readers keep one scene prompt: the fields fold into "prompt" only when the writer left it empty.
assert.deepEqual(
  foldComfyLayoutSceneFields({ shouldGenerate: true, setting: " a stone quay ", lighting: "dusk", props: "" }),
  {
    shouldGenerate: true,
    setting: " a stone quay ",
    lighting: "dusk",
    props: "",
    prompt: "a stone quay dusk",
  },
);
assert.deepEqual(
  foldComfyLayoutSceneFields({ prompt: "a woman on the quay", setting: "a stone quay" }),
  { prompt: "a stone quay", setting: "a stone quay" },
  "scene fields win over a stray prompt",
);
assert.deepEqual(foldComfyLayoutSceneFields({ prompt: "kept" }), { prompt: "kept" });
assert.deepEqual(foldComfyLayoutSceneFields({ shouldGenerate: false, prompt: "" }), {
  shouldGenerate: false,
  prompt: "",
});
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
