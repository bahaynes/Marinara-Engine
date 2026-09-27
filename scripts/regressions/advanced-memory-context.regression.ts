import assert from "node:assert/strict";
import {
  advancedMemoryToolRoundReserve,
  prepareAdvancedMemoryContext,
  shrinkToolResultsToFit,
} from "../../packages/server/src/services/generation/advanced-memory-context.js";
import {
  createAdvancedMemoryPlacement,
  describeAdvancedMemoryPlacements,
  resolveAdvancedMemoryPrompt,
} from "../../packages/server/src/services/prompt/advanced-memory-prompt.js";
import { fitMessagesToContext, measureContextBudget } from "../../packages/server/src/services/llm/base-provider.js";

const settings = {
  enabled: true,
  maxContextTokens: 65_000,
  summaryBudgetTokens: 4096,
  helperConnectionId: null,
  initialProcessingModel: "helper" as const,
  sceneCheckInterval: 5,
  retrieveMaxScenes: 3,
  retrieveMinMessages: 3,
  retrieveMaxMessages: 10,
  narratorCharacterId: null,
  knowledgeStarts: {},
  knowledgeConfirmed: true,
};
type Input = Parameters<typeof prepareAdvancedMemoryContext>[0];
const source = Array.from({ length: 22 }, (_, index) => ({
  id: `source-${index}`,
  role: index % 2 ? "assistant" : "user",
  content: "x".repeat(4000),
}));
const placements = [
  createAdvancedMemoryPlacement("chat_summary", "xml"),
  createAdvancedMemoryPlacement("recalled_messages", "xml"),
];
const prompt: Input["messages"] = [
  {
    role: "system",
    content: `Character rules\n${placements.map((item) => item.token).join("\n")}`,
    contextKind: "prompt",
  },
  ...source.map((item) => ({ ...item, role: item.role as "user" | "assistant", contextKind: "history" as const })),
];
const calls: Array<{ budget: number; readOnly?: boolean }> = [];
let recall = "";
let cacheValid = true;
const service = {
  async validatePrepared() {
    if (!cacheValid) throw new Error("Memory sources changed");
  },
  async prepare(input: Parameters<Input["service"]["prepare"]>[0]) {
    calls.push({ budget: input.budgetTokens, readOnly: input.readOnly });
    const count = Math.min(source.length, Math.max(1, Math.floor((input.budgetTokens - 256) / 1010)));
    return {
      messageIds: source.slice(-count).map((item) => item.id),
      chatSummary: count < source.length ? "Earlier events remain in continuity." : null,
      currentSceneSummary: null,
      recalledScenes: null,
      recalledMessages: recall,
      recalledRecordIds: recall ? ["recalled-variant", "recalled-excerpt"] : [],
      receipt: {
        sourceFingerprint: "fixture",
        policyRevision: "fixture",
        recordRevisions: {
          "continuity-variant": "continuity-revision",
          "temporary-variant": "temporary-revision",
          ...(recall ? { "recalled-variant": "scene-revision", "recalled-excerpt": "excerpt-revision" } : {}),
        },
        estimatedTokensBefore: 0,
        estimatedTokensAfter: 0,
        budgetTokens: input.budgetTokens,
        boundaryMessageId: source.at(-count)!.id,
        checkpointId: "checkpoint",
        recalledSceneIds: [],
        recalledMessageIds: recall ? ["older-promise"] : [],
        reasons: [],
      },
    };
  },
} as Input["service"];
const input: Input = {
  service,
  chatId: "proof",
  settings,
  sourceMessages: source,
  messages: prompt,
  placements,
  audienceCharacterIds: ["character"],
  maxTokens: 4096,
  toProviderMessages: (messages) => messages,
};

const roomy = await prepareAdvancedMemoryContext(input);
assert.equal(
  roomy.messages.filter((message) => message.contextKind === "history").length,
  22,
  "22k of live history must grow naturally beneath a 65k complete-context cap",
);
assert.equal(calls.length, 1);
assert.ok(!roomy.providerMessages.some((message) => message.content.includes("__MARINARA_ADVANCED_MEMORY_")));
const generousReply = await prepareAdvancedMemoryContext({ ...input, maxTokens: 32768, maxContext: 128000 });
assert.equal(calls.at(-1)!.budget, calls[0]!.budget, "reply allowance does not consume the 65k outgoing prompt limit");
assert.equal(generousReply.maxTokens, 32768);
assert.equal(generousReply.receipt.budgetTokens, 65000);
assert(measureContextBudget(generousReply.providerMessages, { maxContext: 128000, maxTokens: 32768 }).fits);
calls.pop();
const reused = await prepareAdvancedMemoryContext({ ...input, cachedSnapshots: [roomy.snapshot] });
assert.equal(calls.length, 1, "a valid swipe snapshot bypasses memory preparation");
assert.deepEqual(reused.providerMessages, roomy.providerMessages);
assert(
  !roomy.snapshot.prepared.receipt.reasons.includes("reused-swipe-memory"),
  "reuse cannot mutate the saved original",
);
const introduction =
  "Included below are recalled memories of scenes from the past chat history, together with small message excerpts from them. Present message range in the context is: #20–#22, with the last user message being #21.";
