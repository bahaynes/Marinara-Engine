// ──────────────────────────────────────────────
// Game Mode: Skill Systems and Repertoire
// ──────────────────────────────────────────────

export type GameAbilityKey = "str" | "dex" | "con" | "int" | "wis" | "cha";

export interface GameSkillDefinition {
  id: string;
  name: string;
  ability: GameAbilityKey;
  description: string;
  category?: string;
}

export interface GameSkillSystem {
  id: string;
  name: string;
  description: string;
  skills: readonly GameSkillDefinition[];
}

export const DND_5E_SKILL_SYSTEM: GameSkillSystem = {
  id: "dnd5e",
  name: "Tabletop 5.5e (Standard)",
  description: "Standard 18 fantasy tabletop skills covering adventuring, knowledge, social interaction, and stealth.",
  skills: [
    // STR
    {
      id: "athletics",
      name: "Athletics",
      ability: "str",
      description: "Climbing, jumping, swimming, and feats of physical power.",
    },

    // DEX
    {
      id: "acrobatics",
      name: "Acrobatics",
      ability: "dex",
      description: "Balance, agility, tumbling, and dodging hazards.",
    },
    {
      id: "sleight_of_hand",
      name: "Sleight of Hand",
      ability: "dex",
      description: "Pickpocketing, concealing items, and manual trickery.",
    },
    {
      id: "stealth",
      name: "Stealth",
      ability: "dex",
      description: "Hiding in shadows, moving silently, and avoiding detection.",
    },

    // INT
    {
      id: "arcana",
      name: "Arcana",
      ability: "int",
      description: "Spells, magic items, eldritch lore, and magical traditions.",
    },
    {
      id: "history",
      name: "History",
      ability: "int",
      description: "Historical events, legendary figures, and ancient civilizations.",
    },
    {
      id: "investigation",
      name: "Investigation",
      ability: "int",
      description: "Deductive reasoning, finding clues, and discerning details.",
    },
    {
      id: "nature",
      name: "Nature",
      ability: "int",
      description: "Terrain, flora, fauna, weather, and natural cycles.",
    },
    {
      id: "religion",
      name: "Religion",
      ability: "int",
      description: "Deities, rites, holy symbols, and mythological pantheons.",
    },

    // WIS
    {
      id: "animal_handling",
      name: "Animal Handling",
      ability: "wis",
      description: "Calming beasts, understanding animal motives, and riding.",
    },
    {
      id: "insight",
      name: "Insight",
      ability: "wis",
      description: "Reading body language, detecting deception, and sensing motives.",
    },
    {
      id: "medicine",
      name: "Medicine",
      ability: "wis",
      description: "Stabilizing the dying, treating illnesses, and first aid.",
    },
    {
      id: "perception",
      name: "Perception",
      ability: "wis",
      description: "Spotting, hearing, or sensing things in the environment.",
    },
    {
      id: "survival",
      name: "Survival",
      ability: "wis",
      description: "Tracking, foraging, navigation, and enduring wilderness hazards.",
    },

    // CHA
    {
      id: "deception",
      name: "Deception",
      ability: "cha",
      description: "Fast-talking, misleading, lying, and maintaining a disguise.",
    },
    {
      id: "intimidation",
      name: "Intimidation",
      ability: "cha",
      description: "Coercing, browbeating, and projecting hostile threat.",
    },
    {
      id: "performance",
      name: "Performance",
      ability: "cha",
      description: "Entertaining an audience with music, dance, acting, or story.",
    },
    {
      id: "persuasion",
      name: "Persuasion",
      ability: "cha",
      description: "Diplomacy, negotiation, building trust, and graceful debate.",
    },
  ],
};

