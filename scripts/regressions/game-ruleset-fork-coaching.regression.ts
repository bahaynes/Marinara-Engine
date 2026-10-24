// ──────────────────────────────────────────────
// A ruleset game brings its own GM text, so none of the fork's D&D coaching reaches it: not the
// Inspiration tag and not the natural-1 failing-forward block. A game without a ruleset keeps both.
// ──────────────────────────────────────────────

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseRulesetDefinition } from "../../packages/shared/src/index.js";
import { buildGmFormatReminder } from "../../packages/server/src/services/game/gm-prompts.js";

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
} as ReminderContext;
// ── No Inspiration or d20 coaching in a ruleset game ──

const plain = buildGmFormatReminder(base);
const ruled = buildGmFormatReminder({ ...base, ruleset: parsed.definition } as ReminderContext);
for (const marker of ["[inspiration:", "Natural 1", "FAILING FORWARD"]) {
  assert.ok(plain.includes(marker), `a game without a ruleset keeps ${marker}`);
  assert.ok(!ruled.includes(marker), `a ruleset game drops ${marker}`);
}

console.log("game-ruleset-fork-coaching regression passed");
