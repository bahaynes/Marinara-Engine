/**
 * A chat-model Decision connection's own Thinking setting (custom-mods).
 *
 * Connections used to be hard-wired to Auto, so two one-token answers in a row that
 * were not yes or no (a local model replying with a choice's label) switched the
 * connection to reasoning for the rest of the process, and every check took seconds.
 * Off must never switch; Allowed thinks from the first request; unset stays Auto.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createConnectionSchema } from "../../packages/shared/src/index.js";
import { resolveDecisionConnection } from "../../packages/server/src/services/decision/decision-connection.js";
import {
  askSidecarNoulQuestions,
  connectionChatTarget,
} from "../../packages/server/src/services/decision/sidecar-decision.backend.js";
import {
  clearDecisionThinkingCache,
  getAnswerStyle,
} from "../../packages/server/src/services/decision/decision-thinking-cache.js";

const input = { name: "Decision", provider: "decision", decisionSource: "openai_compatible" };
assert.equal(createConnectionSchema.parse(input).decisionThinking, null, "unset means Auto");
assert.equal(createConnectionSchema.parse({ ...input, decisionThinking: "off" }).decisionThinking, "off");
assert.throws(() => createConnectionSchema.parse({ ...input, decisionThinking: "sometimes" }));

// A stand-in local model that answers every one-token question with a label, not yes or no.
const maxTokens: number[] = [];
const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString()) as { max_tokens: number };
  maxTokens.push(body.max_tokens);
  const oneToken = body.max_tokens === 1;
  res.writeHead(200, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      choices: [
        {
          message: { content: oneToken ? "open" : "no" },
          logprobs: {
            content: [
              {
                token: oneToken ? "open" : "no",
                logprob: -0.05,
                top_logprobs: [{ token: oneToken ? "open" : "no", logprob: -0.05 }],
              },
            ],
          },
        },
      ],
    }),
  );
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };

try {
  const row = (decisionThinking: string | null, decisionSource = "openai_compatible") => ({
    id: `conn-${decisionThinking}-${decisionSource}`,
    provider: "decision",
    decisionSource,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model: "local-model",
    apiKey: "key",
    decisionThinking,
  });
  const resolve = async (decisionThinking: string | null, source?: string) =>
    (await resolveDecisionConnection(row(decisionThinking, source), async () => null)).connection!;
  assert.equal((await resolve(null)).thinking, "auto");
  assert.equal((await resolve("off")).thinking, "off");
  assert.equal((await resolve("allowed")).thinking, "allowed");
  assert.equal((await resolve("garbage")).thinking, "auto", "an unknown stored value reads as Auto");
  assert.equal((await resolve("off", "custom")).thinking, undefined, "System One has no Thinking setting");

  const questions = ["a", "b", "c"].map((id) => ({ id, instructions: `Statement ${id}` }));
  const ask = async (decisionThinking: string | null) => {
    clearDecisionThinkingCache();
    maxTokens.length = 0;
    const id = `conn-${decisionThinking}-openai_compatible`;
    const target = connectionChatTarget(id, "Gemma", await resolve(decisionThinking));
    // One at a time, as a turn's later questions follow its earlier ones.
    for (const question of questions)
      await askSidecarNoulQuestions({ slot: target, state: { recent_messages: [] }, questions: [question] });
    return getAnswerStyle(target.modelIdentity);
  };

  assert.equal(await ask(null), "thinks", "Auto still switches after two label answers");
  assert.deepEqual(maxTokens.slice(0, 2), [1, 1]);
  assert.ok(maxTokens[2]! > 1, "and the next question thinks");

  // The cache still notes the failures; Off just never acts on them.
  await ask("off");
  assert.deepEqual(maxTokens, [1, 1, 1], "Off never switches: every request is one token");

  await ask("allowed");
  assert.ok(
    maxTokens.every((n) => n > 1),
    "Allowed thinks from the first request",
  );
} finally {
  server.close();
}

console.log("decision-connection-thinking regression passed");
