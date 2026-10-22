/**
 * World-state date carry: a clock that wraps past midnight on an unchanged "Day N" date advances
 * the day in code, because the tracker model keeps the old date.
 */
import assert from "node:assert/strict";

const { advanceDateOnClockRollover: roll } =
  await import("../../packages/server/src/services/game/tracker-day-rollover.js");

// The observed failure: afternoon -> midnight, date left alone.
assert.equal(roll("Day 1", "14:30", "Day 1", "00:00"), "Day 2");
assert.equal(roll("Day 9", "23:50", "Day 9", "00:10"), "Day 10");
assert.equal(roll("Day 3", "9:40 PM", "Day 3", "6:15 am"), "Day 4");
assert.equal(roll("Day 2, late spring", "22:00", "Day 2, late spring", "07:00"), "Day 3, late spring");

// The model already advanced the date, or the clock only moved forward.
assert.equal(roll("Day 1", "23:50", "Day 2", "00:10"), "Day 2");
assert.equal(roll("Day 1", "11:55", "Day 1", "12:00"), "Day 1");
// A small backward step is the model correcting its clock, not a night.
assert.equal(roll("Day 1", "14:46", "Day 1", "14:15"), "Day 1");
// Unparseable values and calendar dates pass through unchanged.
assert.equal(roll("Day 1", "dusk", "Day 1", "dawn"), "Day 1");
assert.equal(roll("September 10th", "22:00", "September 10th", "07:00"), "September 10th");
assert.equal(roll(null, "22:00", "Day 1", "07:00"), "Day 1");
assert.equal(roll("Day 1", "22:00", null, "07:00"), null);

console.log("tracker-day-rollover regression passed");
