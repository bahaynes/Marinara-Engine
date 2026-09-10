// ──────────────────────────────────────────────
// Routes: Triage Combat Encounter (non-streaming JSON)
// ──────────────────────────────────────────────
// Deliberately self-contained (does not import from encounter.routes.ts) so
// this ATLS trauma-triage mini-game stays isolated from the classic/tactical/
// D&D combat-encounter pipeline — see packages/shared/src/features/triage for
// the fixed action/differential catalog and the pure client-side engine this
// route only seeds. The LLM invents the CASE (which differential is correct,
// two red herrings, patient flavor, starting vitals); it never invents the
// action catalog or the closed differential list.
import type { FastifyInstance } from "fastify";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createConnectionsStorage } from "../services/storage/connections.storage.js";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createGameStateStorage } from "../services/storage/game-state.storage.js";
import { resolveChatUserIdentity } from "../services/chat-user-identity.js";
import { createLLMProvider } from "../services/llm/provider-registry.js";
import type { ChatMessage } from "../services/llm/base-provider.js";
import { logger } from "../lib/logger.js";
import { localAuthProviderBaseUrl, DIFFERENTIAL_CATALOG } from "@marinara-engine/shared";
import type {
  TriageInitRequest,
  TriageInitResponse,
  TriageCaseSeed,
  TriageVitals,
  RPGStatsConfig,
  PresentCharacter,
} from "@marinara-engine/shared";

// Widened from an earlier 8-message window: an already-established patient/diagnosis in the
// RP (see buildTriageInitPrompt) can easily be more than 8 turns back by the time combat
// triggers, and a too-shallow window is how a real patient got silently replaced with an
// unrelated invented one. Not a scene-boundary detector, just a wider fixed lookback for v1.
const TRIAGE_HISTORY_DEPTH = 20;
const TRIAGE_OUTPUT_TOKENS = 1500;

/**
 * Scenario-setting flavors, sampled independent of the diagnosis (never correlated to correctDifferentialId,
 * so picking one can't leak the answer). Without this, the GM defaults to writing car-accident presentations
 * over and over — this forces mechanism-of-injury/illness variety instead.
 */
const SCENARIO_FLAVORS = [
  "an assault",
  "a fall from height",
  "an industrial or machinery accident",
  "a house fire with smoke inhalation",
  "a sports injury",
  "a pedestrian struck by a vehicle",
  "a bicycle collision",
  "found down after a suspected overdose",
  "a severe allergic reaction at a restaurant",
  "a near-drowning",
  "an electrical injury",
  "an elderly fall at home",
  "a postpartum hemorrhage",
  "a suspected ruptured ectopic pregnancy",
  "a GI bleed",
  "a diabetic emergency in public",
  "heat stroke at an outdoor event",
  "an occupational chemical exposure",
  "an assault with a weapon",
  "a single-vehicle car accident",
] as const;

function pickScenarioFlavor(): string {
  return SCENARIO_FLAVORS[Math.floor(Math.random() * SCENARIO_FLAVORS.length)]!;
}

/** Lean connection resolver — a local copy of encounter.routes.ts's resolveConnection so this file stays self-contained. */
async function resolveConnection(
  connections: ReturnType<typeof createConnectionsStorage>,
  connId: string | null,
  chatConnectionId: string | null,
) {
  let id = connId ?? chatConnectionId;
  if (id === "random") {
    const pool = await connections.listRandomPool();
    if (!pool.length) throw new Error("No connections marked for the random pool");
    id = pool[Math.floor(Math.random() * pool.length)].id;
  }
  if (!id) throw new Error("No API connection configured");
  const conn = await connections.getWithKey(id);
  if (!conn) throw new Error("API connection not found");

  let baseUrl = conn.baseUrl;
  if (!baseUrl) {
    const { PROVIDERS } = await import("@marinara-engine/shared");
    const providerDef = PROVIDERS[conn.provider as keyof typeof PROVIDERS];
    baseUrl = providerDef?.defaultBaseUrl ?? "";
  }
  const localAuthBaseUrl = localAuthProviderBaseUrl(conn.provider);
  if (!baseUrl && localAuthBaseUrl) baseUrl = localAuthBaseUrl;
  if (!baseUrl) throw new Error("No base URL configured for this connection");

  return { conn, baseUrl };
}

