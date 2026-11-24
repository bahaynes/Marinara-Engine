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
  isLocalOpenAIMariConnection,
  needsLookupFirstNudge,
  usesLocalMariProfile,
} from "../../../packages/server/src/services/professor-mari/local-mari-profile.js";
import {
  recoverSuggestionSuffix,
  suggestionSuffixIndex,
} from "../../../packages/server/src/services/professor-mari/suggestion-suffix.js";
import {
  ProfessorMariWorkspaceService,
  draftVisibleText,
  piRuntimePrompt,
} from "../../../packages/server/src/services/professor-mari/workspace-agent.service.js";
import { runPiLoop } from "../../../packages/server/src/services/professor-mari/pi-runtime.js";
import { WorkspaceCommands } from "../../../packages/server/src/services/professor-mari/workspace-commands.js";

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

  // 6. Connection profile split: bundled sidecar vs self-hosted local OpenAI vs cloud
  const baseConn = {
    id: "conn-1",
    name: "Conn",
    provider: "custom",
    model: "local-model",
    baseUrl: "http://llama-server:8080/v1",
    apiKey: "",
    maxContext: 131072,
    maxTokensOverride: null,
    defaultParameters: null,
    openrouterProvider: null,
    claudeFastMode: "false",
    treatAsLocalEndpoint: "false",
    enableCaching: "false",
    anthropicExtendedCacheTtl: "false",
    cachingAtDepth: 5,
  };
  assert.equal(isLocalOpenAIMariConnection(baseConn), true);
  assert.equal(usesLocalMariProfile(baseConn), true);

  const sidecarConn = { ...baseConn, id: "local-sidecar", isLocalSidecar: true, baseUrl: "http://127.0.0.1:8085/v1" };
  assert.equal(isLocalOpenAIMariConnection(sidecarConn), false, "bundled 4B sidecar is distinct from local OpenAI");
  assert.equal(usesLocalMariProfile(sidecarConn), true);

  const cloudConn = { ...baseConn, provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1" };
  assert.equal(isLocalOpenAIMariConnection(cloudConn), false);
  assert.equal(usesLocalMariProfile(cloudConn), false);

  const flaggedLocalConn = { ...cloudConn, treatAsLocalEndpoint: "true" };
  assert.equal(isLocalOpenAIMariConnection(flaggedLocalConn), true);
  assert.equal(usesLocalMariProfile(flaggedLocalConn), true);

  // 7. piRuntimePrompt separateSuggestionsTurn for local OpenAI endpoints
  const separatePrompt = piRuntimePrompt(undefined, { separateSuggestionsTurn: true });
  assert.match(separatePrompt, /Do NOT call `suggestions` in the same turn as your final text/u);
  assert.match(separatePrompt, /NEVER write `suggestions:`, JSON chip objects, or `<suggestions>` tags/u);
  assert.doesNotMatch(separatePrompt, /write “The opening is ready\.” and call suggestions/u);

  const standardPrompt = piRuntimePrompt();
  assert.match(standardPrompt, /write “The opening is ready\.” and call suggestions/u);

  // 8. suggestion-suffix fallback hides and recovers trailing `suggestions: { "chips": [...] }`
  const leakedBlock = [
    "suggestions: {",
    '  "chips": [',
    '    { "label": "Build the Alchemist Persona", "prompt": "Help me create a Wayward Alchemist persona.", "entity": "personas" },',
    '    { "label": "Create Caspian", "prompt": "Create Caspian.", "entity": "characters" }',
    "  ]",
    "}",
  ].join("\n");
  const prose = "Here are a few ideas for Otome-Hearth.";
  const withLeak = `${prose}\n\n${leakedBlock}`;
  const recovered = recoverSuggestionSuffix(withLeak);
  assert.ok(recovered, "expected trailing suggestions: {...} block to recover");
  assert.equal(recovered.text, prose);
  assert.deepEqual(
    recovered.chips.map((c) => c.label),
    ["Build the Alchemist Persona", "Create Caspian"],
  );
  assert.equal(recovered.chips[0]?.entity, "personas");
  assert.equal(draftVisibleText(`${prose}\n\nsuggestions: {\n  "chips": [`), `${prose}\n\n`);
  assert.equal(draftVisibleText(`${prose}\n\nsuggestions for your world:`), `${prose}\n\nsuggestions for your `);
  assert.equal(recoverSuggestionSuffix(`${prose}\n\n\`\`\`json\n${leakedBlock}\n\`\`\``), null);
  assert.equal(recoverSuggestionSuffix(`${withLeak}\n\nMore prose afterwards.`), null);
  assert.ok(suggestionSuffixIndex(`${prose}\n\n${leakedBlock}`) > 0);

  // 9. runPiLoop on a local OpenAI connection runs a cached second round for standalone `suggestions`
  const db2 = await getDB();
  try {
    const commands = new WorkspaceCommands({ db: db2 } as never, () => ({
      permissionsMode: "auto",
      manualSilentMutationBlocked: false,
      askLatchSilentMutationBlocked: false,
      acceptedHeldCalls: false,
      decisionContext: null,
    }));
    const runLocalCase = async (
      responses: Array<{
        content: string;
        toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
      }>,
    ) => {
      const requests: Array<{ toolNames: string[]; lastUser: string }> = [];
      const events: Array<{ type: string; data?: unknown }> = [];
      const state = {
        assistantText: "",
        endedWithDeferral: false,
        heldChanges: [],
        heldCalls: [],
        suggestions: [] as Array<{ label: string; prompt: string }>,
        questions: [],
        nothingChanged: false,
      };
      const queue = [...responses];
      await runPiLoop({
        signal: new AbortController().signal,
        state: state as never,
        commands,
        trace: [],
        actionResults: [],
        commandResults: [],
        connection: baseConn,
        permissionsMode: "auto",
        manualApprovalArmed: false,
        messages: [
          {
            role: "system",
            content: piRuntimePrompt(undefined, { separateSuggestionsTurn: true }),
            contextKind: "prompt",
          },
          { role: "user", content: "Suggest a persona and characters for Otome-Hearth.", contextKind: "history" },
        ],
        onEvent: (event) => events.push(event),
        setRoundFlags: () => {},
        complete: async (msgs, tools) => {
          requests.push({
            toolNames: tools.map((t) => t.function.name),
            lastUser: [...msgs].reverse().find((m) => m.role === "user")?.content ?? "",
          });
          const next = queue.shift();
          if (!next) throw new Error("Ran out of scripted local replies");
          const toolCalls = (next.toolCalls ?? []).map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.args) },
          }));
          return {
            content: next.content,
            toolCalls,
            finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
          };
        },
      });
      return { requests, events, state };
    };

    const withChips = await runLocalCase([
      { content: "Here are a few ideas for Otome-Hearth: The Wayward Alchemist and Caspian." },
      {
        content: "",
        toolCalls: [
          {
            id: "sug-1",
            name: "suggestions",
            args: { chips: [{ label: "Build Alchemist", prompt: "Build the Wayward Alchemist persona." }] },
          },
        ],
      },
    ]);
    assert.equal(withChips.requests.length, 2, "local OpenAI connection gets cached suggestions round");
    assert.deepEqual(
      withChips.requests[0]!.toolNames,
      withChips.requests[1]!.toolNames,
      "round 2 keeps identical tool list so llama.cpp prompt KV cache stays intact",
    );
    assert.match(withChips.requests[1]!.lastUser, /call only the `suggestions` tool now/u);
    assert.equal(
      withChips.state.assistantText,
      "Here are a few ideas for Otome-Hearth: The Wayward Alchemist and Caspian.",
    );
    assert.equal(withChips.state.suggestions[0]?.label, "Build Alchemist");

    const withoutChips = await runLocalCase([{ content: "Okay, noted." }, { content: "" }]);
    assert.equal(withoutChips.requests.length, 2);
    assert.equal(withoutChips.state.assistantText, "Okay, noted.");
    assert.equal(withoutChips.state.suggestions.length, 0);

    // Ensure buildPromptMessages wires separateSuggestionsTurn for local OpenAI vs cloud
    const { createChatsStorage } = await import("../../../packages/server/src/services/storage/chats.storage.js");
    const chat = await createChatsStorage(db2).create({
      name: "local-prompt-check",
      mode: "conversation",
      characterIds: [],
    });
    const ws = new ProfessorMariWorkspaceService({ db: db2 } as never) as unknown as {
      buildPromptMessages: (
        chatId: string,
        connection: typeof baseConn,
        mode: "auto",
        handoff: null,
        runtime: "pi",
      ) => Promise<{ messages: Array<{ role: string; content: string }> }>;
    };
    const localBuilt = await ws.buildPromptMessages(chat.id, baseConn, "auto", null, "pi");
    const cloudBuilt = await ws.buildPromptMessages(chat.id, cloudConn, "auto", null, "pi");
    const localSys = localBuilt.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const cloudSys = cloudBuilt.messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    assert.match(localSys, /Do NOT call `suggestions` in the same turn as your final text/u);
    assert.match(cloudSys, /write “The opening is ready\.” and call suggestions/u);
  } finally {
    await closeDB();
  }

  console.log("local-mari-profile.regression.ts: all checks passed");
} finally {
  if (previousStorageDir === undefined) delete process.env.FILE_STORAGE_DIR;
  else process.env.FILE_STORAGE_DIR = previousStorageDir;
  rmSync(storageDir, { recursive: true, force: true });
}
