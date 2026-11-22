// custom-mods: a Roleplay reply's [attack:] tags are settled by Game Mode's combat resolver, not
// asked for as a skill check, and what they do lasts in the turn's live sheet state.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  attackTagCardResult,
  parseRulesetDefinition,
  readAttackTagAttributes,
  rulesetSheetBuildSchema,
  type RulesetCatalogEntriesById,
  type RulesetCatalogEntry,
  type RulesetLiveStates,
} from "../../../packages/shared/src/index.js";
import { resolveRoleplayAttackTags } from "../../../packages/server/src/services/game/roleplay-attack.service.js";
import { buildRulesetRoleplayReminder } from "../../../packages/server/src/services/game/gm-prompts.js";

const parsed = parseRulesetDefinition(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../docs/development/ruleset-5e-2014.example.json", import.meta.url)),
      "utf8",
    ),
  ),
);
assert.ok(parsed.ok);
const definition = parsed.definition;
const creatures = (definition.catalogs ?? []).find((catalog) => catalog.holds === "creatures")!;
const bestiary: RulesetCatalogEntriesById = {
  [creatures.id]: (creatures as unknown as { entries: RulesetCatalogEntry[] }).entries,
};
const fighter = rulesetSheetBuildSchema.parse({
  abilities: { str: 18, dex: 14, con: 16, int: 10, wis: 10, cha: 10 },
  saves: { str_save: "proficient", con_save: "proficient" },
  fields: { level: 7, ac: 18, speed: 30, hp_max: 60 },
  lists: {
    attacks: [
      { name: "Longsword", ability: "str", proficient: true, bonus: 0, damage: "1d8", damage_type: "slashing" },
    ],
  },
});
const cards = [{ name: "Brenna Holt", rulesetSheet: { v: 1, build: fighter } }];
const run = (content: string, live: RulesetLiveStates = {}) =>
  resolveRoleplayAttackTags(content, {
    definition,
    packageId: null,
    cards,
    playerName: "Brenna Holt",
    live,
    partyCatalogs: {},
    bestiary,
  });
const record = (content: string) => readAttackTagAttributes(/\[attack:\s*([^\]]+)\]/i.exec(content)?.[1] ?? "");

// A swing by a party member, by her first name, at a bestiary creature: rolled from her sheet against its defense.
{
  let live: RulesetLiveStates = {};
  let felled = false;
  for (let swing = 0; swing < 60 && !felled; swing++) {
    const out = await run(`She swings. [attack: who="Brenna" weapon="longsword" target="Thorn Lurker 2"]`, live);
    const tag = record(out.content);
    assert.equal(out.resolved, 1, out.summary.join("\n"));
    assert.equal(tag.weapon, "Longsword");
    assert.equal(tag.defense, "13", "the lurker's defense is the target");
    assert.equal(Number(tag.total), Number(tag.kept) + Number(tag.modifier));
    assert.equal(tag.modifier, "7", "+4 Strength and +3 proficiency");
    assert.ok(["hit", "miss", "critical"].includes(tag.result!));
    const card = attackTagCardResult(tag);
    assert.ok(card && card.dc === 13 && card.success === (tag.result !== "miss"), "the record reads as a dice card");
    const foe = out.live?.["foe:thorn lurker 2"];
    if (tag.result === "miss") assert.equal(out.live, null, "a miss changes nothing");
    else if (foe && Object.keys(foe).length) {
      const [now, max] = tag.health!.split("/").map(Number);
      assert.deepEqual(foe.tracks, { hp: now, max }, "a wounded foe keeps its health for the next tag");
    } else {
      assert.equal(tag.health?.split("/")[0], "0", "a felled foe's entry is emptied");
      felled = true;
    }
    live = { ...live, ...(out.live ?? {}) };
  }
  assert.ok(felled, "sixty longsword swings fell a thorn lurker");
}

// A creature's attack on the party lands on her sheet through the resolver's own damage.
{
  let hit = false;
  for (let bite = 0; bite < 60 && !hit; bite++) {
    const out = await run(`[attack: who="Thorn Lurker" target="Brenna Holt" mode="advantage"]`);
    const tag = record(out.content);
    assert.equal(out.resolved, 1, out.summary.join("\n"));
    assert.equal(tag.defense, "18", "her sheet's armour is the defense");
    assert.equal(tag.rolls!.split(",").length, 2, "advantage throws two dice");
    if (tag.result !== "miss") {
      hit = true;
      const hp = out.live?.["brenna holt"]?.pools?.hp?.value;
      assert.equal(typeof hp, "number");
      assert.equal(`${hp}/60`, tag.health, "the record and the sheet agree");
    }
  }
  assert.ok(hit, "a thorn lurker hits an AC 18 fighter within sixty tries");
}

// What cannot be rolled is left unrolled, with the reason the narrator is given.
{
  const out = await run(
    [
      `[attack: who="Brenna" weapon="Longsword" target="Shadow Thing"]`,
      `[attack: who="Brenna" weapon="Halberd" target="Thorn Lurker"]`,
      `[attack: who="Brenna" target="Brenna Holt"]`,
      `[attack: who="Brenna" weapon="Longsword" target="Thorn Lurker" result="hit" total="20"]`,
    ].join("\n"),
  );
  assert.equal(out.resolved, 0);
  assert.equal(out.summary.length, 3, "the settled record is not thrown again");
  assert.match(out.summary[0]!, /not in the bestiary/);
  assert.match(out.summary[1]!, /no attack named "Halberd"; their attacks are .*Longsword/);
  assert.match(out.summary[2]!, /one side must be a party member/);
  assert.match(out.content, /result="hit" total="20"\]$/);
}

// The narrator is taught the tag, with the foes still standing, wherever the ruleset fights.
{
  const reminder = buildRulesetRoleplayReminder({
    ruleset: definition,
    sheetBlocks: [],
    woundedFoes: ["Thorn Lurker 2: 4/16 health"],
  });
  assert.match(reminder, /ATTACKS:\n- \[attack: who=/);
  assert.match(reminder, /never a skill check/);
  assert.match(reminder, /Wounded foes: Thorn Lurker 2: 4\/16 health\./);
}

console.log("roleplay attack tag regression passed");
