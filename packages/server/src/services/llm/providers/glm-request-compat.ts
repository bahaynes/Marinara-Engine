type GlmThinkingOptions = {
  model: string;
  baseUrl: string;
  providerKind: string;
  enableThinking?: boolean;
  reasoningEffort?: string | null;
};

export function isGlmModel(model: string): boolean {
  return model.toLowerCase().includes("glm");
}

export function isGlm5Model(model: string): boolean {
  return /(?:^|\/)glm-5(?:\.\d+)?(?:$|[-:])/u.test(model.toLowerCase());
}

export function isGlm53Model(model: string): boolean {
  return /(?:^|\/)glm-5\.3(?:$|[-:])/u.test(model.toLowerCase());
}

export const isGlm52Model = isGlm5Model;

export function isNativeGlmEndpoint(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return (
      hostname === "api.z.ai" ||
      hostname.endsWith(".api.z.ai") ||
      hostname === "open.bigmodel.cn" ||
      hostname.endsWith(".open.bigmodel.cn")
    );
  } catch {
    return false;
  }
}

function hasActiveReasoningEffort(reasoningEffort?: string | null): boolean {
  return !!reasoningEffort && reasoningEffort !== "none";
}

function glm5ReasoningEffort(reasoningEffort?: string | null): "low" | "high" | "max" | null {
  if (!hasActiveReasoningEffort(reasoningEffort)) return null;
  if (reasoningEffort === "low") return "low";
  if (reasoningEffort === "max" || reasoningEffort === "xhigh" || reasoningEffort === "maximum") return "max";
  return "high";
}

function glm53ReasoningEffort(reasoningEffort?: string | null): "low" | "high" | "max" {
  if (reasoningEffort === "none" || reasoningEffort === "low" || !reasoningEffort) return "low";
  if (reasoningEffort === "max" || reasoningEffort === "xhigh" || reasoningEffort === "maximum") return "max";
  return "high";
}

export function applyGlmThinkingParameters(body: Record<string, unknown>, options: GlmThinkingOptions): boolean {
  if (!isGlmModel(options.model)) return false;
  const nativeEndpoint = isNativeGlmEndpoint(options.baseUrl);
  if (!nativeEndpoint && options.providerKind !== "nanogpt") return false;
  const thinkingEnabled = options.enableThinking === true || hasActiveReasoningEffort(options.reasoningEffort);

  if (isGlm53Model(options.model)) {
    const effort = glm53ReasoningEffort(options.reasoningEffort);
    if (nativeEndpoint) {
      body.thinking = { type: "enabled" };
      body.reasoning_effort = effort;
      return true;
    }
    if (options.providerKind === "nanogpt") {
      body.enable_thinking = true;
      body.reasoning_effort = effort;
      return true;
    }
  }

  if (nativeEndpoint && isGlm5Model(options.model)) {
    body.thinking = { type: thinkingEnabled ? "enabled" : "disabled" };
    const effort = glm5ReasoningEffort(options.reasoningEffort);
    if (thinkingEnabled && effort) body.reasoning_effort = effort;
    return true;
  }

  body.enable_thinking = thinkingEnabled;
  return true;
}

