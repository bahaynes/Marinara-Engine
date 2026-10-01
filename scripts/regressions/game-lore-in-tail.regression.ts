import assert from "node:assert/strict";
import {
  placeGameWorldInfo,
  selectGameWindow,
} from "../../packages/server/src/routes/generate/generate-route-utils.js";

const before = "<lore>\nBEFORE\n</lore>";
const after = "<lore>\nAFTER\n</lore>";
const history = () => [
  { role: "system" as const, content: "GM_INSTRUCTIONS" },
  { role: "assistant" as const, content: "Earlier reply." },
  { role: "user" as const, content: "Open the door." },
];

// Default: before leads the GM system message, after trails it, and the history is untouched.
{
  const messages = history();
  placeGameWorldInfo(messages, before, after);
  assert.equal(messages[0]!.content, `${before}\n\nGM_INSTRUCTIONS\n\n${after}`);
  assert.equal(messages[2]!.content, "Open the door.");
}

// inTail: the system message stays byte-identical across turns; both blocks ride on the final user message.
{
  const messages = history();
  placeGameWorldInfo(messages, before, after, true);
  assert.equal(messages[0]!.content, "GM_INSTRUCTIONS");
  assert.equal(messages[1]!.content, "Earlier reply.");
  assert.equal(messages[2]!.content, `Open the door.\n\n${before}\n\n${after}`);
}

// inTail with only an "after" block adds no blank separators.
{
  const messages = history();
  placeGameWorldInfo(messages, "", after, true);
  assert.equal(messages[2]!.content, `Open the door.\n\n${after}`);
}

// inTail falls back to the default when the prompt does not end on a user message.
{
  const messages = [...history(), { role: "assistant" as const, content: "Continue me." }];
  placeGameWorldInfo(messages, before, after, true);
  assert.equal(messages[0]!.content, `${before}\n\nGM_INSTRUCTIONS\n\n${after}`);
  assert.equal(messages[3]!.content, "Continue me.");
}

// No GM system message: a system message is created for the blocks (default behavior).
{
  const messages = [{ role: "user" as const, content: "Hello." }];
  placeGameWorldInfo(messages, before, after);
  assert.deepEqual(messages[0], { role: "system", content: `${before}\n\n${after}` });
}

// Nothing to place: nothing changes.
{
  const messages = history();
  placeGameWorldInfo(messages, "", "", true);
  assert.deepEqual(messages, history());
}

console.log("Game lore placement: default positions preserved, tail placement leaves the system message stable.");

// History window: head holds while the cache is warm, re-cuts when cold or past the slack.
{
  const msgs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));
  const opts = { limit: 10, slack: 4, cacheCold: false };
  assert.equal(selectGameWindow(msgs(8), { ...opts }).messages.length, 8);
  const first = selectGameWindow(msgs(12), { ...opts });
  assert.equal(first.headId, "m2");
  const warm = selectGameWindow(msgs(14), { ...opts, headId: first.headId });
  assert.equal(warm.headId, "m2");
  assert.equal(warm.messages.length, 12);
  assert.equal(selectGameWindow(msgs(17), { ...opts, headId: "m2" }).headId, "m7");
  assert.equal(selectGameWindow(msgs(14), { ...opts, headId: "m2", cacheCold: true }).headId, "m4");
  assert.equal(selectGameWindow(msgs(14), { ...opts, headId: "gone" }).headId, "m4");
}
