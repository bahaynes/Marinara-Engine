import assert from "node:assert/strict";

import { injectCommittedTrackerContext } from "../../packages/server/src/services/generation/committed-tracker-context.js";

// Fork: an impersonate prompt ends on the assistant reply. The tracker block must land after it, or the
// volatile context sits inside the cached history prefix and every impersonate turn re-writes the cache.
const base = {
  chatEnableAgents: true,
  activeAgentIds: ["world-state"],
  latestGameState: { date: "Day 3" },
  chatMetadata: {},
  wrapFormat: "xml" as const,
  dedupeLastMessageWrappers() {},
};
const roles = (messages: Array<{ role: string; content: string }>) =>
  messages.map((message) => (message.content.includes("Day 3") ? "tracker" : message.role));

const impersonate = [
  { role: "system" as const, content: "S" },
  { role: "user" as const, content: "U" },
  { role: "assistant" as const, content: "A" },
];
injectCommittedTrackerContext({ ...base, messages: impersonate, findTrackerContextInsertIndex: () => 2 });
assert.deepEqual(roles(impersonate), ["system", "user", "assistant", "tracker"], "after the last assistant reply");

const reply = [
  { role: "system" as const, content: "S" },
  { role: "assistant" as const, content: "A" },
  { role: "user" as const, content: "U" },
];
injectCommittedTrackerContext({ ...base, messages: reply, findTrackerContextInsertIndex: () => 2 });
assert.deepEqual(roles(reply), ["system", "assistant", "tracker", "user"], "a normal reply is unchanged");

console.log("Committed tracker impersonate placement regression passed");
