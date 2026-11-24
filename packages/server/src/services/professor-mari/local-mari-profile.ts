// Helpers for making local models (e.g. Gemma 4 26B on llama.cpp) reliable in Professor Mari's pi loop
// without stripping tools: pre-flight docs grounding, cross-round duplicate-call protection, and a
// one-shot lookup nudge for ungrounded prose replies.
import { isLocalInferenceBaseUrl } from "../../middleware/ip-allowlist.js";
import { MIN_GROUNDING_SCORE, searchCanonicalDocumentation } from "./documentation-tools.js";
import {
  isLocalSidecarConnection,
  type WorkspaceCommandCall,
  type WorkspaceCommandResult,
  type WorkspaceConnection,
} from "./workspace-agent.service.js";

/** Cap local model loops at 25 rounds instead of 400 so runaway loops cannot hang for minutes. */
export const LOCAL_MARI_MAX_TOOL_ROUNDS = 25;

const LOOKUP_QUESTION_RE = /\b(how do|how does|where is|where do|what is|why does|can mari|does marinara)\b/i;

/** True when Mari is running against a local inference server (sidecar or LAN/localhost custom endpoint). */
export function isLocalMariConnection(connection: WorkspaceConnection): boolean {
  return (
    isLocalSidecarConnection(connection) ||
    isLocalInferenceBaseUrl(connection.baseUrl ?? "") ||
    connection.treatAsLocalEndpoint === "true"
  );
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
}

/** Tracks identical tool calls across rounds so a model cannot spin forever on repeated reads or writes. */
export class RepeatedCallTracker {
  private readonly counts = new Map<string, number>();

  recordRound(
    calls: readonly Pick<WorkspaceCommandCall, "name" | "arguments">[],
  ): { kind: "ok" } | { kind: "nudge"; prompt: string } | { kind: "stop"; message: string } {
    let repeatedName: string | null = null;
    let maxSeen = 0;
    for (const call of calls) {
      // Skip UI/todo tools; only workspace/app_data calls can loop uselessly.
      if (
        call.name === ("suggestions" as string) ||
        call.name === ("ask" as string) ||
        call.name === ("todo" as string)
      ) {
        continue;
      }
      const key = `${call.name}:${stableJson(call.arguments)}`;
      const next = (this.counts.get(key) ?? 0) + 1;
      this.counts.set(key, next);
      if (next > maxSeen) {
        maxSeen = next;
        repeatedName = call.name;
      }
    }
    if (maxSeen >= 4 && repeatedName) {
      return {
        kind: "stop",
        message: `Professor Mari repeated the exact same \`${repeatedName}\` call ${maxSeen} times, so I stopped the loop.`,
      };
    }
    if (maxSeen === 3 && repeatedName) {
      return {
        kind: "nudge",
        prompt: `You already ran that exact \`${repeatedName}\` call and have its result above. Do not repeat it—use that output to take the next step or answer the user.`,
      };
    }
    return { kind: "ok" };
  }
}

/**
 * Runs a fast local docs search on the user's message so Mari sees matching doc paths/headings in
 * `<turn_context>` and calls `docs_read` instead of guessing Marinara features or ruleset IDs.
 */
export async function buildPreFlightDocsGrounding(workspaceRoot: string, userText: string): Promise<string | null> {
  const query = userText.trim();
  if (query.length < 8) return null;
  try {
    const response = await searchCanonicalDocumentation(workspaceRoot, query, 3);
    const hits = response.results.filter((hit) => hit.score >= MIN_GROUNDING_SCORE).slice(0, 3);
    if (hits.length === 0) return null;
    const lines = hits.map(
      (hit) => `- ${hit.path} (${hit.heading}): ${hit.excerpt.replace(/\s+/g, " ").trim().slice(0, 180)}`,
    );
    return [
      "<relevant_docs_hint>",
      "Matching Marinara documentation found for this request. Call `docs_read` on the relevant path before answering or guessing:",
      ...lines,
      "</relevant_docs_hint>",
    ].join("\n");
  } catch {
    return null;
  }
}

/**
 * Returns a one-shot repair prompt when a local model answers a Marinara/data/sheet question in
 * pure prose on round 1 without calling any lookup tool first.
 */
export function needsLookupFirstNudge(args: {
  userText: string;
  callsCount: number;
  commandResults: readonly WorkspaceCommandResult[];
  alreadyNudged: boolean;
}): string | null {
  if (args.alreadyNudged || args.callsCount > 0 || args.commandResults.length > 0) return null;
  if (!args.userText.includes("<relevant_docs_hint>")) return null;
  if (!LOOKUP_QUESTION_RE.test(args.userText)) return null;
  return "Matching Marinara docs are listed in `<relevant_docs_hint>`. Call `docs_read` on the relevant path before answering; only answer in prose if none of those docs apply.";
}
