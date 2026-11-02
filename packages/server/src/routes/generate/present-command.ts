// custom-mods: the narrator opens each reply with [present: ...]; the Engine owns presentCharacters from it.
// Plan: minecraftdocker docs/llm/story-threads-plan.md, "Presence design".
import { decodeEncodedSpeakerTags, normalizeTextForMatch, type RoleplayCommandActivity } from "@marinara-engine/shared";

type Row = Record<string, unknown>;

/**
 * Who is in the scene after this reply. The line is trusted as written: it describes the scene at the end of
 * the reply, so people who spoke and then left stay out. Without a line, the previous list carries over plus
 * anyone who spoke (someone who left silently stays one more turn). The persona is never listed.
 */
export function resolvePresentNames(args: {
  activity: readonly RoleplayCommandActivity[];
  content: string;
  previousNames: readonly string[];
  personaName: string;
}): { names: string[]; fromLine: boolean } {
  const line = args.activity
    .filter((item) => item.command.type === "present" && !item.deleted && !item.error)
    .at(-1)?.command;
  const candidates =
    line?.type === "present"
      ? line.names
      : [
          ...args.previousNames,
          ...[...decodeEncodedSpeakerTags(args.content).matchAll(/<speaker="([^"]+)">/gu)].map((m) => m[1]!.trim()),
        ];
  const persona = normalizeTextForMatch(args.personaName);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const name of candidates) {
    const key = normalizeTextForMatch(name);
    if (!key || key === persona || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return { names, fromLine: line?.type === "present" };
}

/** Rows for these names. Someone already present keeps their whole row (outfit, avatar, fields); a newcomer starts empty. */
export function buildPresentRows(names: readonly string[], previous: readonly Row[]): Row[] {
  const byName = new Map<string, Row>();
  for (const row of previous) {
    const key = normalizeTextForMatch(row.name);
    if (key && !byName.has(key)) byName.set(key, row);
  }
  // ponytail: newcomers get no avatar/appearance enrichment (the tracker's NPC avatar lookup); card identity
  // still comes from applyTrackerCharacterCardIdentity at the call site. Upgrade: share the tracker's enrichment.
  return names.map((name) => {
    const kept = byName.get(normalizeTextForMatch(name));
    // A newcomer gets the full PresentCharacter shape. A card-less NPC's id is its name, as the tracker stores it;
    // applyTrackerCharacterCardIdentity swaps in the card id for card characters.
    return kept
      ? { ...kept }
      : {
          characterId: name,
          name,
          emoji: "",
          mood: "",
          appearance: null,
          outfit: null,
          thoughts: null,
          customFields: {},
          stats: [],
        };
  });
}
