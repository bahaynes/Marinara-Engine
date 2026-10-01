// custom-mods: guards the Illustrator 2 engine hooks.
//
// Local edit models (Flux.2 Klein, Qwen-Image-Edit) need the prompt to name reference slots ("image 2")
// and the workflow to know which slots hold real images. The slot order is only known after reference
// resolution (location first, avatar-less characters skipped, duplicates collapsed, 4-slot cap), so the
// agent writes [[Name]] and the handler binds it. Workflow variables must always resolve to a valid
// value or ComfyUI rejects the graph, and present-character gating must not filter without tracker data.
import assert from "node:assert/strict";
import {
  buildComfyReferenceSlotReplacements,
  COMFYUI_MAX_REFERENCE_IMAGES,
} from "../../packages/server/src/services/image/comfyui-reference-placeholders.js";
import {
  applyImageAgentContextExtensions,
  bindReferenceTokens,
  buildReferenceSlots,
  filterToPresentCharacters,
  maxReferenceSlotsForSource,
  readWorkflowVariableDeclarations,
  renderWorkflowVariableInstructions,
  resolveWorkflowVariableReplacements,
  stripWorkflowVariableDeclarations,
} from "../../packages/server/src/services/image/image-agent-comfy-extensions.js";
import { replaceComfyUiPlaceholders } from "../../packages/server/src/services/image/image-generation.js";
import type { AgentContext } from "@marinara-engine/shared";

// ── Slot flags: exact-match placeholders become JSON booleans/numbers, not strings ──
const slotReplacements = buildComfyReferenceSlotReplacements(2);
assert.equal(COMFYUI_MAX_REFERENCE_IMAGES, 4);
const flagged = replaceComfyUiPlaceholders(
  {
    "210": { inputs: { enabled: "%reference_enabled_01%" } },
    "211": { inputs: { enabled: "%reference_enabled_02%" } },
    "212": { inputs: { enabled: "%reference_enabled_03%" } },
    "213": {
      inputs: { enabled: "%reference_enabled_04%", count: "%reference_count%", label: "refs=%reference_count%" },
    },
  },
  slotReplacements,
) as Record<string, { inputs: Record<string, unknown> }>;
assert.equal(flagged["210"]!.inputs.enabled, true);
assert.equal(flagged["211"]!.inputs.enabled, true);
assert.equal(flagged["212"]!.inputs.enabled, false, "placeholder-backed slot is disabled as a JSON boolean");
assert.equal(flagged["213"]!.inputs.enabled, false);
assert.equal(flagged["213"]!.inputs.count, 2);
assert.equal(flagged["213"]!.inputs.label, "refs=2", "substring substitution still stringifies");
assert.equal(buildComfyReferenceSlotReplacements(0)["%reference_enabled_01%"], false);

// ── Workflow-declared variables ──
const workflowText = JSON.stringify({
  marinara_variables: {
    shot: { type: "enum", values: ["close-up", "medium", "wide"], default: "medium", description: "camera framing" },
    lora_weight: { type: "number", min: 0, max: 1.2, default: 0.8 },
    mood: { type: "string", default: "" },
    sharpen: { type: "boolean", default: true },
    "Bad-Name": { type: "string", default: "x" },
    broken_enum: { type: "enum", values: [], default: "a" },
  },
  "1": { class_type: "PrimitiveStringMultiline", inputs: { value: "%prompt%, %var_shot% shot" } },
});
const declarations = readWorkflowVariableDeclarations(workflowText);
assert.deepEqual(Object.keys(declarations), ["shot", "lora_weight", "mood", "sharpen"], "invalid declarations skipped");
assert.deepEqual(readWorkflowVariableDeclarations('{"1":{"class_type":"SaveImage"}}'), {});
assert.deepEqual(readWorkflowVariableDeclarations("not json marinara_variables"), {});

