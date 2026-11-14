// Fork: people without a card of their own reach the Illustrator: NPC Registry looks and portraits,
// this turn's tracker portraits, and members of an ensemble card.
import assert from "node:assert/strict";
import { registerCapabilityService } from "../../packages/server/src/services/capability-packages/capability-service-registry.service.js";
import {
  buildIllustratorCastLookLines,
  ensureIllustratorNpcPortraits,
  isIllustratorNpcCastId,
  loadIllustratorNpcCast,
} from "../../packages/server/src/services/image/illustrator-npc-cast.js";
import { buildBlankCharacterLooksRequest } from "../../packages/server/src/services/agents/character-tracker-looks.js";
import { applyImageAgentContextExtensions } from "../../packages/server/src/services/image/image-agent-comfy-extensions.js";
import type { AgentContext } from "../../packages/shared/src/index.js";

// Plain prompts: ensemble members upstream's block left out get their own segment; outfits come
// from this turn's tracker, and a "none" outfit is no outfit.
const ensembleCard = {
  name: "Hunting Party",
  appearance: "[Petra Nash] tallest, platinum shag | [Simone] long-limbed, rich brown skin, locs",
};
assert.equal(
  buildIllustratorCastLookLines({
    sources: [ensembleCard, { name: "Avery", appearance: "androgynous, sharp gaze" }],
    visibleNames: ["Avery", "Petra Nash", "Simone"],
    coveredNames: ["Avery"],
    trackerRows: [
      { name: "Petra Nash", outfit: "leather vest, steel chain." },
      { name: "Simone", outfit: "None" },
    ],
    includeLooks: true,
    includeOutfits: true,
  }),
  [
    "Petra Nash's Appearance: tallest, platinum shag",
    "Simone's Appearance: long-limbed, rich brown skin, locs",
    "Petra Nash wears leather vest, steel chain.",
  ].join("\n"),
);
assert.equal(
  buildIllustratorCastLookLines({
    sources: [ensembleCard],
    visibleNames: ["Petra Nash"],
    coveredNames: [],
    trackerRows: [{ name: "Petra", outfit: "a camel coat" }],
    includeLooks: false,
    includeOutfits: true,
  }),
  "Petra Nash wears a camel coat.",
  "outfit only, matched by first name",
);

// Present-character gating keeps an ensemble card while one of its members is present.
const gated = applyImageAgentContextExtensions(
  {
    chatId: "c1",
    chatMode: "roleplay",
    recentMessages: [],
    mainResponse: "",
    characters: [
      { id: "card1", name: "Hunting Party", appearance: ensembleCard.appearance },
      { id: "card2", name: "Rival", appearance: "" },
    ],
    persona: null,
    gameState: { presentCharacters: [{ name: "Simone" }] },
    memory: {},
    writableLorebookIds: null,
    chatSummary: null,
  } as unknown as AgentContext,
  { presentCharactersOnly: true },
  null,
);
assert.deepEqual(
  gated.characters.map((character) => character.name),
  ["Hunting Party"],
);

// Without the registry package only tracker rows that carry a portrait count; card names are skipped.
assert.deepEqual(
  await loadIllustratorNpcCast({
    chatId: "c1",
    cards: [{ name: "Hunting Party", appearance: "" }],
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
  cards: [],
  presentCharacters: [{ name: "Petra Nash", avatarPath: "/p.png", appearance: "" }],
});
assert.deepEqual(cast, [
  { id: "npc:Petra Nash", name: "Petra Nash", avatarPath: "/p.png", appearance: "registry looks" },
  { id: "npc-registry:n2", name: "Dez", avatarPath: null, appearance: "wiry, pink and black buns" },
  { id: "npc-registry:n4", name: "Simone", avatarPath: "/api/avatars/npc/c1/simone.png", appearance: null },
]);
assert.ok(cast.every((entry) => isIllustratorNpcCastId(entry.id)));
assert.equal(isIllustratorNpcCastId("abc123"), false, "a card id is not an NPC");

// A member of an ensemble card keeps the registry portrait but not registry looks: the card describes them.
const memberCast = await loadIllustratorNpcCast({
  chatId: "c1",
  cards: [{ name: "Hunting Party", appearance: "[Dez] wiry, from the card | [Rani] hourglass" }],
});
assert.deepEqual(
  memberCast.find((entry) => entry.name === "Dez"),
  { id: "npc-registry:n2", name: "Dez", avatarPath: null, appearance: null },
);

// The tracker is told which present rows lack looks; an explicit "None" outfit counts as set.
assert.equal(
  buildBlankCharacterLooksRequest({
    presentCharacters: [
      { name: "Petra Nash", appearance: "tall", outfit: "" },
      { name: "Tama", appearance: null, outfit: "None (fox form)" },
      { name: "Rani", appearance: "hourglass", outfit: "silk wrap dress" },
    ],
  }),
  "No appearance tracked yet for: Tama. No outfit tracked yet for: Petra Nash. Fill these fields for them in your update, from character cards or the story; describe a plausible outfit when none is stated.",
);
assert.equal(
  buildBlankCharacterLooksRequest({ presentCharacters: [{ name: "Rani", appearance: "a", outfit: "b" }] }),
  null,
);
assert.equal(buildBlankCharacterLooksRequest(null), null);

// Just-in-time portraits: only card-less people with known looks and no portrait, once each.
const generated: string[] = [];
const withPortraits = await ensureIllustratorNpcPortraits({
  chatId: "portrait-regression-chat",
  requestedNames: ["Hero", "Petra", "Dez", "Kevin", "Simone"],
  cards: [
    { name: "Hero", appearance: "" },
    { name: "Hunting Party", appearance: "[Petra Nash] tallest, platinum shag | [Rani] hourglass" },
  ],
  cast: [
    { id: "npc-registry:n2", name: "Dez", avatarPath: null, appearance: "wiry, pink and black buns" },
    { id: "npc-registry:n4", name: "Simone", avatarPath: "/simone.png", appearance: null },
  ],
  generate: async (character) => {
    generated.push(`${character.name}: ${character.appearance}`);
    return `/api/avatars/npc/c1/${character.name.toLowerCase()}.png`;
  },
});
assert.deepEqual(generated, ["Petra: tallest, platinum shag", "Dez: wiry, pink and black buns"]);
assert.deepEqual(
  withPortraits.map((entry) => [entry.name, entry.avatarPath]),
  [
    ["Dez", "/api/avatars/npc/c1/dez.png"],
    ["Simone", "/simone.png"],
    ["Petra", "/api/avatars/npc/c1/petra.png"],
  ],
);

// A member named in an ensemble card's own name still gets a portrait (the card avatar shows someone else).
const ensemblePortraits: string[] = [];
await ensureIllustratorNpcPortraits({
  chatId: "portrait-regression-chat",
  requestedNames: ["Nyx", "Lena"],
  cards: [
    { name: "Nyx and Jinx", appearance: "[Nyx] ink-black hair, violet eyes | [Jinx] black hair with a purple streak" },
    { name: "Lena Hart", appearance: "" },
  ],
  cast: [],
  generate: async (character) => {
    ensemblePortraits.push(character.name);
    return "/x.png";
  },
});
assert.deepEqual(ensemblePortraits, ["Nyx"]);

console.log("Illustrator cast looks regression passed");
