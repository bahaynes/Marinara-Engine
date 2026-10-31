/**
 * The Decision model removes Character Tracker rows that left the scene (custom-mods).
 *
 * Only a confident "has left" removes a row; a missing answer keeps everyone; manual rows
 * are never asked; and the question sees the newest message, where the departure is.
 */
import assert from "node:assert/strict";
import {
  dropDepartedTrackerCharacters,
  trackerDepartureQuestion,
} from "../../packages/server/src/services/generation/tracker-departure-check.js";

const asked: Array<{ state: unknown; questions: Array<{ id: string; instructions: string }> }> = [];
const backend = (left: Record<string, number>, omit: string[] = []) => ({
  maxStateTokens: 3500,
  calibration: { defaultThreshold: 0.5 },
  deferPreGeneration: false,
  ask: async (state: unknown, questions: Array<{ id: string; instructions: string }>) => {
    asked.push({ state, questions });
    const answers = new Map<string, number>();
    for (const q of questions) {
      const name = Object.keys(left).find((n) => q.instructions === trackerDepartureQuestion(n));
      if (name && !omit.includes(name)) answers.set(q.id, left[name]!);
    }
    return answers;
  },
});

const cast = [
  { characterId: "guide", name: "Guide" },
  { characterId: "pet", name: "Pet" },
  { characterId: "bride", name: "Bride" },
  { characterId: "manual:1", name: "Pinned" },
];
const messages = [
  {
    role: "user",
    name: "Hero",
    content: "He watches the guide climb away, her pet at her heel, and turns toward the lake.",
  },
  { role: "assistant", name: "the narrator", content: "At the lake, the bride swims back to shore." },
];
const skip = (c: { characterId: string }) => c.characterId.startsWith("manual:");

const result = await dropDepartedTrackerCharacters({
  characters: cast,
  backend: backend({ Guide: 1, Pet: 0.99, Bride: 0.01 }) as never,
  messages,
  skip,
});
assert.deepEqual(
  result.kept.map((c) => c.name),
  ["Bride", "Pinned"],
  "departed rows go; staying and manual rows stay",
);
assert.deepEqual(result.dropped, ["Guide", "Pet"]);
assert.equal(asked[0]!.questions.length, 3, "a manual row is never asked");
assert.match(JSON.stringify(asked[0]!.state), /swims back to shore/, "the newest message is in the state");

const partial = await dropDepartedTrackerCharacters({
  characters: cast,
  backend: backend({ Guide: 1, Pet: 1, Bride: 0 }, ["Bride"]) as never,
  messages,
  skip,
});
assert.equal(partial.kept.length, 4, "a missing answer is silence: nobody is dropped");
assert.deepEqual(partial.dropped, []);

console.log("tracker-departure-check regression passed");
