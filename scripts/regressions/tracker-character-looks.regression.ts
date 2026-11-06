// custom-mods: appearance and outfit survive a Character Tracker result that drops them. Models send
// explicit nulls, or a full array without those fields, and neither means "clear".
import assert from "node:assert/strict";
import {
  collectLatestTrackerCharacterHistory,
  preserveTrackerCharacterUiFields,
} from "../../packages/server/src/routes/generate/generate-route-utils.js";
import { resolveTrackerRowsUpdate } from "../../packages/shared/src/index.js";

const ada = { characterId: "ada-id", name: "Ada", appearance: "tall", outfit: "grey coat", mood: "calm" };
const bea = { characterId: "Bea", name: "Bea", appearance: "short", outfit: "green robe", mood: "brisk" };

function turn(result: unknown, previous: Array<Record<string, unknown>>, history: Array<Record<string, unknown>> = []) {
  const rows = resolveTrackerRowsUpdate(result, previous, "characterId")!;
  preserveTrackerCharacterUiFields(rows, previous);
  preserveTrackerCharacterUiFields(rows, history);
  return rows;
}

// Explicit nulls in an incremental row.
const nulled = turn({ updates: [{ characterId: "ada-id", name: "Ada", appearance: null, outfit: null }] }, [ada]);
assert.equal(nulled[0]?.appearance, "tall");
assert.equal(nulled[0]?.outfit, "grey coat");

// A full array whose rows carry neither field, which replaces every row.
const dropped = turn([{ characterId: "ada-id", name: "Ada", mood: "dry" }], [ada]);
assert.equal(dropped[0]?.outfit, "grey coat");
assert.equal(dropped[0]?.mood, "dry");

// A new value still wins.
assert.equal(
  turn({ updates: [{ characterId: "ada-id", name: "Ada", outfit: "nightgown" }] }, [ada])[0]?.outfit,
  "nightgown",
);

// A mislabeled characterId must not hand one character's looks to another.
const mislabeled = turn([{ characterId: "Bea", name: "Cass", mood: "practical" }], [bea]);
assert.equal(mislabeled[0]?.appearance, undefined);
assert.equal(mislabeled[0]?.outfit, undefined);

// A character who returned without looks recovers them from an older snapshot, newest first.
const history = collectLatestTrackerCharacterHistory([
  { presentCharacters: [{ characterId: "ada-id", name: "Ada", appearance: null, outfit: null }] },
  { presentCharacters: [{ ...ada, outfit: "older coat" }] },
  { presentCharacters: [{ ...ada, appearance: "oldest", outfit: "oldest coat" }] },
]);
assert.equal(history.length, 1);
assert.equal(history[0]?.appearance, "tall");
assert.equal(history[0]?.outfit, "older coat");
assert.equal(turn([{ characterId: "ada-id", name: "Ada" }], [], history)[0]?.outfit, "older coat");

// The same older row is not filled across a rename on a shared id.
const renamed = collectLatestTrackerCharacterHistory([
  { presentCharacters: [{ characterId: "Bea", name: "Cass" }] },
  { presentCharacters: [bea] },
]);
assert.equal(renamed[0]?.outfit, undefined);

console.log("tracker character looks regression passed");
