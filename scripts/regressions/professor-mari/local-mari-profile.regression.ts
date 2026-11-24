// Pins the local Gemma 4 / Professor Mari reliability fixes:
// 1. OpenAIProvider forwards reasoningEffort ("high") + chat_template_kwargs.enable_thinking=true on custom local endpoints.
// 2. parseTextualToolCalls / stripTextualToolCalls handle leaked Gemma 4 <|tool_call>call:NAME{...}<tool_call|> tags.
// 3. RepeatedCallTracker nudges on 2nd identical call and stops on 3rd; needsLookupFirstNudge fires once on round-1 prose.
// 4. buildPreFlightDocsGrounding surfaces matching Marinara docs; mari-db echoes received keys on empty-patch updates.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LLMToolDefinition } from "../../../packages/shared/src/types/llm.js";
import {
  parseTextualToolCalls,
  stripTextualToolCalls,
} from "../../../packages/server/src/services/llm/textual-tool-call-parser.js";
import { OpenAIProvider } from "../../../packages/server/src/services/llm/providers/openai.provider.js";
import { resolve } from "node:path";
import {
  RepeatedCallTracker,
  buildPreFlightDocsGrounding,
  needsLookupFirstNudge,
} from "../../../packages/server/src/services/professor-mari/local-mari-profile.js";

const storageDir = mkdtempSync(join(tmpdir(), "marinara-local-mari-"));
const previousStorageDir = process.env.FILE_STORAGE_DIR;
process.env.FILE_STORAGE_DIR = storageDir;

try {
  // 1. OpenAIProvider local inference reasoning forwarding
  const provider = new OpenAIProvider("http://127.0.0.1:8080/v1", "test-key", 131072, null, null, "custom");
  const capturedBodies: Array<Record<string, unknown>> = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  try {
    await provider.chatComplete([{ role: "user", content: "hi" }], {
      model: "local-model",
      reasoningEffort: "high",
      enableThinking: true,
      temperature: 0.4,
    });
    await provider.chatComplete([{ role: "user", content: "hi" }], {
      model: "local-model",
      reasoningEffort: "none",
      temperature: 0.4,
    });
  } finally {
    globalThis.fetch = origFetch;
  }
  const [highBody, offBody] = capturedBodies;
  assert.ok(highBody && offBody);
  assert.equal("reasoning_effort" in highBody, false, "custom local endpoint must not inject reasoning_effort");
  assert.equal(
    (highBody.chat_template_kwargs as Record<string, unknown> | undefined)?.enable_thinking,
    true,
    "custom local endpoint should set enable_thinking: true when enableThinking is requested",
  );
  assert.equal(offBody.reasoning_effort, "none");
  assert.equal((offBody.chat_template_kwargs as Record<string, unknown> | undefined)?.enable_thinking, false);

  // 2. Gemma 4 native <|tool_call>call:NAME{...}<tool_call|> textual fallback
  const tools: LLMToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "docs_search",
        description: "Search docs",
        parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
      },
    },
  ];
  const leaked = 'Let me check.\n<|tool_call>call:docs_search{query:<|"|>lorebook positions<|"|>}<tool_call|>';
  const parsed = parseTextualToolCalls(leaked, tools);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.function.name, "docs_search");
  assert.deepEqual(JSON.parse(parsed[0]!.function.arguments), { query: "lorebook positions" });
  assert.equal(stripTextualToolCalls(leaked, tools), "Let me check.");

  // 3. RepeatedCallTracker & needsLookupFirstNudge
  const tracker = new RepeatedCallTracker();
  assert.equal(tracker.recordRound([{ name: "docs_search", arguments: { query: "5e", limit: 3 } }]).kind, "ok");
  assert.equal(tracker.recordRound([{ name: "docs_search", arguments: { limit: 3, query: "5e" } }]).kind, "ok");
  assert.equal(tracker.recordRound([{ name: "docs_search", arguments: { limit: 3, query: "5e" } }]).kind, "nudge");
  assert.equal(tracker.recordRound([{ name: "docs_search", arguments: { query: "5e", limit: 3 } }]).kind, "stop");

  assert.ok(
    needsLookupFirstNudge({
      userText:
        "How do lorebook entry positions work?\n\n<relevant_docs_hint>\n- docs/lorebooks/README.md\n</relevant_docs_hint>",
      callsCount: 0,
      commandResults: [],
      alreadyNudged: false,
    }),
  );
  assert.equal(
    needsLookupFirstNudge({
      userText:
        "How do lorebook entry positions work?\n\n<relevant_docs_hint>\n- docs/lorebooks/README.md\n</relevant_docs_hint>",
      callsCount: 0,
      commandResults: [],
      alreadyNudged: true,
    }),
    null,
  );

  // 4. Pre-flight docs grounding
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
  const grounding = await buildPreFlightDocsGrounding(repoRoot, "How do lorebook entry positions work?");
  assert.ok(grounding && grounding.includes("<relevant_docs_hint>"), "expected pre-flight docs hint");

  // 5. mari-db persona.update empty-patch error echoes received keys
  const { getDB, closeDB } = await import("../../../packages/server/src/db/connection.js");
  const { getMariDbService } = await import("../../../packages/server/src/services/mari-db/mari-db.service.js");
  const db = await getDB();
  try {
    const mariDb = getMariDbService(db);
    const created = await mariDb.executeAction({
      action: "persona.create",
      id: "p-test-1",
      data: { name: "Aria" },
      apply: true,
    });
    assert.equal(created.ok, true);
    const failed = await mariDb.executeAction({
      action: "persona.update",
      personaId: "p-test-1",
      apply: true,
      data: { wrongFieldName: "silver glasses" },
    });
    assert.equal(failed.ok, false);
    assert.match(String(failed.error), /wrongFieldName/);
  } finally {
    await closeDB();
  }

  console.log("local-mari-profile.regression.ts: all checks passed");
} finally {
  if (previousStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
}
