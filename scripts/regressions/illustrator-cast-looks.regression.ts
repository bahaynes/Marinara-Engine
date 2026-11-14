// Fork: people without a card of their own reach the Illustrator: NPC Registry looks and portraits,
// this turn's tracker portraits, and members of an ensemble card.
import assert from "node:assert/strict";
import { registerCapabilityService } from "../../packages/server/src/services/capability-packages/capability-service-registry.service.js";
import {
  isIllustratorNpcCastId,
  loadIllustratorNpcCast,
} from "../../packages/server/src/services/image/illustrator-npc-cast.js";

// Without the registry package only tracker rows that carry a portrait count; card names are skipped.
assert.deepEqual(
  await loadIllustratorNpcCast({
    chatId: "c1",
    knownNames: ["Hunting Party"],
    presentCharacters: [
      { name: "Petra Nash", avatarPath: "/api/avatars/npc/c1/petra-nash.png", appearance: "tall, platinum shag" },
      { name: "Dez", avatarPath: null },
      { name: "hunting party", avatarPath: "/x.png" },
    ],
  }),
  [
    {
      id: "npc:Petra Nash",
      name: "Petra Nash",
      avatarPath: "/api/avatars/npc/c1/petra-nash.png",
      appearance: "tall, platinum shag",
    },
  ],
);

// Registry entries count with a portrait or stored looks; one for a tracker name fills what the row lacks.
registerCapabilityService("npc-registry", {
  current: async () => ({
    npcs: new Map([
      ["n1", { id: "n1", name: "Petra Nash", looks: "registry looks" }],
      ["n2", { id: "n2", name: "Dez", looks: "wiry, pink and black buns" }],
      ["n3", { id: "n3", name: "Kevin" }],
      ["n4", { id: "n4", name: "Simone", avatar: "/api/avatars/npc/c1/simone.png" }],
    ]),
  }),
});
const cast = await loadIllustratorNpcCast({
  chatId: "c1",
  knownNames: [],
  presentCharacters: [{ name: "Petra Nash", avatarPath: "/p.png", appearance: "" }],
});
assert.deepEqual(cast, [
  { id: "npc:Petra Nash", name: "Petra Nash", avatarPath: "/p.png", appearance: "registry looks" },
  { id: "npc-registry:n2", name: "Dez", avatarPath: null, appearance: "wiry, pink and black buns" },
  { id: "npc-registry:n4", name: "Simone", avatarPath: "/api/avatars/npc/c1/simone.png", appearance: null },
]);
assert.ok(cast.every((entry) => isIllustratorNpcCastId(entry.id)));
assert.equal(isIllustratorNpcCastId("abc123"), false, "a card id is not an NPC");

console.log("Illustrator cast looks regression passed");
