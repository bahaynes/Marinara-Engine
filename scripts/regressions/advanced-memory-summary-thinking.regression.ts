import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "marinara-am-summary-thinking-"));
process.env.DATA_DIR = directory;
process.env.FILE_STORAGE_DIR = join(directory, "storage");
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.MARINARA_LITE = "true";

const { summaryReasoningOptions } = await import("../../packages/server/src/services/advanced-memory.ts");
const { advancedMemorySettingsSchema } = await import("../../packages/shared/src/types/advanced-memory.ts");

try {
  // Saved settings predate the field and must keep thinking off.
  assert.equal(advancedMemorySettingsSchema.parse({}).summaryReasoningEffort, "none");
  assert.deepEqual(summaryReasoningOptions(undefined, "custom"), { reasoningEffort: "none" });
  assert.deepEqual(summaryReasoningOptions("none", "custom"), { reasoningEffort: "none" });
  // A custom connection drops reasoningEffort, so the level has to travel in the body.
  assert.deepEqual(summaryReasoningOptions("medium", "custom"), {
    reasoningEffort: "medium",
    customParameters: { reasoning_effort: "medium" },
  });
  // Native providers map the level themselves and must not get a foreign body field.
  assert.deepEqual(summaryReasoningOptions("high", "anthropic"), { reasoningEffort: "high" });
} finally {
  rmSync(directory, { recursive: true, force: true });
}
console.log("advanced memory summary thinking regression passed");
