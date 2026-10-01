// custom-mods: helpers behind the "Illustrator 2" custom image agent (see CUSTOM_MODS.md).
//
// - Workflow-declared variables: a ComfyUI workflow may carry a top-level "marinara_variables"
//   object. The image agent may set those variables (validated, defaulted) and the workflow
//   reads them as %var_<name>% placeholders.
// - Reference tokens: the agent writes [[Name]] and the handler rewrites it to "image N" once the
//   real reference slot order is known (location first, skipped avatars, de-duplication, slot cap).
// - Present-character gating: keep the agent and its references to characters the tracker says are
//   present in the scene.
import type { AgentContext } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";
import { COMFYUI_MAX_REFERENCE_IMAGES } from "./comfyui-reference-placeholders.js";

export const WORKFLOW_VARIABLES_KEY = "marinara_variables";
const MAX_VARIABLES = 16;
const MAX_STRING_VALUE_LENGTH = 200;
const VARIABLE_NAME_PATTERN = /^[a-z0-9_]{1,32}$/;

type VariableValue = string | number | boolean;

export interface WorkflowVariableDeclaration {
  type: "string" | "number" | "boolean" | "enum";
  values?: string[];
  min?: number;
  max?: number;
  default: VariableValue;
  description?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A name matches when the full names agree or one side is a whole-word part of the other ("Ann" ~ "Ann Lee"). */
function namesMatch(a: string, b: string): boolean {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return ` ${left} `.includes(` ${right} `) || ` ${right} `.includes(` ${left} `);
}

function coerceValue(declaration: WorkflowVariableDeclaration, value: unknown): VariableValue | undefined {
  switch (declaration.type) {
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "false") return value === "true";
      return undefined;
    case "number": {
      const number = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
      if (!Number.isFinite(number)) return undefined;
      const min = declaration.min ?? -Infinity;
      const max = declaration.max ?? Infinity;
      return Math.min(max, Math.max(min, number));
    }
    case "enum":
      return typeof value === "string" && declaration.values?.includes(value.trim()) ? value.trim() : undefined;
    case "string":
      return typeof value === "string"
        ? value.replace(/\s+/g, " ").trim().slice(0, MAX_STRING_VALUE_LENGTH)
        : undefined;
  }
}

function parseDeclaration(raw: unknown): WorkflowVariableDeclaration | null {
  if (!isRecord(raw)) return null;
  const type = raw.type;
  if (type !== "string" && type !== "number" && type !== "boolean" && type !== "enum") return null;
  const values = Array.isArray(raw.values)
    ? raw.values.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : undefined;
  if (type === "enum" && (!values || values.length === 0)) return null;
  const declaration: WorkflowVariableDeclaration = {
    type,
    ...(values ? { values } : {}),
    ...(typeof raw.min === "number" ? { min: raw.min } : {}),
    ...(typeof raw.max === "number" ? { max: raw.max } : {}),
    ...(typeof raw.description === "string" ? { description: raw.description.trim() } : {}),
    default: "",
  };
  const fallback =
    type === "boolean" ? false : type === "number" ? (declaration.min ?? 0) : type === "enum" ? values![0]! : "";
  declaration.default = coerceValue(declaration, raw.default) ?? fallback;
  return declaration;
}

/** Read the optional "marinara_variables" declarations from a workflow (JSON text or parsed object). */
export function readWorkflowVariableDeclarations(workflow: unknown): Record<string, WorkflowVariableDeclaration> {
  let parsed = workflow;
  if (typeof workflow === "string") {
    if (!workflow.includes(WORKFLOW_VARIABLES_KEY)) return {};
    try {
      parsed = JSON.parse(workflow);
    } catch {
      return {};
    }
  }
  if (!isRecord(parsed) || !isRecord(parsed[WORKFLOW_VARIABLES_KEY])) return {};
  const declarations: Record<string, WorkflowVariableDeclaration> = {};
  for (const [name, raw] of Object.entries(parsed[WORKFLOW_VARIABLES_KEY]).slice(0, MAX_VARIABLES)) {
    if (!VARIABLE_NAME_PATTERN.test(name)) continue;
    const declaration = parseDeclaration(raw);
    if (declaration) declarations[name] = declaration;
  }
  return declarations;
}

/** ComfyUI rejects non-node entries, so the declarations never leave Marinara. */
export function stripWorkflowVariableDeclarations(workflow: Record<string, unknown>): Record<string, unknown> {
  if (!(WORKFLOW_VARIABLES_KEY in workflow)) return workflow;
  const { [WORKFLOW_VARIABLES_KEY]: _declarations, ...nodes } = workflow;
  return nodes;
}

/**
 * Build %var_<name>% replacements for every declared variable. Agent values are validated against
 * the declaration (undeclared keys dropped, numbers clamped, unknown enum values rejected) and every
 * declared variable gets its default otherwise, so no literal %var_x% ever reaches ComfyUI.
 */
export function resolveWorkflowVariableReplacements(
  declarations: Record<string, WorkflowVariableDeclaration>,
  agentValues: unknown,
): Record<string, VariableValue> {
  const values = isRecord(agentValues) ? agentValues : {};
  const replacements: Record<string, VariableValue> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    replacements[`%var_${name}%`] = coerceValue(declaration, values[name]) ?? declaration.default;
  }
  return replacements;
}

