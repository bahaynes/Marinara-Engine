// custom-mods: Professor Mari's completion-claim guard threw away ordinary answers ("your story is
// set in Skyrim") in replies that ran no commands, and she answered its hidden correction instead.
import assert from "node:assert/strict";
import {
  auditWorkspaceCompletionClaim,
  workspaceTextClaimsMutationCompletion,
  type WorkspaceCommandResult,
} from "../../packages/server/src/services/professor-mari/workspace-agent.service.js";

const reply = (visibleText: string) => ({ visibleText, commands: [], stop: true });

// ── Conversation with no commands is not audited as an edit ──
for (const text of [
  "No, that's fine. Your story is set in Skyrim, where combat is normal.",
  "Combat violence is allowed; it's added drama, nothing more.",
  "Your lorebook is set up well for this.",
  "Werewolves were added to Skyrim in the Dawnguard era, so they fit 4E 199.",
]) {
  assert.equal(auditWorkspaceCompletionClaim(reply(text), []).issue, null, text);
}

// ── Unbacked edit claims in a command-free reply are still caught ──
for (const text of [
  "I've updated the Markarth entry.",
  "Done — I created it and verified it saved.",
  "The entry has been updated.",
  "Edit applied.",
  "Done!",
]) {
  assert.equal(auditWorkspaceCompletionClaim(reply(text), []).issue, "none", text);
}

// ── Once commands ran, the full upstream detector applies ──
const unverifiedWrite: WorkspaceCommandResult = {
  id: "update",
  name: "app_data",
  input: { action: "lorebook.updateEntry", entryId: "e1", apply: true },
  output: '{"saved": true}',
  success: true,
};
assert.equal(workspaceTextClaimsMutationCompletion("The entry is set to constant now."), true);
assert.equal(
  auditWorkspaceCompletionClaim(reply("The entry is set to constant now."), [unverifiedWrite]).issue,
  "unverified",
  "passive claims still count after a write",
);

console.log("mari claim conversation: ok");
