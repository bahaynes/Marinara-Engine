import assert from "node:assert/strict";
import { embedMemoryRecallTexts } from "../../packages/server/src/services/memory-recall.js";

const texts = Array.from({ length: 70 }, (_, index) => `chunk ${index}`);

// A chat rebuild is split into bounded requests and the vectors come back in input order.
const batchSizes: number[] = [];
const embeddings = await embedMemoryRecallTexts(texts, {
  embeddingSource: {
    spaceId: "test:batches",
    label: "batches",
    async embed(batch) {
      batchSizes.push(batch.length);
      return batch.map((text) => [Number(text.split(" ")[1])]);
    },
  },
});
assert.deepEqual(batchSizes, [64, 6]);
assert.deepEqual(
  embeddings.map((embedding) => embedding[0]),
  texts.map((_, index) => index),
);

// One failed batch fails the whole call, so callers never store a partial set.
let calls = 0;
const partial = await embedMemoryRecallTexts(texts, {
  embeddingSource: {
    spaceId: "test:batches-fail",
    label: "batches-fail",
    async embed(batch) {
      calls += 1;
      return calls === 2 ? null : batch.map(() => [1]);
    },
  },
});
assert.deepEqual(partial, []);
assert.equal(calls, 2);

// One oversized text must not fail the batch: documents keep their start, queries their latest end.
const seen: string[] = [];
const clampSource = {
  spaceId: "test:clamp",
  label: "clamp",
  async embed(batch: string[]) {
    seen.push(...batch);
    return batch.map(() => [1]);
  },
};
await embedMemoryRecallTexts([`HEAD${"x".repeat(40_000)}`], { embeddingSource: clampSource });
await embedMemoryRecallTexts([`${"x".repeat(40_000)}TAIL`], { embeddingSource: clampSource, inputType: "query" });
assert.ok(seen[0]!.startsWith("HEAD") && seen[0]!.length === 18_000);
assert.ok(seen[1]!.endsWith("TAIL") && seen[1]!.length === 3_000);

console.log("memory-recall embedding batch regression passed");
