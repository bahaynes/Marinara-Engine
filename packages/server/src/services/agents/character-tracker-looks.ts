// custom-mods: names the present characters whose tracked appearance or outfit is blank.
//
// In incremental mode the tracker sends only what changed, so a character it never gave looks keeps
// none: a multi-character card's members went whole scenes with mood and thoughts but no outfit, and
// the Illustrator drew them in whatever the next box wore. The host lists them; the model still has
// to fill the fields, so this is a nudge, not a guarantee. An explicit "None" outfit counts as set.

function blank(value: unknown): boolean {
  return typeof value !== "string" || !value.trim();
}

export function buildBlankCharacterLooksRequest(gameState: unknown): string | null {
  const rows = (gameState as { presentCharacters?: unknown } | null)?.presentCharacters;
  if (!Array.isArray(rows)) return null;
  const named = rows.filter(
    (row): row is { name: string; appearance?: unknown; outfit?: unknown } =>
      !!row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string",
  );
  const noOutfit = named.filter((row) => blank(row.outfit)).map((row) => row.name.trim());
  const noAppearance = named.filter((row) => blank(row.appearance)).map((row) => row.name.trim());
  const lines = [
    noAppearance.length ? `No appearance tracked yet for: ${noAppearance.join(", ")}.` : "",
    noOutfit.length ? `No outfit tracked yet for: ${noOutfit.join(", ")}.` : "",
  ].filter(Boolean);
  if (lines.length === 0) return null;
  return `${lines.join(" ")} Fill these fields for them in your update, from character cards or the story; describe a plausible outfit when none is stated.`;
}