/** Extract a balanced JSON object from an LLM response that may include markdown fences. */
function parseJSON(raw: string): unknown {
  let cleaned = raw
    .trim()
    .replace(/^```(?:json|markdown)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "");
  const start = cleaned.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in AI response");
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.substring(start, i + 1));
    }
  }
  throw new Error("Unbalanced JSON in AI response");
}

function buildTriageInitPrompt(
  personaName: string,
  personaCtx: string,
  partyNames: string[],
  chatHistory: ChatMessage[],
  flavor: string,
  recentPresentations: { patientName: string; flavor: string }[],
): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  const differentialList = DIFFERENTIAL_CATALOG.map((d) => `"${d.id}" (${d.name})`).join(", ");
  const teamLine = partyNames.length > 1 ? partyNames.join(", ") : personaName;

  let system = `You are the game master for an ATLS-style ER trauma-triage mini-game (in the spirit of a medical drama, not fantasy combat). Your ONLY job here is to invent the CASE for this encounter — the mechanics (available interventions, AP costs, vitals math) are handled entirely by a fixed game engine, not by you.\n\n`;
  system += `Here are details about ${personaName}, who leads the trauma team:\n<persona>\n${personaCtx}\n</persona>\n\n`;
  system += `The team working this case is: ${teamLine}. If you mention the team in "presentation", use these actual names — do not invent new team members.\n\n`;
  system += `Here is the chat history leading into this encounter:\n<history>\n`;
  msgs.push({ role: "system", content: system });

  for (const m of chatHistory) {
    msgs.push({ role: m.role as "user" | "assistant", content: m.content });
  }

  let inst = `</history>\n\nFirst, check the chat history above: does it already show a SPECIFIC patient currently being evaluated or treated — with an apparent diagnosis stated or clearly implied by the scene (their age, what happened to them, symptoms already discussed)?\n\n`;
  inst += `- If YES: you MUST continue with that exact same patient. Use their real name/identity and match the age, gender, and situation already established in the history — do not invent a different patient or change their demographics. Set "correctDifferentialId" to whichever id from the closed list below best matches the condition already implied by the scene, even if it's not a dramatic or unusual pick. Ignore the scenario flavor below entirely in this case.\n`;
  inst += `- If NO specific patient is already in progress: invent a new one. The mechanism/setting for this new case is: ${flavor}. Build the presentation around this setting.\n\n`;
  if (recentPresentations.length > 0) {
    const recentList = recentPresentations.map((r) => `"${r.patientName}" (${r.flavor})`).join(", ");
    inst += `Recent cases in this chat, avoid repeating their setup (only relevant if you're inventing a new patient): ${recentList}.\n\n`;
  }
  inst += `Return ONLY a JSON object with this exact structure:\n\n`;
  inst += `{\n`;
  inst += `  "patientName": "short patient identifier, e.g. \\"28M, GSW to abdomen\\"",\n`;
  inst += `  "presentation": "one vivid sentence: how the patient arrives and presents",\n`;
  inst += `  "startingVitals": {"map": X, "spo2": X, "gcs": X, "crash": X},\n`;
  inst += `  "correctDifferentialId": "one of: ${differentialList}",\n`;
  inst += `  "redHerringDifferentialIds": ["two other ids from the same closed list, plausible but wrong"],\n`;
  inst += `  "clues": {"<differentialId>": "a short clue/finding sentence revealed once suspected, for the correct id AND both red herrings"}\n`;
  inst += `}\n\n`;
  inst += `IMPORTANT NOTES:\n`;
  inst += `- correctDifferentialId and redHerringDifferentialIds MUST use only the exact ids from the closed list above — never invent a new diagnosis id.\n`;
  inst += `- startingVitals: map (mean arterial pressure, roughly 40-140), spo2 (0-100), gcs (3-15), crash (a 0-100 decompensation meter — pick something tense but survivable, roughly 30-55, never above 65: this should be a hard-won save, not an unwinnable case).\n`;
  inst += `- Make the two red herrings genuinely plausible given the presentation, not obviously wrong.\n`;
  inst += `- clues: short, in-scene findings a clinician would actually observe or read off a monitor/study — not meta-gamey hints.\n`;
  inst += `- Write ALL text in the same language as the chat history. Return ONLY the JSON.\n`;

  msgs.push({ role: "user", content: inst });
  return msgs;
}

function clampVital(n: unknown, min: number, max: number, fallback: number): number {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/** Loosely validate + coerce the LLM's JSON into a well-formed TriageCaseSeed, never throwing on odd input. */
function hydrateCaseSeed(raw: unknown): TriageCaseSeed {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const validIds = new Set(DIFFERENTIAL_CATALOG.map((d) => d.id));
  const fallbackId = DIFFERENTIAL_CATALOG[0]!.id;

  const correctDifferentialId = validIds.has(obj.correctDifferentialId as string)
    ? (obj.correctDifferentialId as string)
    : fallbackId;

  const rawHerrings = Array.isArray(obj.redHerringDifferentialIds) ? obj.redHerringDifferentialIds : [];
  const herrings = rawHerrings
    .filter((id): id is string => typeof id === "string" && validIds.has(id) && id !== correctDifferentialId)
    .slice(0, 2);
  while (herrings.length < 2) {
    const candidate = DIFFERENTIAL_CATALOG.find((d) => d.id !== correctDifferentialId && !herrings.includes(d.id));
    if (!candidate) break;
    herrings.push(candidate.id);
  }

  const rawVitals = (obj.startingVitals && typeof obj.startingVitals === "object" ? obj.startingVitals : {}) as Record<
    string,
    unknown
  >;
  const startingVitals: TriageVitals = {
    map: clampVital(rawVitals.map, 40, 140, 90),
    spo2: clampVital(rawVitals.spo2, 50, 100, 94),
    gcs: clampVital(rawVitals.gcs, 3, 15, 14),
    crash: clampVital(rawVitals.crash, 10, 65, 40),
  };

  const rawClues = (obj.clues && typeof obj.clues === "object" ? obj.clues : {}) as Record<string, unknown>;
  const clues: Record<string, string> = {};
  for (const id of [correctDifferentialId, ...herrings]) {
    const clue = rawClues[id];
    clues[id] = typeof clue === "string" && clue.trim() ? clue.trim() : "No further findings noted.";
  }

  return {
    patientName:
      typeof obj.patientName === "string" && obj.patientName.trim() ? obj.patientName.trim() : "Unidentified patient",
    presentation:
      typeof obj.presentation === "string" && obj.presentation.trim()
        ? obj.presentation.trim()
        : "Rolls in unresponsive, vitals unstable.",
    startingVitals,
    correctDifferentialId,
    redHerringDifferentialIds: [herrings[0]!, herrings[1]!],
    clues,
  };
}

const SKILL_ATTRIBUTE_NAMES = new Set(["skill", "medicine"]);

/** Highest value among a set of RPG attributes literally named Skill/Medicine (case-insensitive), or null. */
function findSkillAttributeValue(rpg: RPGStatsConfig | undefined): number | null {
  if (!rpg?.enabled || !Array.isArray(rpg.attributes)) return null;
  let best: number | null = null;
  for (const attr of rpg.attributes as Array<{ name: string; value: number }>) {
    if (
      !SKILL_ATTRIBUTE_NAMES.has(
        String(attr?.name ?? "")
          .trim()
          .toLowerCase(),
      )
    )
      continue;
    const value = Number(attr.value);
    if (Number.isFinite(value) && (best === null || value > best)) best = value;
  }
  return best;
}

/** Same 8-20-scale, 10-is-average convention used for other stat scaling in this app (see encounter.routes.ts). */
function skillValueToBonus(value: number | null): number {
  if (value === null) return 0;
  return Math.max(0, Math.min(5, Math.round((value - 10) / 2)));
}

/**
 * Resolve the ACTUAL runtime party (persona + party characters currently PRESENT in the scene, per the
 * character tracker — not the whole configured roster) and an optional Skill/Medicine-derived bonus, the
 * same way classic/tactical combat parses persona + character RPG stats — this is app data, never invented
 * by the LLM.
 */
async function resolvePartyAndSkill(
  chars: ReturnType<typeof createCharactersStorage>,
  persona: Awaited<ReturnType<typeof resolveChatUserIdentity>>,
  personaName: string,
  characterIdsJson: unknown,
  presentCharacters: PresentCharacter[],
): Promise<{ partyNames: string[]; skillBonus: number; skillSourceCharacterIds: string[] }> {
  const names = [personaName];
  let personaStats: { rpgStats?: RPGStatsConfig } | null = null;
  const personaStatsValue = persona?.personaStats;
  if (typeof personaStatsValue === "string") {
    try {
      personaStats = JSON.parse(personaStatsValue);
    } catch {
      personaStats = null;
    }
  } else if (personaStatsValue && typeof personaStatsValue === "object") {
    personaStats = personaStatsValue as { rpgStats?: RPGStatsConfig };
  }
  let bestSkillValue = findSkillAttributeValue(personaStats?.rpgStats);
  let skillSourceCharacterIds: string[] = [];

  let characterIds: string[] = [];
  try {
    characterIds =
      typeof characterIdsJson === "string" ? JSON.parse(characterIdsJson) : ((characterIdsJson as string[]) ?? []);
  } catch {
    characterIds = [];
  }

  // Only credit characters actually present in the current scene as "the team" — falls back to the
  // whole configured roster if the tracker hasn't produced a presentCharacters snapshot yet this
  // session, so triage never silently runs with an empty party.
  const presentIds = new Set(presentCharacters.map((pc) => pc.characterId));
  const effectiveCharacterIds = presentIds.size > 0 ? characterIds.filter((id) => presentIds.has(id)) : characterIds;

  for (const id of effectiveCharacterIds) {
    const row = await chars.getById(id);
    if (!row) continue;
    const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
    if (typeof data?.name === "string" && data.name.trim()) names.push(data.name.trim());
    const skillValue = findSkillAttributeValue(data?.extensions?.rpgStats as RPGStatsConfig | undefined);
    if (skillValue !== null && (bestSkillValue === null || skillValue > bestSkillValue)) {
      bestSkillValue = skillValue;
      skillSourceCharacterIds = [id];
    }
  }

  return {
    partyNames: Array.from(new Set(names.filter(Boolean))),
    skillBonus: skillValueToBonus(bestSkillValue),
    skillSourceCharacterIds,
  };
}

export async function triageEncounterRoutes(app: FastifyInstance) {
  const chats = createChatsStorage(app.db);
  const connections = createConnectionsStorage(app.db);
  const chars = createCharactersStorage(app.db);
  const gameState = createGameStateStorage(app.db);

  app.post<{ Body: TriageInitRequest }>("/triage-init", async (req, reply) => {
    const { chatId, connectionId, recentPresentations } = req.body;
    if (!chatId) return reply.status(400).send({ error: "Missing required field: chatId" });

    try {
      const chat = await chats.getById(chatId);
      if (!chat) return reply.status(404).send({ error: "Chat not found" });

      const { conn, baseUrl } = await resolveConnection(connections, connectionId, chat.connectionId);
      const provider = createLLMProvider(
        conn.provider,
        baseUrl,
        conn.apiKey,
        conn.maxContext,
        conn.openrouterProvider,
        conn.maxTokensOverride,
        conn.claudeFastMode === "true",
        conn.treatAsLocalEndpoint === "true",
        conn.defaultParameters,
        conn.id,
      );

      const persona = await resolveChatUserIdentity(chars, {
        personaId: chat.personaId ?? null,
        personaCharacterId: chat.personaCharacterId,
        mode: chat.mode,
      });
      const personaName = persona?.name ?? "User";
      const personaCtx = persona?.description ?? "No persona information available.";

      const gs = await gameState.getLatest(chatId);
      const presentCharacters: PresentCharacter[] = gs?.presentCharacters
        ? typeof gs.presentCharacters === "string"
          ? JSON.parse(gs.presentCharacters)
          : gs.presentCharacters
        : [];

      const { partyNames, skillBonus, skillSourceCharacterIds } = await resolvePartyAndSkill(
        chars,
        persona,
        personaName,
        chat.characterIds,
        presentCharacters,
      );

      const chatMessages = await chats.listMessages(chatId);
      const recentMsgs: ChatMessage[] = chatMessages.slice(-TRIAGE_HISTORY_DEPTH).map((m: any) => ({
        role: (m.role === "narrator" ? "system" : m.role) as "user" | "assistant" | "system",
        content: m.content as string,
      }));

      const flavor = pickScenarioFlavor();
      const prompt = buildTriageInitPrompt(
        personaName,
        personaCtx,
        partyNames,
        recentMsgs,
        flavor,
        recentPresentations ?? [],
      );
      const result = await provider.chatComplete(prompt, {
        model: conn.model,
        temperature: 0.85,
        maxTokens: TRIAGE_OUTPUT_TOKENS,
      });

      let parsed: unknown;
      try {
        parsed = parseJSON(result.content ?? "");
      } catch (err) {
        logger.error(err, "[triage-init] Failed to parse case JSON for chat %s", chatId);
        parsed = {};
      }

      const caseSeed = hydrateCaseSeed(parsed);
      const response: TriageInitResponse = {
        case: caseSeed,
        partyNames,
        skillBonus,
        skillSourceCharacterIds,
        flavor,
      };
      return reply.send(response);
    } catch (err) {
      logger.error(err, "[triage-init] Failed to generate triage case for chat %s", chatId);
      return reply.status(500).send({ error: err instanceof Error ? err.message : "Failed to generate triage case." });
    }
  });

  /**
   * Small, conservative, and visible: on a clear win, a 25% chance to bump the credited
   * character's Skill/Medicine attribute by 1, capped below 18 so it can't run away from the
   * 8-20 scale the rest of this app's skill math is tuned against. Best-effort — the client
   * fires this after posting the combat recap and doesn't block on it.
   */
  app.post<{ Body: { chatId: string; characterIds: string[] } }>("/triage-grow-skill", async (req, reply) => {
    const { characterIds } = req.body;
    const grown: { characterId: string; characterName: string; attributeName: string; newValue: number }[] = [];

    for (const id of Array.isArray(characterIds) ? characterIds : []) {
      const row = await chars.getById(id);
      if (!row) continue;
      const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      const rpg = data?.extensions?.rpgStats as RPGStatsConfig | undefined;
      if (!rpg?.enabled || !Array.isArray(rpg.attributes)) continue;

      const attr = rpg.attributes.find((a: { name: string }) =>
        SKILL_ATTRIBUTE_NAMES.has(
          String(a?.name ?? "")
            .trim()
            .toLowerCase(),
        ),
      ) as { name: string; value: number } | undefined;
      if (!attr) continue;
      if (attr.value >= 18) continue;
      if (Math.random() >= 0.25) continue;

      const newValue = attr.value + 1;
      const nextAttributes = rpg.attributes.map((a: { name: string; value: number }) =>
        a === attr ? { ...a, value: newValue } : a,
      );
      await chars.update(id, { extensions: { rpgStats: { ...rpg, attributes: nextAttributes } } }, undefined, {
        mergeExtensions: true,
        versionSource: "triage-auto",
        versionReason: "Skill growth from a successful trauma case",
      });
      grown.push({
        characterId: id,
        characterName: typeof data?.name === "string" ? data.name : "Someone",
        attributeName: attr.name,
        newValue,
      });
    }

    return reply.send({ grown });
  });
}
