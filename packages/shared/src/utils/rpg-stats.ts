import type { RPGSkillProficiency, RPGStatPool, RPGStatsConfig } from "../types/character.js";

export const DEFAULT_RPG_STAT_POOLS: readonly RPGStatPool[] = [
  { name: "HP", value: 100, max: 100, color: "#ef4444" },
  { name: "MP", value: 100, max: 100, color: "#3b82f6" },
];

const HP_NAME_RE = /^(?:hp|health|health points?|hit points?)$/i;

function finiteNumber(value: unknown, fallback: number, min = 0): number {
  const numeric =
    typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(min, numeric) : fallback;
}

function normalizePool(value: unknown, fallback: RPGStatPool): RPGStatPool | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Partial<RPGStatPool>;
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallback.name;
  const max = finiteNumber(raw.max, fallback.max, 1);
  const valueNumber = Math.min(max, finiteNumber(raw.value, fallback.value, 0));
  const color = typeof raw.color === "string" && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : fallback.color;
  // Canonical known fields win, but valid extension metadata is part of the
  // accepted persisted shape and must survive routine pool edits.
  return { ...raw, name, value: valueNumber, max, color };
}

export function createDefaultRpgStatPools(): RPGStatPool[] {
  return DEFAULT_RPG_STAT_POOLS.map((pool) => ({ ...pool }));
}

export function normalizeRpgStatPools(
  rpgStats: Pick<RPGStatsConfig, "hp" | "pools"> | null | undefined,
): RPGStatPool[] {
  if (Array.isArray(rpgStats?.pools) && rpgStats.pools.length > 0) {
    return rpgStats.pools
      .map((pool, index) => normalizePool(pool, DEFAULT_RPG_STAT_POOLS[index] ?? DEFAULT_RPG_STAT_POOLS[0]!))
      .filter((pool): pool is RPGStatPool => !!pool);
  }

  const hpMax = finiteNumber(rpgStats?.hp?.max, 100, 1);
  const hpValue = Math.min(hpMax, finiteNumber(rpgStats?.hp?.value ?? rpgStats?.hp?.max, hpMax, 0));
  return [{ name: "HP", value: hpValue, max: hpMax, color: "#ef4444" }];
}

export function syncRpgHpFromPools(
  pools: readonly RPGStatPool[],
  fallbackHp: RPGStatsConfig["hp"] = { value: 100, max: 100 },
): RPGStatsConfig["hp"] {
  const hpPool = pools.find((pool) => HP_NAME_RE.test(pool.name.trim())) ?? pools[0];
  if (!hpPool) return fallbackHp;
  return {
    ...fallbackHp,
    value: Math.max(0, Math.min(Math.max(1, Number(hpPool.max) || 1), Number(hpPool.value) || 0)),
    max: Math.max(1, Number(hpPool.max) || 1),
  };
}

// Proficiencies are deliberately left out: the engine adds their bonus to rolls itself, so
// sending them would only spend prompt tokens every turn.
export function formatRpgStatsForPrompt(rpgStats: RPGStatsConfig | undefined): string {
  if (!rpgStats?.enabled) return "";
  const lines: string[] = [];
  const pools = normalizeRpgStatPools(rpgStats);
  if (pools.length > 0) {
    lines.push(...pools.map((pool) => `${pool.name}: ${pool.value}/${pool.max}`));
  } else {
    lines.push(`Max HP: ${rpgStats.hp.max}`);
  }
  const attributes = Array.isArray(rpgStats.attributes) ? rpgStats.attributes : [];
  if (attributes.length > 0) {
    lines.push(attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(", "));
  }
  return lines.join("\n");
}

/** 5e proficiency bonus for a character level (+2 at 1-4, +3 at 5-8, ...). */
export function proficiencyBonusForLevel(level: number): number {
  return Math.floor((Math.max(1, level) - 1) / 4) + 2;
}

/** Keep only well-formed proficiency entries, keyed by normalized skill id. */
export function normalizeRpgProficiencies(value: unknown): Record<string, RPGSkillProficiency> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, RPGSkillProficiency> = {};
  for (const [key, level] of Object.entries(value)) {
    const id = key
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_");
    if (id && (level === "proficient" || level === "expertise")) result[id] = level;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Skill id -> flat bonus from a sheet's structured proficiencies, or null when it has none. */
export function rpgProficiencySkillMap(proficiencies: unknown, level: number): Record<string, number> | null {
  const normalized = normalizeRpgProficiencies(proficiencies);
  if (!normalized) return null;
  const bonus = proficiencyBonusForLevel(level);
  return Object.fromEntries(
    Object.entries(normalized).map(([id, kind]) => [id, kind === "expertise" ? bonus * 2 : bonus]),
  );
}
