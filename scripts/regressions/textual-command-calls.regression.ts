import assert from "node:assert/strict";
import { parseCharacterCommands } from "../../packages/server/src/services/conversation/character-commands.ts";

const qwen =
  'Fine.\n<tool_call>\n<function=spotify>\n<parameter=title>\nBlue "Moon"\n</parameter>\n<parameter=artist>\nNina\n</parameter>\n</function>\n</tool_call>';
const parsed = parseCharacterCommands(qwen);
assert.equal(parsed.commands.length, 1);
assert.equal(parsed.commands[0]!.type, "spotify");
assert.equal(parsed.cleanContent.includes("tool_call"), false);
assert.equal(parsed.cleanContent.trim(), "Fine.");

const json = parseCharacterCommands('<tool_call>{"name":"spotify","arguments":{"title":"A","artist":"B"}}</tool_call>');
assert.equal(json.commands[0]?.type, "spotify");

// A real tool's call isn't a dialogue command and stays as written.
const other = "<tool_call>\n<function=web_search>\n<parameter=q>\nx\n</parameter>\n</function>\n</tool_call>";
assert.equal(parseCharacterCommands(other).cleanContent, other);
console.log("textual command calls regression passed");
