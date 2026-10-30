import assert from "node:assert/strict";
// @ts-expect-error plain .mjs script without types
import { guardInstanceCall } from "../mari-mcp-guard.mjs";

// The marinara MCP keeps agents read-only on Erin's instance unless Ben enables writes; a tool description
// asking nicely did not stop an agent from recreating it.
const env = {};
const wife = (tool: string, args: Record<string, unknown>) =>
  guardInstanceCall(tool, { instance: "marinara-wife", ...args }, env);

assert.deepEqual(
  guardInstanceCall("mari_cli", { argv: ["db", "delete"] }, env),
  { argv: ["db", "delete"] },
  "Ben's instance passes through",
);
assert.equal(wife("mari_chats", { action: "list" }).apply, false, "reads run as dry runs");
assert.equal(
  wife("mari_characters", { action: "create", data: {} }).apply,
  false,
  "a create without apply would save; it is forced to preview",
);
assert.throws(() => wife("mari_characters", { action: "update", apply: true }), /Blocked on marinara-wife/);
assert.throws(() => wife("mari_cli", { argv: ["chats", "list"] }), /raw mari commands/);
assert.throws(() => wife("mari_db", { action: "patch", table: "chats" }), /db patch/);
assert.equal(wife("mari_db", { action: "select", table: "chats" }).action, "select");
assert.equal(
  guardInstanceCall(
    "mari_characters",
    { instance: "marinara-wife", action: "update", apply: true },
    { MARINARA_WIFE_WRITES: "1" },
  ).apply,
  true,
  "MARINARA_WIFE_WRITES=1 lifts the block",
);
process.stdout.write("Marinara MCP guard regression passed.\n");
