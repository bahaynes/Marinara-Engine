import assert from "node:assert/strict";
import { injectAtDepth } from "../../packages/server/src/services/lorebook/prompt-injector.js";
import { pullHistoryInjectionsIntoInstruction } from "../../packages/server/src/services/prompt/impersonate-tail.js";

// An impersonate built without the chat's prompt put a depth-4 Author's Note inside the history. It moved two
// messages forward each turn, so the Claude cache (marker on the last history message) missed every impersonate.
type Msg = { role: "system" | "user" | "assistant"; content: string; contextKind?: "prompt" | "history" | "injection" };

const note = "Author's note: keep the pace slow.";
function impersonateTurn(historyLength: number) {
  const history: Msg[] = Array.from({ length: historyLength }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `post ${i}`,
    contextKind: "history",
  }));
  const withNote = injectAtDepth(
    [{ role: "system", content: "system prompt", contextKind: "prompt" }, ...history],
    [{ content: note, role: "system", depth: 4 }],
  ) as Msg[];
  assert.ok(
    withNote.slice(0, -1).some((m) => m.content === note),
    "setup: the note starts inside the history",
  );
  const pulled = pullHistoryInjectionsIntoInstruction(withNote, "Write as the persona.");
  return [...pulled.messages, { role: "user", content: pulled.instruction } as Msg];
}

const first = impersonateTurn(10);
const second = impersonateTurn(12);
assert.ok(!first.slice(0, -1).some((m) => m.content.includes(note)), "no note left in the history");
assert.equal(first.at(-1)!.content, `${note}\n\nWrite as the persona.`, "note moves into the instruction");
assert.deepEqual(second.slice(0, first.length - 1), first.slice(0, -1), "next turn's history extends the last one");

// The tracker context attaches to the persona's previous post, before the last reply; it moves too.
const tracker: Msg[] = [
  { role: "user", content: "post 0", contextKind: "history" },
  { role: "user", content: "Context:\n- mood: calm", contextKind: "injection" },
  { role: "assistant", content: "post 1", contextKind: "history" },
];
const pulledTracker = pullHistoryInjectionsIntoInstruction(tracker, "Write as the persona.");
assert.deepEqual(pulledTracker.messages, [tracker[0], tracker[2]]);
assert.equal(pulledTracker.instruction, "Context:\n- mood: calm\n\nWrite as the persona.");

// Injections before the first history message never shift, so they stay where they are.
const early: Msg[] = [
  { role: "system", content: "lore", contextKind: "injection" },
  { role: "user", content: "post 0", contextKind: "history" },
];
assert.deepEqual(pullHistoryInjectionsIntoInstruction(early, "x").messages, early);

process.stdout.write("Impersonate tail-injection regression passed.\n");
