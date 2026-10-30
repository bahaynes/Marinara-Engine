// Fork-only: what the marinara MCP may do to Erin's instance. Reads only, unless the MCP was registered with
// MARINARA_WIFE_WRITES=1 (Ben sets that when Erin wants a change). Enforced here, not in a tool description.

const WIFE = "marinara-wife";
const READ_DB_ACTIONS = new Set(["status", "tables", "schema", "validate", "list", "get", "select"]);

/**
 * Returns the arguments to send, or throws when the call could write to marinara-wife. Structured app_data
 * calls are forced to a dry run (`apply: false`), because creates save when `apply` is left out.
 */
export function guardInstanceCall(toolName, args, env = process.env) {
  if (args?.instance !== WIFE || env.MARINARA_WIFE_WRITES === "1") return args;
  const refuse = (what) => {
    throw new Error(
      `Blocked on marinara-wife (${what}): Erin's instance is read-only to agents unless Ben confirms she wants the change.`,
    );
  };
  if (toolName === "mari_cli") refuse("raw mari commands");
  if (toolName === "mari_db" && !READ_DB_ACTIONS.has(String(args.action))) refuse(`db ${args.action}`);
  if (args.apply === true) refuse("saving changes");
  return { ...args, apply: false };
}
