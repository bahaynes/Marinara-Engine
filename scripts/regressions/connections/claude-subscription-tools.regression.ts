/**
 * Claude (Subscription) native tool calls (custom-mods).
 *
 * The turn's tools ride an in-process "marinara" MCP server whose handlers run nothing. The SDK stops at
 * maxTurns after a tool call (error_max_turns, then a throw if iteration went on); the provider returns the
 * calls for Marinara's tool loop. The next round resumes with the real result in the synthetic session.
 * The isolation guard still stops any other MCP server, and a request without tools registers none.
 */
import assert from "node:assert/strict";
import {
  __setSdkForTesting,
  ClaudeSubscriptionProvider,
} from "../../../packages/server/src/services/llm/providers/claude-subscription.provider.js";
import type { LLMToolDefinition } from "../../../packages/shared/src/index.js";

const rollDice: LLMToolDefinition = {
  type: "function",
  function: {
    name: "roll_dice",
    description: "Roll dice",
    parameters: { type: "object", properties: { notation: { type: "string" } }, required: ["notation"] },
  },
};
const marinaraInit = {
  type: "system",
  subtype: "init",
  tools: ["mcp__marinara__roll_dice"],
  mcp_servers: [{ name: "marinara", status: "connected", source: "sdk" }],
  skills: [],
  plugins: [],
  slash_commands: [],
};
const usage = { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 };

let options: Record<string, unknown> = {};
let prompt: unknown;
let script: (opts: Record<string, unknown>) => AsyncGenerator<unknown> = async function* () {};
const tools: Array<{ name: string; shape: Record<string, unknown> }> = [];
__setSdkForTesting({
  query: ((args: { prompt: unknown; options: Record<string, unknown> }) => {
    options = args.options;
    prompt = args.prompt;
    return script(args.options);
  }) as never,
  createSdkMcpServer: (o: { name: string; tools: unknown[] }) => ({ type: "sdk", name: o.name, tools: o.tools }),
  tool: (name: string, _d: string, shape: Record<string, unknown>) => {
    tools.push({ name, shape });
    return { name };
  },
} as never);

const provider = new ClaudeSubscriptionProvider("", "");

// 1. A tool call ends the reply: calls come back, the max-turns error and the throw after it do not.
script = async function* () {
  yield marinaraInit;
  yield {
    type: "assistant",
    message: {
      stop_reason: null,
      content: [
        { type: "text", text: "Rolling." },
        { type: "tool_use", id: "toolu_1", name: "mcp__marinara__roll_dice", input: { notation: "1d20" } },
      ],
    },
  };
  yield { type: "result", subtype: "error_max_turns", is_error: true, usage, errors: [] };
  throw new Error("Claude Code returned an error result: Reached maximum number of turns (1)");
};
const first = await provider.chatComplete([{ role: "user", content: "Roll" }], {
  model: "claude-opus-5",
  stream: false,
  tools: [rollDice],
});
assert.equal(first.finishReason, "tool_calls");
assert.deepEqual(first.toolCalls, [
  { id: "toolu_1", type: "function", function: { name: "roll_dice", arguments: '{"notation":"1d20"}' } },
]);
assert.equal(first.content, "Rolling.");
assert.ok((options.mcpServers as Record<string, unknown>).marinara, "the turn's tools ride the marinara server");
assert.deepEqual(options.tools, [], "built-in Claude Code tools stay off");
assert.equal(tools[0]?.name, "roll_dice");
assert.equal(
  typeof (tools[0]?.shape.notation as { parse?: unknown })?.parse,
  "function",
  "the JSON schema reaches the SDK as a zod shape",
);

// 2. The next round resumes with the call and its real result inside the synthetic session, and a short
// continue turn as the prompt: a trailing tool result sent as the prompt reads to Claude Code as an
// interrupted call, and the model calls again.
let resumed: Array<{ message?: { content?: Array<{ type: string }> } }> = [];
script = async function* (opts) {
  const store = opts.sessionStore as { load(key: { sessionId: string }): Promise<typeof resumed | null> };
  resumed = (await store.load({ sessionId: String(opts.resume) })) ?? [];
  yield marinaraInit;
  yield { type: "result", subtype: "success", result: "You rolled a 14.", usage };
};
const second = await provider.chatComplete(
  [
    { role: "user", content: "Roll" },
    { role: "assistant", content: "Rolling.", tool_calls: first.toolCalls },
    { role: "tool", tool_call_id: "toolu_1", content: '{"total":14}' },
  ],
  { model: "claude-opus-5", stream: false, tools: [rollDice] },
);
assert.equal(second.content, "You rolled a 14.");
assert.equal(second.finishReason, "stop");
assert.deepEqual(second.toolCalls, []);
const blocks = resumed.flatMap((entry) => entry.message?.content ?? []).map((block) => block.type);
assert.ok(blocks.includes("tool_use"), "the resumed session holds the call");
assert.ok(blocks.includes("tool_result"), "the resumed session holds the result");
const sent: Array<{ message: { content: unknown } }> = [];
for await (const message of prompt as AsyncIterable<{ message: { content: unknown } }>) sent.push(message);
assert.match(String(sent[0]?.message.content), /Continue your reply/);

// 3. Any other MCP server still stops the request, tools or not.
script = async function* () {
  yield {
    ...marinaraInit,
    mcp_servers: [...marinaraInit.mcp_servers, { name: "claude.ai Gmail", status: "connected" }],
  };
  yield { type: "result", subtype: "success", result: "leaked", usage };
};
await assert.rejects(
  provider.chatComplete([{ role: "user", content: "Roll" }], {
    model: "claude-opus-5",
    stream: false,
    tools: [rollDice],
  }),
  /connectors/,
);

// 4. Without tools nothing is registered, and a marinara server appearing anyway is refused.
script = async function* () {
  yield marinaraInit;
  yield { type: "result", subtype: "success", result: "Plain reply", usage };
};
await assert.rejects(
  provider.chatComplete([{ role: "user", content: "Hi" }], { model: "claude-opus-5", stream: false }),
  /connectors/,
);
assert.equal(options.mcpServers, undefined);

// 5. A bare chat() given tools registers the same server, so a follow-up sent through it (the ruleset
// dice rewrite) opens like the draft and reads its cache. A tool call there is dropped, not thrown.
script = async function* () {
  yield marinaraInit;
  yield {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "toolu_2", name: "mcp__marinara__roll_dice", input: {} }] },
  };
  yield { type: "result", subtype: "error_max_turns", is_error: true, usage, errors: [] };
  throw new Error("Claude Code returned an error result: Reached maximum number of turns (1)");
};
let streamed = "";
for await (const chunk of provider.chat([{ role: "user", content: "Rewrite" }], {
  model: "claude-opus-5",
  stream: false,
  tools: [rollDice],
}))
  streamed += chunk;
assert.equal(streamed, "");
assert.ok((options.mcpServers as Record<string, unknown>).marinara, "a bare chat() with tools registers them");

__setSdkForTesting(null);
console.log("claude-subscription tools regression passed");
