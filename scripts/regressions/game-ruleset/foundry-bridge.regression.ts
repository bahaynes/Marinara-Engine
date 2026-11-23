// custom-mods: Phase 1 Foundry VTT -> Marinara bridge regression.
import assert from "node:assert/strict";
import {
  applyFoundryActorsToRulesetLive,
  formatFoundryCombatRecap,
  foundryCombatResultSchema,
} from "../../../packages/server/src/services/game/foundry-bridge.service.js";

const cards = [{ name: "Nadia Sallow" }, { name: "Arryn" }, { name: "Kass" }];

// 1. Matches Foundry actors (including prefix match) to party cards, updates HP/slots, clears foes.
{
  const currentLive = {
    nadia: { pools: { hp: { value: 22 }, slots_1: { value: 4 } } },
    "foe:giant fire beetle 1": { tracks: { hp: 3, max: 6 } },
  };
  const payload = foundryCombatResultSchema.parse({
    rounds: 3,
    sceneName: "Farrier's Warehouse",
    actors: [
      {
        name: "Nadia",
        hp: { value: 18, max: 22 },
        spells: { spell1: { value: 2, max: 4 }, spell2: { value: 1, max: 2 }, pact: { value: 1, max: 1 } },
        concentration: "Dragon's Breath",
      },
      {
        name: "Arryn",
        hp: { value: 24, max: 28 },
        concentration: null,
      },
    ],
    combatants: [
      { name: "Giant Fire Beetle 1", disposition: "hostile", hp: 0, maxHp: 6, defeated: true },
      { name: "Giant Fire Beetle 2", disposition: "hostile", hp: 2, maxHp: 6, defeated: false },
    ],
    log: ["Arryn hit Giant Fire Beetle 1 for 7 piercing damage."],
  });

  const { live, updatedMembers } = applyFoundryActorsToRulesetLive(currentLive, cards, payload);
  assert.deepEqual(updatedMembers, ["nadia sallow", "arryn"]);
  assert.equal(live["foe:giant fire beetle 1"], undefined, "clearFoes defaults to removing foe:* keys");
  assert.equal(live["nadia sallow"]?.pools?.hp?.value, 18);
  assert.equal(live["nadia sallow"]?.pools?.slots_1?.value, 2);
  assert.equal(live["nadia sallow"]?.pools?.slots_2?.value, 1);
  assert.equal(live["nadia sallow"]?.pools?.pact_slots?.value, 1);
  assert.equal(live["nadia sallow"]?.text?.concentration, "Dragon's Breath");
  assert.equal(live.arryn?.pools?.hp?.value, 24);
  assert.equal(live.arryn?.text, undefined, "null concentration does not leave empty text");

  const recap = formatFoundryCombatRecap(payload);
  assert.match(recap, /^\[ooc: Foundry VTT Combat Recap \| Scene: Farrier's Warehouse \| Rounds: 3/);
  assert.match(recap, /Defeated foes: Giant Fire Beetle 1/);
  assert.match(recap, /Surviving foes: Giant Fire Beetle 2 \(2\/6 HP\)/);
  assert.match(recap, /Nadia \(18\/22 HP, slots L1:2\/4 L2:1\/2 pact:1\/1, conc: Dragon's Breath\)/);
  assert.match(recap, /Arryn hit Giant Fire Beetle 1 for 7 piercing damage\./);
}

console.log("foundry bridge regression passed");
