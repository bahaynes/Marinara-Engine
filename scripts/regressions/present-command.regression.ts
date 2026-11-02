// custom-mods: the narrator's [present] line owns the scene roster.
import assert from "node:assert/strict";
import {
  buildRoleplayCommandsReminder,
  parseRoleplayCommands,
  RoleplayCommandStreamFilter,
} from "../../packages/server/src/services/generation/roleplay-commands.js";
import { buildPresentRows, resolvePresentNames } from "../../packages/server/src/routes/generate/present-command.js";

// Parse: a bare list at the start; states in parentheses are not part of the name.
const reply = '[present: Dana, Alice, Bram (asleep), "Cole"]\nAlice sets down the cup.';
const parsed = parseRoleplayCommands(reply);
assert.deepEqual(parsed.activity[0]?.command, { type: "present", names: ["Dana", "Alice", "Bram", "Cole"] });
assert.equal(parsed.content.trim(), "Alice sets down the cup.", "the line is removed from the reply text");
assert.equal(parseRoleplayCommands("[present: ]\nText.").activity.length, 0, "an empty list is not a command");

// Streaming: the leading line never reaches the reader, even split across chunks.
const filter = new RoleplayCommandStreamFilter();
const streamed = ["[pre", "sent: Dana, Al", "ice]\nAlice sets", " down the cup."].map((c) => filter.push(c)).join("");
assert.equal(streamed.includes("[present"), false);
assert.match(streamed, /Alice sets down the cup\./u);

// Opt-in: the instruction appears only with the toggle on.
const reminder = (toggles: Record<string, boolean>) =>
  buildRoleplayCommandsReminder({
    metadata: { roleplayCommandsEnabled: true, roleplayCommandToggles: toggles },
    privateAvailable: false,
    availableAgentIds: new Set(),
    format: "xml",
    characterNames: ["Alice"],
  });
assert.match(reminder({ present: true }), /\[present: Name, Name/u);
assert.doesNotMatch(reminder({}), /\[present:/u, "presence stays opt-in");

// The line is trusted as written: people who spoke and then left stay out; the persona is never listed.
const spokeThenLeft = parseRoleplayCommands(
  '[present: Dana, Alice]\n<speaker="Bram">"I\'m off."</speaker> He leaves. <speaker="Alice">"Good."</speaker>',
);
assert.deepEqual(
  resolvePresentNames({
    activity: spokeThenLeft.activity,
    content: spokeThenLeft.content,
    previousNames: ["Alice", "Bram"],
    personaName: "Dana",
  }),
  { names: ["Alice"], fromLine: true },
);

// No line: the previous list carries over, plus anyone who spoke; duplicates and the persona drop out.
assert.deepEqual(
  resolvePresentNames({
    activity: [],
    content: '<speaker="Cole">"Evening."</speaker> <speaker="alice">"Hi."</speaker> <speaker="Dana">"Hey."</speaker>',
    previousNames: ["Alice", "Bram"],
    personaName: "Dana",
  }),
  { names: ["Alice", "Bram", "Cole"], fromLine: false },
);

// A deleted or failed line counts as missing.
assert.equal(
  resolvePresentNames({
    activity: [{ ...spokeThenLeft.activity[0]!, deleted: true }],
    content: "",
    previousNames: ["Bram"],
    personaName: "Dana",
  }).fromLine,
  false,
);

// Rows: someone still present keeps their whole row (outfit, avatar); a newcomer gets an empty full row; leavers are gone.
const previous = [
  { name: "Alice", outfit: "grey coat", avatarPath: "/a.png", characterId: "card-a" },
  { name: "Bram", outfit: "apron" },
];
const rows = buildPresentRows(["alice", "Cole"], previous);
assert.deepEqual(rows, [
  { name: "Alice", outfit: "grey coat", avatarPath: "/a.png", characterId: "card-a" },
  {
    characterId: "Cole",
    name: "Cole",
    emoji: "",
    mood: "",
    appearance: null,
    outfit: null,
    thoughts: null,
    customFields: {},
    stats: [],
  },
]);
assert.notEqual(rows[0], previous[0], "rows are copies, not the previous snapshot's objects");

process.stdout.write("Present command regression passed.\n");