const legacyParts = {
  recalledScenes: `${introduction}\n\nScene summary:\nEARLIER_SCENE_WITHOUT_EXCERPT`,
  recalledMessages: `${introduction}\n\nScene summary:\nLATER_SCENE\n\nExcerpt:\nMessages #10–#12;\nEXACT_PAST_WORDS`,
};
for (const format of ["xml", "markdown", "none"] as const) {
  for (const authored of [[], ["recalled_messages"], ["recalled_scenes"], ["recalled_messages", "recalled_scenes"]]) {
    const recallPlacements = (["recalled_messages", "recalled_scenes"] as const).map((type) =>
      createAdvancedMemoryPlacement(
        type,
        format,
        authored.includes(type)
          ? { id: type, name: type === "recalled_messages" ? "Recalled Messages" : "Recalled Scenes", role: "system" }
          : undefined,
      ),
    );
    const slots = recallPlacements.map((placement) => ({ content: placement.token }));
    const resolved = resolveAdvancedMemoryPrompt(slots, recallPlacements, legacyParts);
    assert.equal(resolved.length, 1, "both old recall components render in one section");
    const text = resolved[0]!.content;
    assert.equal(text.split(introduction).length - 1, 1, "the shared introduction appears once");
    assert(text.indexOf("EARLIER_SCENE_WITHOUT_EXCERPT") < text.indexOf("LATER_SCENE"));
    assert(text.indexOf("LATER_SCENE") < text.indexOf("EXACT_PAST_WORDS"));
    assert.doesNotMatch(text, /Recalled Messages|recalled_messages|MARINARA_ADVANCED_MEMORY/);
    if (format === "xml") assert.equal(text.match(/<recalled_scenes>/g)?.length, 1);
    if (format === "markdown") assert.equal(text.match(/^## Recalled Scenes$/gm)?.length, 1);
    const described = describeAdvancedMemoryPlacements(slots, recallPlacements);
    assert.equal(described.length, 1, "the receipt reports only the effective recall slot");
    assert.equal(
      described[0]!.markerType,
      authored.length === 1 && authored[0] === "recalled_messages" ? "recalled_messages" : "recalled_scenes",
      "the canonical authored marker wins, with the old marker retained as an alias",
    );
  }
}
const legacySnapshot = structuredClone(roomy.snapshot);
Object.assign(legacySnapshot.prepared, legacyParts);
const reusedLegacy = await prepareAdvancedMemoryContext({ ...input, cachedSnapshots: [legacySnapshot] });
assert.equal(calls.length, 1, "formatting old swipe memory must not search or prepare again");
const legacyText = reusedLegacy.providerMessages.map((message) => message.content).join("\n");
assert.equal(legacyText.split(introduction).length - 1, 1);
assert.equal(legacyText.match(/<recalled_scenes>/g)?.length, 1);
assert.doesNotMatch(legacyText, /<recalled_messages>/);
assert.deepEqual(legacySnapshot.prepared.recalledMessages, legacyParts.recalledMessages);
const beforeInvalid = calls.length;
for (const cachedSnapshot of [
  { ...roomy.snapshot, prepared: null },
  { ...roomy.snapshot, audienceCharacterIds: ["another-character"] },
  { ...roomy.snapshot, audienceMode: "owner" },
]) {
  await prepareAdvancedMemoryContext({ ...input, cachedSnapshots: [cachedSnapshot] });
}
assert.equal(calls.length, beforeInvalid + 3, "malformed and differently scoped snapshots are not reused");
cacheValid = false;
await prepareAdvancedMemoryContext({ ...input, cachedSnapshots: [roomy.snapshot] });
assert.equal(calls.length, beforeInvalid + 4, "changed sources or access require fresh preparation");
cacheValid = true;

recall = "Optional old promise ".repeat(3000);
const limited = await prepareAdvancedMemoryContext({ ...input, maxContext: 12_000 });
assert.ok(limited.messages.length < roomy.messages.length);
assert.equal(limited.receipt.recalledMessageIds.length, 0, "discard optional excerpts before further cutting history");
assert.deepEqual(
  limited.receipt.recordRevisions,
  { "continuity-variant": "continuity-revision", "temporary-variant": "temporary-revision" },
  "dropped optional recall must not invalidate the request, while retained continuity still does",
);
assert.equal(limited.messages.filter((message) => message.content.includes("Earlier events remain")).length, 1);
assert.ok(measureContextBudget(limited.providerMessages, { maxContext: 12_000, maxTokens: 4096 }).fits);
assert.ok(limited.providerMessages.some((message) => message.content.includes("Character rules")));
assert.equal(limited.snapshot.prepared.recalledMessages, null, "a saved snapshot contains only memory actually sent");
const beforeLimitedReuse = calls.length;
const reusedLimited = await prepareAdvancedMemoryContext({ ...input, cachedSnapshots: [limited.snapshot] });
assert.equal(calls.length, beforeLimitedReuse);
assert(!JSON.stringify(reusedLimited.providerMessages).includes("Optional old promise"));
const tighter = await prepareAdvancedMemoryContext({ ...input, cachedSnapshots: [roomy.snapshot], maxContext: 12_000 });
assert(calls.length > beforeLimitedReuse, "a saved history that exceeds a new context cap must be refitted");
assert(measureContextBudget(tighter.providerMessages, { maxContext: 12_000, maxTokens: 4096 }).fits);

recall = "";
const preview = await prepareAdvancedMemoryContext({ ...input, readOnly: true });
assert.equal(calls.at(-1)!.readOnly, true);
assert.deepEqual(preview.providerMessages, roomy.providerMessages);
assert.ok(prompt[0]!.content.includes(placements[0]!.token), "prepared snapshot must stay reusable");

const synthetic = {
  role: "user" as const,
  content: "New unsaved input",
  id: "__dryrun_user__",
  contextKind: "history" as const,
};
const withInput = await prepareAdvancedMemoryContext({
  ...input,
  messages: [...prompt, synthetic],
  maxContext: 12_000,
});
assert.equal(withInput.messages.at(-1)?.id, synthetic.id, "current unsaved input cannot disappear during selection");

await assert.rejects(
  prepareAdvancedMemoryContext({
    ...input,
    maxContext: 5000,
    messages: [{ role: "system", content: "Required rules".repeat(4000) }, ...prompt],
  }),
  /fixed instructions/,
);
await assert.rejects(
  prepareAdvancedMemoryContext({
    ...input,
    maxContext: 5000,
    messages: [{ ...synthetic, files: [{ type: "application/pdf", data: "a".repeat(10000) }] }, ...prompt],
  }),
  /fixed instructions/,
);

const original = structuredClone(roomy.providerMessages);
assert.throws(
  () =>
    fitMessagesToContext(roomy.providerMessages, {
      maxContext: 6000,
      maxTokens: 4096,
      preserveContext: true,
    }),
  /exceeds the context cap/,
);
assert.deepEqual(roomy.providerMessages, original, "managed failure cannot silently mutate or trim history");
const fitting = fitMessagesToContext(limited.providerMessages, {
  maxContext: 12_000,
  maxTokens: 4096,
  preserveContext: true,
});
assert.equal(fitting.trimmed, false);
assert.equal(fitting.maxTokens, 4096, "managed context preserves the requested completion reserve");
const tools = [{ name: "roll_dice", description: "Roll dice", parameters: { type: "object", properties: {} } }];
const tightSettings = { ...settings, maxContextTokens: 12_000 };
const withoutTools = await prepareAdvancedMemoryContext({ ...input, settings: tightSettings });
const withTools = await prepareAdvancedMemoryContext({ ...input, settings: tightSettings, tools });
const reserve = advancedMemoryToolRoundReserve(tightSettings.maxContextTokens, tools);
assert.equal(advancedMemoryToolRoundReserve(tightSettings.maxContextTokens), 0, "no tools, no reserve");
assert.equal(withTools.maxTokens, 4096, "the reserve never shrinks the real reply allowance");
assert(
  withTools.messages.filter((message) => message.contextKind === "history").length <
    withoutTools.messages.filter((message) => message.contextKind === "history").length,
  "attached tools leave history room for tool rounds",
);
assert(
  measureContextBudget(withTools.providerMessages, {
    maxContext: withTools.maxContext,
    maxTokens: withTools.maxTokens + reserve,
    tools,
  }).fits,
  "the prepared prompt keeps the whole tool reserve free",
);

const followUp = [
  ...withTools.providerMessages,
  {
    role: "assistant" as const,
    content: "",
    tool_calls: [{ id: "t1", type: "function" as const, function: { name: "roll_dice", arguments: "{}" } }],
  },
  { role: "tool" as const, content: "result ".repeat(20_000), tool_call_id: "t1" },
];
const overflow = measureContextBudget(followUp, { maxContext: withTools.maxContext, maxTokens: 4096, tools });
assert(!overflow.fits);
const shrunkFollowUp = shrinkToolResultsToFit(followUp, overflow.estimatedTokens - overflow.inputBudget)!;
assert(shrunkFollowUp, "an oversized tool result is shortened instead of failing the turn");
assert(measureContextBudget(shrunkFollowUp, { maxContext: withTools.maxContext, maxTokens: 4096, tools }).fits);
assert.match(shrunkFollowUp.at(-1)!.content, /Tool result truncated/);
assert.deepEqual(shrunkFollowUp.slice(0, -1), followUp.slice(0, -1), "prepared memory and history are untouched");
assert.equal(followUp.at(-1)!.content.length, "result ".repeat(20_000).length, "the input is not mutated");
assert.equal(shrinkToolResultsToFit(withTools.providerMessages, 500), null, "no tool results means no room to make");
process.stdout.write("Advanced memory complete-context regression passed.\n");
