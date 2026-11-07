// custom-mods: keeps World State output that models send in the incremental row shape, and starts a blank state.
import { isTrackerRowsUpdate } from "@marinara-engine/shared";
import { logger } from "../../lib/logger.js";

const WORLD_FIELDS = ["date", "time", "location", "weather", "temperature"] as const;
const WORLD_RESULT_KEYS = new Set<string>([...WORLD_FIELDS, "worldCustomFields", "recentEvents"]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The apply path reads world fields only from the result root, so `{"updates":[{"name":"time","value":"16:32"}]}`
 * used to vanish behind a successful run. Rows naming a world field become that field; a null changes nothing, and
 * any other row is a custom field. Warns when a non-empty result still holds nothing the apply path reads.
 */
export function placeWorldStateRows(data: unknown): unknown {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  let result = data as Record<string, unknown>;
  if (isTrackerRowsUpdate(result)) {
    const { updates, removed, ...rest } = result as Record<string, unknown> & {
      updates?: unknown[];
      removed?: unknown[];
    };
    const customRows: unknown[] = [];
    for (const row of updates ?? []) {
      const name = text((row as { name?: unknown } | null)?.name).toLowerCase();
      if ((WORLD_FIELDS as readonly string[]).includes(name)) {
        const value = text((row as { value?: unknown }).value);
        if (value && !text(rest[name])) rest[name] = value;
      } else if (name) {
        customRows.push(row);
      }
    }
    if ((customRows.length > 0 || (removed?.length ?? 0) > 0) && rest.worldCustomFields === undefined) {
      rest.worldCustomFields = { updates: customRows, removed: removed ?? [] };
    }
    result = rest;
  }
  const keys = Object.keys(result);
  if (keys.length > 0 && !keys.some((key) => WORLD_RESULT_KEYS.has(key))) {
    logger.warn("[agent] world-state result holds nothing it can apply (keys: %s)", keys.join(", "));
  }
  return result;
}

/** A blank state's "no changes" reply never starts it, so the host names the fields while all of them are blank. */
export function buildBlankWorldStateRequest(gameState: unknown): string | null {
  const state = (gameState ?? {}) as Record<string, unknown>;
  if (WORLD_FIELDS.some((field) => text(state[field]))) return null;
  return `These world fields are currently blank: ${WORLD_FIELDS.join(", ")}. Fill each one in your world-state result as a top-level field, from the story, estimating when it isn't stated.`;
}