const defaults = resolveWorkflowVariableReplacements(declarations, undefined);
assert.deepEqual(defaults, {
  "%var_shot%": "medium",
  "%var_lora_weight%": 0.8,
  "%var_mood%": "",
  "%var_sharpen%": true,
});
const agentChosen = resolveWorkflowVariableReplacements(declarations, {
  shot: "extreme close-up", // not in enum → default
  lora_weight: "5", // clamped to max
  mood: "  tense\n quiet ",
  sharpen: "false",
  injected: "%prompt%", // undeclared → dropped
});
assert.equal(agentChosen["%var_shot%"], "medium");
assert.equal(agentChosen["%var_lora_weight%"], 1.2);
assert.equal(agentChosen["%var_mood%"], "tense quiet");
assert.equal(agentChosen["%var_sharpen%"], false);
assert.equal("%var_injected%" in agentChosen, false);

const stripped = stripWorkflowVariableDeclarations(JSON.parse(workflowText) as Record<string, unknown>);
assert.equal("marinara_variables" in stripped, false, "declarations never reach ComfyUI");
assert.ok("1" in stripped);
assert.match(
  renderWorkflowVariableInstructions(declarations),
  /shot \(one of: close-up \| medium \| wide; default "medium"\) — camera framing/,
);
assert.equal(renderWorkflowVariableInstructions({}), "");

// ── Reference slots and [[Name]] binding ──
// Location takes slot 1; Bea has no avatar (absent from referenceImages); Cy shares Ann's image.
const slots = buildReferenceSlots({
  locationImage: "LOC",
  referenceImages: ["ANN", "ANN", "DEX", "EVE", "FAY"],
  referenceNames: ["Ann Lee", "Cy", "Dex", "Eve", "Fay"],
  maxSlots: maxReferenceSlotsForSource("comfyui"),
});
assert.deepEqual(slots.names, ["location", "Ann Lee", "Dex", "Eve"]);
assert.deepEqual(slots.dropped, ["Fay"]);
assert.equal(maxReferenceSlotsForSource("openai"), 6);
assert.equal(
  bindReferenceTokens("[[Ann]] hands [[Dex]] a map while [[Bea]] watches in [[location]]; [[Fay]] waves.", slots.names),
  "image 2 hands image 3 a map while Bea watches in image 1; Fay waves.",
);
assert.equal(bindReferenceTokens("No tokens here.", slots.names), "No tokens here.");

// ── Present-character gating ──
const present = [{ name: "Ann" }, { name: "Dex Moreau" }];
assert.deepEqual(filterToPresentCharacters(["Ann Lee", "Dex", "Bea", "Robin"], present, "Robin"), {
  kept: ["Ann Lee", "Dex", "Robin"],
  dropped: ["Bea"],
});
assert.deepEqual(filterToPresentCharacters(["Ann", "Bea"], [], null), { kept: ["Ann", "Bea"], dropped: [] });
assert.deepEqual(filterToPresentCharacters(["Ann", "Bea"], undefined, null), { kept: ["Ann", "Bea"], dropped: [] });

const baseContext = {
  memory: { _imagePromptInstructions: "Connection rule." },
  gameState: { presentCharacters: present },
  mainResponse: "Gus bursts through the door.",
  characters: [
    { id: "a", name: "Ann Lee", description: "" },
    { id: "b", name: "Bea", description: "" },
    { id: "d", name: "Dex Moreau", description: "" },
    { id: "g", name: "Gus", description: "" },
  ],
} as unknown as AgentContext;
const trimmed = applyImageAgentContextExtensions(baseContext, { presentCharactersOnly: true }, workflowText);
assert.deepEqual(
  trimmed.characters.map((character) => character.name),
  ["Ann Lee", "Dex Moreau", "Gus"],
  "absent cards trimmed; newcomers named in the response kept",
);
assert.match(String(trimmed.memory._imagePromptInstructions), /^Connection rule\.\n\nImage workflow variables:/);
const untouched = applyImageAgentContextExtensions(baseContext, {}, null);
assert.equal(untouched, baseContext, "stock agents and plain workflows are unchanged");
const noTracker = applyImageAgentContextExtensions(
  { ...baseContext, gameState: null } as AgentContext,
  { presentCharactersOnly: true },
  null,
);
assert.equal(noTracker.characters.length, 4, "no tracker data → no filtering");

console.log("image-agent-comfy-extensions regression passed");
