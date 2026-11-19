// custom-mods: the quest board keeps a WIP limit, hides the backlog from the narrator, and keeps closed cards.
import assert from "node:assert/strict";
import {
  applyQuestUpdatesToPlayerStats,
  applyTaskCommands,
  questBoardPromptLines,
  questBoardShortlist,
  settleQuestBoard,
  type QuestProgress,
} from "../../../packages/shared/src/index.js";
import {
  buildRoleplayCommandsReminder,
  parseRoleplayCommands,
} from "../../../packages/server/src/services/generation/roleplay-commands.js";
import { buildCommittedTrackerContextBlock } from "../../../packages/server/src/services/generation/committed-tracker-context.js";

const card = (name: string, extra: Partial<QuestProgress> = {}): QuestProgress => ({
  questEntryId: name,
  name,
  currentStage: 0,
  objectives: [],
  completed: false,
  ...extra,
});

// Cards without a column fill the active slots in order; the rest wait.
const settled = settleQuestBoard([card("A"), card("B"), card("C"), card("D")], 3);
assert.deepEqual(
  settled.map((quest) => quest.status),
  ["active", "active", "active", "backlog"],
);

// A card whose objectives are all ticked closes, and stays on the board as done.
const ticked = settleQuestBoard([card("A", { status: "active", objectives: [{ text: "x", completed: true }] })], 3);
assert.equal(ticked[0]?.status, "done");
assert.equal(ticked[0]?.completed, true);

// Proposing files to the backlog even with a free slot; a duplicate title is not filed twice.
let board = applyTaskCommands(settled, [{ action: "propose", title: "The ledger" }], 3);
board = applyTaskCommands(board, [{ action: "propose", title: "the ledger" }], 3);
assert.equal(board.filter((quest) => quest.name.toLowerCase() === "the ledger").length, 1);
assert.equal(board.find((quest) => quest.name === "The ledger")?.status, "backlog");

// Start is refused while the board is full, then works once a card closes.
assert.equal(
  applyTaskCommands(board, [{ action: "start", title: "D" }], 3).find((quest) => quest.name === "D")?.status,
  "backlog",
);
board = applyTaskCommands(board, [{ action: "done", title: "A" }], 3);
assert.deepEqual(questBoardShortlist(board, 3), ["D", "The ledger"]);
board = applyTaskCommands(board, [{ action: "start", title: "The ledger" }], 3);
assert.equal(board.find((quest) => quest.name === "The ledger")?.status, "active");
assert.deepEqual(questBoardShortlist(board, 3), [], "no shortlist while the board is full");

// An objective ticks without closing the card; the last one closes it.
const withObjectives = settleQuestBoard(
  [
    card("Q", {
      status: "active",
      objectives: [
        { text: "Find the coat", completed: false },
        { text: "Read the roster", completed: false },
      ],
    }),
  ],
  3,
);
let q = applyTaskCommands(withObjectives, [{ action: "done", title: "Q", objective: "find the coat" }], 3);
assert.equal(q[0]?.status, "active");
q = applyTaskCommands(q, [{ action: "done", title: "Q", objective: "Read the roster" }], 3);
assert.equal(q[0]?.status, "done");

// An empty board starts its oldest backlog card.
assert.equal(settleQuestBoard([card("Z", { status: "backlog" })], 3)[0]?.status, "active");

// The narrator sees current tasks and closed titles, never the backlog.
const lines = questBoardPromptLines(board);
assert.ok(lines.closed.includes("- A"));
assert.equal(
  [...lines.current, ...lines.closed].some((line) => line.includes("- D")),
  false,
);
const context = buildCommittedTrackerContextBlock({
  chatEnableAgents: true,
  activeAgentIds: ["quest"],
  latestGameState: { playerStats: { activeQuests: board } },
  chatMetadata: {},
  wrapFormat: "markdown",
});
assert.match(context ?? "", /Current Tasks/u);
assert.match(context ?? "", /Closed Tasks/u);
assert.equal(/Active Quests/u.test(context ?? ""), false);
assert.equal((context ?? "").includes("- D"), false, "backlog stays out of the prompt");

