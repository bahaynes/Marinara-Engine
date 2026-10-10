// Fork regression (custom-mods): a speculative prefill is only useful when it sends the
// same requests, up to the final turn, that the real post-processing run sends later.
import assert from "node:assert/strict";
import type { AgentContext } from "../../packages/shared/src/types/agent.js";
import {
  executeAgentBatch,
  prefillAgentBatch,
  type AgentExecConfig,
} from "../../packages/server/src/services/agents/agent-executor.js";
import {
  createAgentPipeline,
  isAgentEligibleForPrefill,
  type ResolvedAgent,
} from "../../packages/server/src/services/agents/agent-pipeline.js";
import { registerCapabilityService } from "../../packages/server/src/services/capability-packages/capability-service-registry.service.js";
import {
  BaseLLMProvider,
  type ChatCompletionResult,
  type ChatMessage,
  type ChatOptions,
} from "../../packages/server/src/services/llm/base-provider.js";

class RecordingProvider extends BaseLLMProvider {
  calls: Array<{ messages: ChatMessage[]; options: ChatOptions }> = [];
  constructor() {
    super("http://localhost", "", 32768);
  }
  async *chat(): AsyncGenerator<string, void, unknown> {}
  override async chatComplete(messages: ChatMessage[], options: ChatOptions): Promise<ChatCompletionResult> {
    this.calls.push({ messages, options });
    return { content: "{}", toolCalls: [], finishReason: "stop", usage: undefined };
  }
}

const agent = (type: string, customParameters?: Record<string, unknown>): AgentExecConfig => ({
  id: `${type}-id`,
  type,
  name: type,
  phase: "post_processing",
  promptTemplate: `Track ${type} as JSON.`,
  connectionId: null,
  settings: { maxTokens: 512, contextSize: 5 },
  isCustomAgent: false,
  customParameters,
});
const configs = [
  agent("world-state"),
  agent("custom-tracker"),
  // A different request signature: the real run sends this agent in its own request.
  agent("quest", { response_format: { type: "json_object" } }),
];
const context = (): AgentContext => ({
  chatId: "prefill-fixture",
  chatMode: "roleplay",
  recentMessages: [
    { role: "user", content: "We head for the old mill." },
    { role: "assistant", content: "The mill wheel creaks in the dark." },
    { role: "user", content: "I light a lantern." },
  ],
  characters: [],
  persona: null,
  memory: {},
  writableLorebookIds: null,
  chatSummary: null,
  streaming: true,
});

const prefill = new RecordingProvider();
await prefillAgentBatch(configs, context(), prefill, "local-model");
const real = new RecordingProvider();
await executeAgentBatch(configs, { ...context(), mainResponse: "Light spills across the floor." }, real, "local-model");

const requestKey = ({ messages, options }: { messages: ChatMessage[]; options: ChatOptions }) =>
  JSON.stringify({
    head: messages.slice(0, -1),
    customParameters: { ...options.customParameters, prefill: undefined },
    responseFormat: options.responseFormat,
    reasoningEffort: options.reasoningEffort,
    enableThinking: options.enableThinking,
    tools: options.tools,
  });
const realKeys = new Set(real.calls.map(requestKey));

assert.equal(prefill.calls.length, 2, "the quest agent's request options split it into its own prefill");
for (const call of prefill.calls) {
  assert.equal(call.options.maxTokens, 1);
  assert.equal(call.options.stream, false);
  assert.equal(call.options.customParameters?.prefill, true);
  assert.ok(realKeys.has(requestKey(call)), "each prefill matches a real request up to the final turn");
}

const resolved = (overrides: Partial<ResolvedAgent>) => ({ ...configs[0]!, ...overrides }) as ResolvedAgent;
assert.equal(isAgentEligibleForPrefill(resolved({ localEndpoint: true })), true);
assert.equal(
  isAgentEligibleForPrefill(resolved({ model: "google/gemma-3-27b-it" })),
  false,
  "a hosted model is never prefilled, whatever its name",
);
assert.equal(isAgentEligibleForPrefill(resolved({ localEndpoint: true, phase: "parallel" })), false);

// The real post-processing run carries capability runtime context (a package's prepareContext) in its
// system prompt, so the pipeline's prefill must too, or its prompt diverges at that block.
const releaseRuntime = registerCapabilityService("agent-runtime:world-state", {
  prepareContext: () => ({ roster: [["n1", "Lena"]] }),
});
const pipelineProvider = new RecordingProvider();
createAgentPipeline(
  [resolved({ provider: pipelineProvider, model: "local-model", localEndpoint: true })],
  context(),
).prefillPostAgents();
for (let i = 0; i < 50 && pipelineProvider.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
releaseRuntime();
assert.equal(pipelineProvider.calls.length, 1);
assert.match(
  String(pipelineProvider.calls[0]!.messages[0]!.content),
  /<agent_runtime_context agent="world-state">[^<]*Lena/u,
  "the prefill carries the capability runtime context the real call sends",
);

console.log("agent-prefill regression passed");
