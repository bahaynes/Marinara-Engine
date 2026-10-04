import assert from "node:assert/strict";
import { usesSharedGroupPromptCache } from "../../packages/server/src/routes/generate/generate-route-utils.js";
import { scopeSharedGroupMessagesForTarget } from "../../packages/server/src/services/generation/prompt-message-scope.js";

const on = { groupSharedPromptCache: true };

// Only individual roleplay groups with the toggle on share a prompt.
assert.equal(usesSharedGroupPromptCache("roleplay", "individual", 3, on), true);
assert.equal(usesSharedGroupPromptCache("roleplay", "individual", 3, {}), false, "off by default");
assert.equal(usesSharedGroupPromptCache("roleplay", "individual", 1, on), false, "single character");
assert.equal(usesSharedGroupPromptCache("roleplay", "merged", 3, on), false, "merged already shares one prompt");
assert.equal(usesSharedGroupPromptCache("conversation", "individual", 3, on), false);
assert.equal(usesSharedGroupPromptCache("game", "individual", 3, on), false);

// Every responder gets the same prompt up to the final message, which carries only its own card.
const characters = [
  { id: "a", name: "Ash", description: "Ash secretly owes the guild." },
  { id: "b", name: "Bree", description: "Bree is the guild's spy." },
];
const prompt = [
  {
    role: "system" as const,
    content:
      "Stay in the scene.\n<characters>\n<Ash>\nAsh secretly owes the guild.\n</Ash>\n<Bree>\nBree is the guild's spy.\n</Bree>\n</characters>",
  },
  { role: "assistant" as const, content: "Ash: hello", contextKind: "history" as const, characterId: "a" },
  { role: "assistant" as const, content: "Bree: hi", contextKind: "history" as const, characterId: "b" },
  { role: "user" as const, content: "What now?", contextKind: "history" as const },
];
const forAsh = scopeSharedGroupMessagesForTarget(prompt, "a", characters);
const forBree = scopeSharedGroupMessagesForTarget(prompt, "b", characters);

assert.deepEqual(forAsh.slice(0, -1), forBree.slice(0, -1), "everything before the final message is shared");
assert.ok(!forAsh[0]!.content.includes("owes") && !forAsh[0]!.content.includes("spy"), "no card in the shared prompt");
assert.deepEqual(
  forAsh.slice(1, 4).map((message) => message.role),
  ["assistant", "assistant", "user"],
  "history keeps its stored roles",
);

const ashTail = forAsh.at(-1)!;
assert.equal(ashTail.role, "user");
assert.ok(ashTail.content.includes("Ash secretly owes the guild."), "the responder sees its own card");
assert.ok(!ashTail.content.includes("spy"), "the responder never sees another character's card");
assert.ok(ashTail.content.endsWith("Respond ONLY as Ash."));
assert.ok(forBree.at(-1)!.content.includes("Bree is the guild's spy.") && !forBree.at(-1)!.content.includes("owes"));

console.log("shared-group-prompt-cache regression passed");
