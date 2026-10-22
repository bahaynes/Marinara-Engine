// ──────────────────────────────────────────────
// Game skill systems: off means off, and a ruleset owns its skills.
//
//   1. An unset choice falls back to the genre's default system; an empty list is a chat that
//      switched every system off and gets no skills at all.
//   2. A ruleset game's reminder lists no skill-system skills: the ruleset checks its own, and a
//      second list (D&D by default) taught the Game Master names the ruleset does not have.
//   3. Nor any other fork D&D coaching: the Inspiration tag and the natural-1 failing-forward
//      block, which reached ruleset games regardless of the skill-system switch.
// ──────────────────────────────────────────────

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getActiveGameSkills, parseRulesetDefinition } from "../../packages/shared/src/index.js";
import { buildGmFormatReminder } from "../../packages/server/src/services/game/gm-prompts.js";

// ── 1. Unset vs. empty ──

assert.ok(getActiveGameSkills({ enabledSystemIds: null }).length > 0, "unset keeps the default system");
assert.deepEqual(getActiveGameSkills({ enabledSystemIds: [] }), [], "an empty list turns every system off");

// ── 2. A ruleset game lists no skill-system skills ──

const exampleUrl = new URL("../../docs/development/ruleset-5e-2014.example.json", import.meta.url);
const parsed = parseRulesetDefinition(JSON.parse(readFileSync(fileURLToPath(exampleUrl), "utf8")));
assert.ok(parsed.ok, "the example ruleset parses");

type ReminderContext = Parameters<typeof buildGmFormatReminder>[0];
const base = {
  hasSceneModel: false,
  gameActiveState: "exploration",
  sessionNumber: 1,
  turnNumber: 4,
  map: null,
  partyNames: ["Mari"],
  playerName: "Player",
  activeSkills: getActiveGameSkills({ enabledSystemIds: null }),
} as ReminderContext;
const SKILLS_LINE = "- Active skills for [skill_check: ...]:";

assert.ok(buildGmFormatReminder(base).includes(SKILLS_LINE), "a game without a ruleset lists its active skills");
assert.ok(
  !buildGmFormatReminder({ ...base, ruleset: parsed.definition } as ReminderContext).includes(SKILLS_LINE),
  "a ruleset game lists no skill-system skills",
);

// ── 3. No Inspiration or d20 coaching in a ruleset game ──

const plain = buildGmFormatReminder(base);
const ruled = buildGmFormatReminder({ ...base, ruleset: parsed.definition } as ReminderContext);
for (const marker of ["[inspiration:", "Natural 1", "FAILING FORWARD"]) {
  assert.ok(plain.includes(marker), `a game without a ruleset keeps ${marker}`);
  assert.ok(!ruled.includes(marker), `a ruleset game drops ${marker}`);
}

console.log("game-skill-systems regression passed");
