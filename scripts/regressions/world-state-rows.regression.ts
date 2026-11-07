// custom-mods: World State output in the incremental row shape reaches the fields the apply path reads, and a
// blank state is asked for its fields. Rows and replies below are shapes the local model really returned.
import assert from "node:assert/strict";
import {
  buildBlankWorldStateRequest,
  placeWorldStateRows,
} from "../../packages/server/src/services/agents/world-state-rows.js";

// Rows naming world fields become those fields.
assert.deepEqual(
  placeWorldStateRows({
    updates: [
      { name: "date", value: "November 3rd, 2026" },
      { name: "time", value: "16:32" },
    ],
    removed: [],
  }),
  { date: "November 3rd, 2026", time: "16:32" },
);

// A null changes nothing: the merge keeps the previous value when the field is absent.
assert.deepEqual(
  placeWorldStateRows({
    updates: [
      { name: "date", value: null },
      { name: "location", value: "Basement lab" },
    ],
    removed: [],
  }),
  { location: "Basement lab" },
);

// A top-level field wins over a row, and other rows stay custom fields.
assert.deepEqual(
  placeWorldStateRows({
    time: "00:23",
    updates: [
      { name: "time", value: "00:24" },
      { name: "Atmosphere", value: "Diesel and brine", icon: "cloud" },
    ],
  }),
  {
    time: "00:23",
    worldCustomFields: { updates: [{ name: "Atmosphere", value: "Diesel and brine", icon: "cloud" }], removed: [] },
  },
);

// Ordinary replies pass through unchanged.
const plain = { date: "Day 1", time: "12:15", worldCustomFields: [] };
assert.deepEqual(placeWorldStateRows(plain), plain);
assert.deepEqual(placeWorldStateRows({}), {});
assert.deepEqual(placeWorldStateRows({ updates: [], removed: [] }), {});

// Only a fully blank state asks, whatever shape the blank takes.
for (const blank of [null, undefined, {}, { date: null, time: "", location: "  " }]) {
  assert.match(buildBlankWorldStateRequest(blank) ?? "", /currently blank: date, time, location, weather, temperature/);
}
assert.equal(buildBlankWorldStateRequest({ location: "Harbour" }), null);

console.log("world state rows regression passed");