/** Compact instruction block telling the image agent which variables it may set. */
export function renderWorkflowVariableInstructions(declarations: Record<string, WorkflowVariableDeclaration>): string {
  const lines = Object.entries(declarations).map(([name, declaration]) => {
    const range =
      declaration.type === "enum"
        ? `one of: ${declaration.values!.join(" | ")}`
        : declaration.type === "number"
          ? `number${declaration.min !== undefined || declaration.max !== undefined ? ` ${declaration.min ?? ""}..${declaration.max ?? ""}` : ""}`
          : declaration.type;
    const description = declaration.description ? ` — ${declaration.description}` : "";
    return `- ${name} (${range}; default ${JSON.stringify(declaration.default)})${description}`;
  });
  if (lines.length === 0) return "";
  return [
    'Image workflow variables: you may add a "comfyVariables" object to your JSON with any of these keys. Omit a key to use its default.',
    ...lines,
  ].join("\n");
}

/**
 * Pair reference images with their owners the way the image backend will see them: location first,
 * identical images collapsed (ComfyUI de-duplicates), capped at the backend's slot count.
 */
export function buildReferenceSlots(args: {
  locationImage: string | null;
  referenceImages: string[];
  referenceNames: string[];
  maxSlots: number;
}): { images: string[]; names: string[]; dropped: string[] } {
  const pairs = [
    ...(args.locationImage ? [{ image: args.locationImage, name: "location" }] : []),
    ...args.referenceImages.map((image, index) => ({ image, name: args.referenceNames[index] ?? "" })),
  ];
  const images: string[] = [];
  const names: string[] = [];
  const dropped: string[] = [];
  for (const pair of pairs) {
    if (images.includes(pair.image)) continue;
    if (images.length >= args.maxSlots) {
      dropped.push(pair.name);
      continue;
    }
    images.push(pair.image);
    names.push(pair.name);
  }
  return { images, names, dropped };
}

export function maxReferenceSlotsForSource(source: string): number {
  return /comfy/i.test(source) ? COMFYUI_MAX_REFERENCE_IMAGES : 6;
}

/** Rewrite [[Name]] tokens to "image N" using the final slot owners; unslotted names stay plain names. */
export function bindReferenceTokens(prompt: string, slotNames: string[]): string {
  return prompt.replace(/\[\[([^\]\n]{1,80})\]\]/g, (_token, rawName: string) => {
    const name = rawName.trim();
    const slot = slotNames.findIndex((slotName) => slotName && namesMatch(slotName, name));
    return slot >= 0 ? `image ${slot + 1}` : name;
  });
}

/** Slot the references like the backend will, warn about truncation, and bind [[Name]] tokens. */
export function bindIllustratorReferenceTokens(
  prompt: string,
  args: { locationImage: string | null; referenceImages: string[]; referenceNames: string[]; source: string },
): string {
  const slots = buildReferenceSlots({ ...args, maxSlots: maxReferenceSlotsForSource(args.source) });
  if (slots.dropped.length > 0) {
    logger.warn("[illustrator] Reference slots full; not sent: %s", slots.dropped.join(", "));
  }
  return bindReferenceTokens(prompt, slots.names);
}

export function readAgentComfyVariables(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function presentNames(presentCharacters: unknown): string[] {
  if (!Array.isArray(presentCharacters)) return [];
  return presentCharacters
    .map((entry) => (isRecord(entry) && typeof entry.name === "string" ? entry.name.trim() : ""))
    .filter(Boolean);
}

/**
 * Keep only names the tracker lists as present (the persona always passes). With no tracker data
 * nothing is filtered, so the agent degrades to normal behaviour when no tracker runs.
 */
export function filterToPresentCharacters(
  names: string[],
  presentCharacters: unknown,
  personaName?: string | null,
): { kept: string[]; dropped: string[] } {
  const present = presentNames(presentCharacters);
  if (present.length === 0) return { kept: names, dropped: [] };
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const name of names) {
    const allowed =
      (personaName && namesMatch(personaName, name)) || present.some((presentName) => namesMatch(presentName, name));
    (allowed ? kept : dropped).push(name);
  }
  return { kept, dropped };
}

/**
 * Prompt-time half of present-character gating plus the variables instruction block. Used by the
 * image-agent context hooks in generate.routes.ts and retry-agents-route.ts.
 */
export function applyImageAgentContextExtensions(
  context: AgentContext,
  agentSettings: Record<string, unknown> | undefined,
  comfyWorkflow: string | null | undefined,
): AgentContext {
  let next = context;
  const variableInstructions = renderWorkflowVariableInstructions(readWorkflowVariableDeclarations(comfyWorkflow));
  if (variableInstructions) {
    const existing =
      typeof next.memory._imagePromptInstructions === "string" ? next.memory._imagePromptInstructions : "";
    next = {
      ...next,
      memory: {
        ...next.memory,
        _imagePromptInstructions: [existing, variableInstructions].filter(Boolean).join("\n\n"),
      },
    };
  }
  if (agentSettings?.presentCharactersOnly === true) {
    const present = presentNames(next.gameState?.presentCharacters);
    if (present.length > 0) {
      const response = normalizeName(next.mainResponse ?? "");
      const characters = next.characters.filter(
        (character) =>
          present.some((name) => namesMatch(name, character.name)) ||
          (response && ` ${response} `.includes(` ${normalizeName(character.name)} `)),
      );
      next = { ...next, characters };
    }
  }
  return next;
}
