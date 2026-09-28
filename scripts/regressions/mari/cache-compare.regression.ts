// fork: chat.cacheCompare — the prompt comparison behind Professor Mari's cache prediction. Pins that
// reuse is counted in whole messages up to the first change, that the change is located from the
// end, and that the action is registered as a read-only one.
import assert from "node:assert/strict";
import { comparePromptMessages } from "../../../packages/server/src/services/mari-db/cache-compare.js";
import {
  PROFESSOR_MARI_APP_DATA_ACTIONS,
  appDataActionLooksReadOnly,
} from "../../../packages/server/src/services/professor-mari/workspace-agent.service.js";

const m = (role: string, content: string) => ({ role, content });
const history = [m("system", "a".repeat(400)), m("user", "b".repeat(400)), m("assistant", "c".repeat(400))];

// An identical prompt is fully reusable.
const same = comparePromptMessages(history, history);
assert.equal(same["Would hit"], "100%");
assert.equal(same["First change"], null);

// A final user message appended after identical history reuses all of it.
const appended = comparePromptMessages(history, [...history, m("user", "next")]);
assert.equal(appended["First change"]?.message, 4);
assert.equal(appended["First change"]?.["Messages from the end"], 1);

// A change in the middle makes everything after it unreusable, even when it is identical.
const edited = comparePromptMessages(history, [history[0]!, m("user", "b".repeat(399) + "x"), history[2]!]);
assert.equal(edited["First change"]?.message, 2);
assert.equal(edited["First change"]?.["Messages from the end"], 2);
assert.equal(edited["Reusable tokens"] < edited["Prompt tokens (estimated)"] / 2, true);

// Same text under another role is a different message.
assert.equal(
  comparePromptMessages(history, [m("user", "a".repeat(400)), ...history.slice(1)])["First change"]?.message,
  1,
);

assert.ok(PROFESSOR_MARI_APP_DATA_ACTIONS.includes("chat.cacheCompare"));
assert.equal(appDataActionLooksReadOnly("chat.cacheCompare"), true);
console.log("cache-compare regression passed");
