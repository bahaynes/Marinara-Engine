import assert from "node:assert/strict";
import { embedMemoryRecallTexts } from "../../packages/server/src/services/memory-recall.js";

const texts = Array.from({ length: 20 }, (_, index) => `chunk ${index}`);

// A chat rebuild must not send every chunk in one request: slow embedding endpoints
// time out on it, and the rebuild then retries (and fails) on every turn.
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
assert.deepEqual(batchSizes, [8, 8, 4]);
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

console.log("memory-recall embedding batch regression passed");
