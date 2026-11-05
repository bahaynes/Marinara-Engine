import assert from "node:assert/strict";

import { shouldAbortOnPassiveGenerationDisconnect } from "../../packages/server/src/routes/generate/generate-route-utils.js";

// Fork: impersonate generations should not be aborted when the client disconnects
// (e.g. mobile app-switching / screen lock), matching normal turns so the server
// finishes generation in the background and syncs on return.
assert.equal(
  shouldAbortOnPassiveGenerationDisconnect({ impersonate: true }),
  false,
  "impersonate generation does not abort on passive disconnect",
);

assert.equal(
  shouldAbortOnPassiveGenerationDisconnect({ impersonate: false }),
  false,
  "normal generation does not abort on passive disconnect",
);

assert.equal(
  shouldAbortOnPassiveGenerationDisconnect({}),
  false,
  "default generation does not abort on passive disconnect",
);

console.log("Impersonate passive disconnect regression passed");
