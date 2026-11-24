import { sanitizeMariSuggestionChips } from "@marinara-engine/shared";

const OPENER = "<suggestions>";
const CLOSER = "</suggestions>";
const COLON_PREFIX = "suggestions:";
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function inMarkdownFence(prefix: string): boolean {
  let fence = "";
  for (const match of prefix.matchAll(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)/gm)) {
    const mark = match[1]!;
    if (!fence) fence = mark;
    else if (mark.startsWith(fence) && !match[2]!.trim()) fence = "";
  }
  return Boolean(fence);
}

function balancedJsonEnd(text: string, braceStart: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = braceStart; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function colonSuggestionSuffixIndex(text: string): number {
  const lastLine = text.lastIndexOf("\n") + 1;
  let index = text.lastIndexOf("\n" + COLON_PREFIX) + 1;
  if (!text.startsWith(COLON_PREFIX, index)) index = lastLine;
  const tail = text.slice(index);
  if (!tail || !tail.startsWith(COLON_PREFIX)) return -1;
  const afterColon = tail.slice(COLON_PREFIX.length);
  const trimmedAfterColon = afterColon.trimStart();
  if (trimmedAfterColon && !trimmedAfterColon.startsWith("{")) return -1;
  const braceOffset = afterColon.indexOf("{");
  if (braceOffset >= 0) {
    const end = balancedJsonEnd(text, index + COLON_PREFIX.length + braceOffset);
    if (end >= 0 && text.slice(end + 1).trim()) return -1;
  }
  return inMarkdownFence(text.slice(0, index)) ? -1 : index;
}

// Only a flush-left block on its own line can be UI. Markdown quotes and indented examples stay prose.
export function suggestionSuffixIndex(text: string): number {
  const lastLine = text.lastIndexOf("\n") + 1;
  let index = text.lastIndexOf("\n" + OPENER) + 1;
  if (!text.startsWith(OPENER, index)) index = lastLine;
  const close = text.indexOf(CLOSER, index);
  if (close >= 0 && text.slice(close + CLOSER.length).trim()) index = lastLine;
  const tail = text.slice(index);
  if (tail && (tail.startsWith(OPENER) || OPENER.startsWith(tail))) {
    // A partial opener must stay hidden while it streams. Inside a fenced example it must stay visible.
    return inMarkdownFence(text.slice(0, index)) ? -1 : index;
  }
  return colonSuggestionSuffixIndex(text);
}

function recoverColonSuggestionSuffix(content: string) {
  const index = colonSuggestionSuffixIndex(content);
  if (index < 0) return null;
  const braceStart = content.indexOf("{", index + COLON_PREFIX.length);
  if (braceStart < 0) return null;
  const braceEnd = balancedJsonEnd(content, braceStart);
  if (braceEnd < 0 || content.slice(braceEnd + 1).trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content.slice(braceStart, braceEnd + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const rawChips = record.chips ?? record.suggestions;
  const chips = sanitizeMariSuggestionChips(rawChips, { maxChips: 5 });
  if (chips.length === 0) return null;
  return { text: content.slice(0, index).trimEnd(), chips };
}

export function recoverSuggestionSuffix(content: string) {
  if (!content.trimEnd().endsWith(CLOSER)) return recoverColonSuggestionSuffix(content);
  const index = suggestionSuffixIndex(content);
  if (index < 0) return null;
  const block = content.slice(index + OPENER.length, content.lastIndexOf(CLOSER)).trim();
  // Accept the duplicated <chips> opener seen on Gemma. The entire suffix must consist of passive chip rows.
  let rows = block;
  for (let wrappers = 0; wrappers < 2; wrappers++) {
    if (rows.startsWith("<chips>")) rows = rows.slice("<chips>".length).trimStart();
    if (rows.endsWith("</chips>")) rows = rows.slice(0, -"</chips>".length).trimEnd();
  }
  const row = /<chip\s+((?:(?:label|prompt|entity)="[^"<>]*"\s*)+)\/>\s*/gy;
  const chips = [];
  let consumed = 0;
  for (const match of rows.matchAll(row)) {
    const attrs = Object.fromEntries(
      Array.from(match[1]!.matchAll(/(label|prompt|entity)="([^"]*)"/g), ([, key, value]) => [
        key!,
        value!.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ENTITIES[entity]!),
      ]),
    );
    if (!attrs.label?.trim() || !attrs.prompt?.trim()) return null;
    chips.push(attrs);
    consumed += match[0].length;
  }
  if (!chips.length || consumed !== rows.length) return null;
  return { text: content.slice(0, index).trimEnd(), chips: sanitizeMariSuggestionChips(chips, { maxChips: 5 }) };
}