// Without columns the old Active Quests block is unchanged.
const legacy = buildCommittedTrackerContextBlock({
  chatEnableAgents: true,
  activeAgentIds: ["quest"],
  latestGameState: { playerStats: { activeQuests: [card("Old")] } },
  chatMetadata: {},
  wrapFormat: "markdown",
});
assert.match(legacy ?? "", /Active Quests/u);

// A step of an open card joins it as an objective (once), from the narrator or the tracker; anything else files a card.
const parent = settleQuestBoard(
  [card("Which kingdom?", { status: "active" }), card("Done one", { completed: true })],
  3,
);
let stepped = applyTaskCommands(parent, [{ action: "propose", title: "Trace the steel", partOf: "which kingdom?" }], 3);
stepped = applyTaskCommands(stepped, [{ action: "propose", title: "trace the steel", partOf: "Which kingdom?" }], 3);
assert.equal(stepped.length, 2, "no new card for a step");
assert.deepEqual(stepped[0]?.objectives, [{ text: "Trace the steel", completed: false }]);
stepped = applyTaskCommands(stepped, [{ action: "propose", title: "New thread", partOf: "Done one" }], 3);
assert.equal(stepped.find((quest) => quest.name === "New thread")?.status, "backlog", "a closed parent files a card");
const trackerMerge = applyQuestUpdatesToPlayerStats({ activeQuests: stepped }, [
  { action: "create", questName: "Decode the pouch", partOf: "Which kingdom?" },
  { action: "create", questName: "Unrelated", partOf: "No such card" },
]);
assert.deepEqual(
  trackerMerge.quests[0]?.objectives.map((objective) => objective.text),
  ["Trace the steel", "Decode the pouch"],
);
assert.ok(trackerMerge.quests.some((quest) => quest.name === "Unrelated"));
assert.deepEqual(
  trackerMerge.updates.map((update) => update.questName),
  ["Unrelated"],
  "a folded step gets no journal entry",
);

// Parse: three forms; the command leaves the reply text.
const parsed = parseRoleplayCommands(
  'Text. [task: done="A" objective="Find the coat"] [task: propose="The ledger"] [task: start="D"] [task: propose="Steel" partOf="A"]',
);
assert.deepEqual(
  parsed.activity.map((item) => item.command),
  [
    { type: "task", action: "done", title: "A", objective: "Find the coat" },
    { type: "task", action: "propose", title: "The ledger" },
    { type: "task", action: "start", title: "D" },
    { type: "task", action: "propose", title: "Steel", partOf: "A" },
  ],
);
assert.equal(parsed.content.includes("[task"), false);

// Opt-in, needs the Quest Tracker; the shortlist rides along only when given.
const reminder = (toggles: Record<string, boolean>, agents: string[], shortlist?: string[]) =>
  buildRoleplayCommandsReminder({
    metadata: { roleplayCommandsEnabled: true, roleplayCommandToggles: toggles },
    privateAvailable: false,
    availableAgentIds: new Set(agents),
    format: "xml",
    characterNames: ["Alice"],
    taskShortlist: shortlist,
  });
assert.equal(reminder({}, ["quest"]).includes("[task:"), false);
assert.equal(reminder({ task: true }, []).includes("[task:"), false);
assert.match(reminder({ task: true }, ["quest"]), /\[task: done=/u);
assert.match(reminder({ task: true }, ["quest"]), /partOf=/u);
assert.equal(reminder({ task: true }, ["quest"]).includes("slot is free"), false);
assert.match(reminder({ task: true }, ["quest"], ["D"]), /slot is free[^\n]*"D"/u);

console.log("quest-board regression passed");
