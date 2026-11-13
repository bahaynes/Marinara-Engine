import assert from "node:assert/strict";
import { fitPromptToLimit } from "../../packages/server/src/services/image/prompt-fit.js";

// Under the limit: untouched.
assert.equal(fitPromptToLimit("a short prompt", 3000), "a short prompt");

// Over it: cut at the last paragraph break that keeps most of the room, so a whole character block goes.
const scene = "A woman on a quay at dawn. ".repeat(40);
const block = (name: string) =>
  `${name}: tall, long dark hair, amber eyes, scarred hands, weathered coat. `.repeat(8).trim();
const prompt = `${scene.trim()}\n\n${block("Minue")}\n\n${block("Dagny")}`;
const fit = fitPromptToLimit(prompt, 2000);
assert.ok(fit.length <= 2000, "fits the limit");
assert.ok(fit.startsWith(scene.trim()), "keeps the scene at the front");
assert.ok(!fit.endsWith("\n"), "no trailing break");
assert.ok(fit.includes("Minue:"), "keeps the earlier character");

// No break near the end: a hard cut at the limit.
const solid = "x".repeat(5000);
assert.equal(fitPromptToLimit(solid, 3000).length, 3000);

// Sentence breaks keep their period.
const sentences = "The boat drifts. ".repeat(200);
const cut = fitPromptToLimit(sentences, 1000);
assert.ok(cut.endsWith("drifts."), "ends on a whole sentence");
assert.ok(cut.length <= 1000);

process.stdout.write("Image prompt fit regression passed.\n");
