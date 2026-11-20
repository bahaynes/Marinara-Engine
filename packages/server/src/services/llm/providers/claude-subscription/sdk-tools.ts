// Native tool calls for the Claude (Subscription) provider (custom-mods).
//
// The turn's tools ride an in-process MCP server named "marinara". Its handlers run nothing: with
// `maxTurns: 1` the SDK makes one model request, hands any tool call to the do-nothing handler, and
// stops. The provider returns the calls and Marinara's own tool loop runs them, so results, dice and
// round limits work as for every other provider. The placeholder result lives only in the SDK's
// throwaway session; the next request rebuilds history from Marinara's messages.
import { fromJSONSchema, z, type ZodRawShape } from "zod";
import type { ChatMessage, LLMToolCall, LLMToolDefinition } from "@marinara-engine/shared";
import { logger } from "../../../../lib/logger.js";

export const MARINARA_TOOL_SERVER = "marinara";
const TOOL_PREFIX = `mcp__${MARINARA_TOOL_SERVER}__`;

interface ToolServerSdk {
  createSdkMcpServer(options: { name: string; version?: string; tools?: unknown[] }): unknown;
  tool(
    name: string,
    description: string,
    shape: ZodRawShape,
    handler: () => Promise<{ content: Array<{ type: "text"; text: string }> }>,
  ): unknown;
}

function toShape(tool: LLMToolDefinition): ZodRawShape {
  try {
    const schema = fromJSONSchema(tool.function.parameters as Parameters<typeof fromJSONSchema>[0]);
    if (schema instanceof z.ZodObject) return schema.shape;
  } catch (err) {
    logger.warn(
      err,
      "[claude-subscription] tool %s has a schema zod cannot read; sent without parameters",
      tool.function.name,
    );
  }
  return {};
}

export function buildMarinaraToolServer(sdk: ToolServerSdk, tools: LLMToolDefinition[]): unknown {
  return sdk.createSdkMcpServer({
    name: MARINARA_TOOL_SERVER,
    version: "1.0.0",
    tools: tools.map((tool) =>
      sdk.tool(tool.function.name, tool.function.description, toShape(tool), async () => ({
        content: [{ type: "text", text: "Marinara runs this tool after the reply." }],
      })),
    ),
  });
}

/** The calls an SDK assistant message asked our server for, as Marinara tool calls. */
export function marinaraToolCalls(content: unknown): LLMToolCall[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((block: { type?: string; id?: string; name?: string; input?: unknown }) =>
    block?.type === "tool_use" && typeof block.name === "string" && block.name.startsWith(TOOL_PREFIX)
      ? [
          {
            id: block.id ?? "",
            type: "function" as const,
            function: { name: block.name.slice(TOOL_PREFIX.length), arguments: JSON.stringify(block.input ?? {}) },
          },
        ]
      : [],
  );
}

/** True when the init surface lists nothing beyond the "marinara" server this request registered. */
export function onlyMarinaraTools(
  init: { mcp_servers: Array<{ name: string; source?: string }>; tools: string[] },
  registered: boolean,
): boolean {
  if (!registered) return false;
  return (
    init.mcp_servers.every((server) => server.name === MARINARA_TOOL_SERVER && server.source === "sdk") &&
    init.tools.filter((tool) => tool.startsWith("mcp__")).every((tool) => tool.startsWith(TOOL_PREFIX))
  );
}

const CONTINUE_AFTER_TOOLS = "[Tool results above. Continue your reply.]";

/**
 * A reply that ends on tool results gets a short continue turn after them. Sent as the prompt, a
 * trailing tool result reaches Claude Code as a dangling call: on resume it marks the call interrupted
 * and the model calls again. Inside the resumed history, with this turn as the prompt, it reads the result.
 */
export function continueAfterToolResults(messages: ChatMessage[]): ChatMessage[] {
  return messages.at(-1)?.role === "tool" ? [...messages, { role: "user", content: CONTINUE_AFTER_TOOLS }] : messages;
}