export const MEDICAL_SKILL_SYSTEM: GameSkillSystem = {
  id: "medical",
  name: "Medical Drama",
  description: "Core clinical, surgical, triage, and hospital interpersonal competencies.",
  skills: [
    // INT
    {
      id: "diagnostics",
      name: "Diagnostics",
      ability: "int",
      description: "Differential diagnosis, lab & imaging interpretation, pharmacology, uncovering hidden pathologies.",
    },
    {
      id: "investigation",
      name: "Investigation",
      ability: "int",
      description: "Forensic chart review, finding anomalies, incident analysis, uncovering medical foul play.",
    },

    // WIS
    {
      id: "triage",
      name: "Triage",
      ability: "wis",
      description: "Rapid patient prioritization under surge, spotting subtle crashes, clinical intuition.",
    },
    {
      id: "perception",
      name: "Perception",
      ability: "wis",
      description: "Noticing physical anomalies, auscultation, monitoring vital alarms, environmental cues.",
    },
    {
      id: "insight",
      name: "Insight",
      ability: "wis",
      description: "Reading patient and colleague emotional state, detecting deception, drug-seeking, or motives.",
    },

    // CHA
    {
      id: "bedside_manner",
      name: "Bedside Manner",
      ability: "cha",
      description: "Doctor-patient rapport, breaking bad news with empathy, calming terrified families.",
    },
    {
      id: "hospital_politics",
      name: "Hospital Politics",
      ability: "cha",
      description: "Navigating administration, hospital hierarchy, board meetings, and regulatory oversight.",
    },
    {
      id: "persuasion",
      name: "Persuasion",
      ability: "cha",
      description: "Negotiating with stubborn colleagues, gaining patient compliance, resource diplomacy.",
    },
    {
      id: "intimidation",
      name: "Intimidation",
      ability: "cha",
      description: "Command presence during a code blue, shutting down combative visitors, asserting authority.",
    },
    {
      id: "deception",
      name: "Deception",
      ability: "cha",
      description: "Guarding distressing truths, maintaining professional composure, covert interventions.",
    },

    // DEX
    {
      id: "surgery",
      name: "Surgery",
      ability: "dex",
      description: "Operative skill, delicate incisions, vascular clamping, suturing, instrument dexterity.",
    },
    {
      id: "procedures",
      name: "Procedures",
      ability: "dex",
      description: "Emergency bedside skills: intubation, chest tubes, central lines, cricothyroidotomy.",
    },

    // STR
    {
      id: "athletics",
      name: "Athletics",
      ability: "str",
      description: "Physical stamina for CPR compressions, manual traction, moving patients, patient restraint.",
    },

    // CON
    {
      id: "endurance",
      name: "Endurance",
      ability: "con",
      description: "Surviving marathon 24h shifts, resisting fatigue-induced errors, coping with sensory overload.",
    },
  ],
};

export const GAME_SKILL_SYSTEMS: readonly GameSkillSystem[] = [DND_5E_SKILL_SYSTEM, MEDICAL_SKILL_SYSTEM];

export function resolveDefaultGameSkillSystemIds(context?: {
  combatStyle?: string | null;
  genre?: string | null;
  setting?: string | null;
}): string[] {
  const isMedical =
    context?.combatStyle === "triage" ||
    /medical|hospital|clinic|doctor|nurse|er\b|emergency/i.test(context?.genre ?? "") ||
    /medical|hospital|clinic|doctor|nurse|er\b|emergency/i.test(context?.setting ?? "");

  return isMedical ? ["medical"] : ["dnd5e"];
}

export function getActiveGameSkills(options?: {
  enabledSystemIds?: readonly string[] | null;
  disabledSkillIds?: readonly string[] | null;
  combatStyle?: string | null;
  genre?: string | null;
  setting?: string | null;
}): GameSkillDefinition[] {
  const enabledSystemIds =
    Array.isArray(options?.enabledSystemIds) && options.enabledSystemIds.length > 0
      ? options.enabledSystemIds
      : resolveDefaultGameSkillSystemIds(options);

  const disabledSet = new Set(
    (options?.disabledSkillIds ?? []).map((id) =>
      id
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_"),
    ),
  );

  const activeSkills: GameSkillDefinition[] = [];
  const seenSkillIds = new Set<string>();

  for (const system of GAME_SKILL_SYSTEMS) {
    if (!enabledSystemIds.includes(system.id)) continue;
    for (const skill of system.skills) {
      if (seenSkillIds.has(skill.id) || disabledSet.has(skill.id)) continue;
      seenSkillIds.add(skill.id);
      activeSkills.push(skill);
    }
  }

  return activeSkills;
}

export function formatSkillsForGmPrompt(skills: readonly GameSkillDefinition[]): string {
  if (!skills || skills.length === 0) return "";
  return skills.map((s) => `- ${s.name} (${s.ability.toUpperCase()}): ${s.description}`).join("\n");
}

/** Default starting Inspiration points for a player in Game Mode. */
export const DEFAULT_STARTING_INSPIRATION = 1;

/** Maximum Inspiration points a player can hold at once. */
export const MAX_INSPIRATION_CAP = 4;

/** Matches [inspiration: +1], [inspiration: 1], [inspiration: +2], etc. */
export const INSPIRATION_TAG_REGEX = /\[inspiration:\s*\+?(\d+)[^\]]*\]/gi;

export function parseInspirationAwards(content: string): number {
  if (!content) return 0;
  const regex = new RegExp(INSPIRATION_TAG_REGEX.source, "gi");
  let total = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const amount = parseInt(match[1] ?? "0", 10);
    if (!Number.isNaN(amount) && amount > 0) {
      total += amount;
    }
  }
  return total;
}

export function stripInspirationTags(content: string): string {
  if (!content) return "";
  return content.replace(new RegExp(INSPIRATION_TAG_REGEX.source, "gi"), "").trim();
}
