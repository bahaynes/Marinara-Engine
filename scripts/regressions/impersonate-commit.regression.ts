// custom-mods: an impersonated message commits the reply it follows, on that reply's visible swipe.
import assert from "node:assert/strict";
import { commitStateBeforeImpersonatedMessage } from "../../packages/server/src/routes/generate/commit-impersonated-turn.js";

function run(messages: Array<{ id: string; role: string; activeSwipeIndex?: number }>, messageId: string) {
  const committed: string[] = [];
  const lookups: string[] = [];
  return commitStateBeforeImpersonatedMessage({
    chatId: "chat",
    messageId,
    listMessages: async () => messages,
    store: {
      getByChatAndMessage: async (_chat, id, swipe) => {
        lookups.push(`${id}:${swipe}`);
        return id === "missing" ? null : { id: `snap-${id}-${swipe}` };
      },
      commit: async (id) => void committed.push(id),
    },
  }).then(() => ({ committed, lookups }));
}

const turn = [
  { id: "a1", role: "assistant", activeSwipeIndex: 0 },
  { id: "u1", role: "user" },
  { id: "a2", role: "assistant", activeSwipeIndex: 2 },
  { id: "u2", role: "user" },
];
assert.deepEqual((await run(turn, "u2")).committed, ["snap-a2-2"], "the visible swipe of the reply before it");
// Re-impersonating an older message commits the reply before that message, not a later one.
assert.deepEqual((await run(turn, "u1")).committed, ["snap-a1-0"]);
assert.deepEqual((await run([{ id: "u1", role: "user" }], "u1")).committed, [], "no reply yet");
assert.deepEqual(
  (
    await run(
      [
        { id: "missing", role: "assistant" },
        { id: "u1", role: "user" },
      ],
      "u1",
    )
  ).committed,
  [],
  "a reply without a snapshot",
);

// A storage failure must not lose the impersonated message.
await commitStateBeforeImpersonatedMessage({
  chatId: "chat",
  messageId: "u1",
  listMessages: async () => {
    throw new Error("storage down");
  },
  store: { getByChatAndMessage: async () => null, commit: async () => undefined },
});

console.log("impersonate commit regression passed");
