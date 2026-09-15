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
  description: "Clinical, surgical, triage, psychiatric, and hospital administration competencies.",
  skills: [
    // INT
    {
      id: "diagnostics",
      name: "Diagnostics",
      ability: "int",
      description: "Differential diagnosis, lab interpretation, uncovering hidden pathologies.",
    },
    {
      id: "pharmacology",
      name: "Pharmacology",
      ability: "int",
      description: "Drug interactions, dosages, toxicity, compounding, off-label therapies.",
    },
    {
      id: "pathology",
      name: "Pathology",
      ability: "int",
      description: "Tissue analysis, autopsy findings, biopsy interpretation, disease progression.",
    },
    {
      id: "biomedical_tech",
      name: "Biomedical Tech",
      ability: "int",
      description: "Operating telemetry, ECMO, ventilators, imaging, resolving device alarms.",
    },
    {
      id: "medical_research",
      name: "Medical Research",
      ability: "int",
      description: "Sifting clinical literature, clinical trials, and epidemiological data.",
    },
    {
      id: "pattern_recognition",
      name: "Pattern Recognition",
      ability: "int",
      description: "Spotting anomalies in vital trends, correlating disparate symptoms.",
    },

    // WIS
    {
      id: "pediatrics",
      name: "Pediatrics",
      ability: "wis",
      description: "Pediatric physiology, pediatric dosages, soothing frightened children.",
    },
    {
      id: "triage",
      name: "Triage",
      ability: "wis",
      description: "Rapid assessment under mass-casualty or ER surge, prioritizing patient care.",
    },
    {
      id: "psychiatry",
      name: "Psychiatry",
      ability: "wis",
      description: "De-escalating psychiatric crises, evaluating suicide/homicide risk, managing psychosis.",
    },
    {
      id: "clinical_intuition",
      name: "Clinical Intuition",
      ability: "wis",
      description: "Gut feeling on impending crash, noticing micro-deteriorations early.",
    },

    // CHA
    {
      id: "bedside_manner",
      name: "Bedside Manner",
      ability: "cha",
      description: "Doctor-patient rapport, breaking bad news with empathy, calming terrified families.",
    },
    {
      id: "code_leadership",
      name: "Code Leadership",
      ability: "cha",
      description: "Directing a resuscitation team during a code blue, delegating calmly under pressure.",
    },
    {
      id: "hospital_politics",
      name: "Hospital Politics",
      ability: "cha",
      description: "Navigating bureaucracy, hospital hierarchy, board meetings, and administration.",
    },
    {
      id: "de_escalation",
      name: "De-escalation",
      ability: "cha",
      description: "Defusing combative patients, hostile visitors, or staff disputes.",
    },

    // DEX
    {
      id: "surgical_technique",
      name: "Surgical Technique",
      ability: "dex",
      description: "Operative skill, delicate incisions, vascular clamping, surgical speed.",
    },
    {
      id: "procedures",
      name: "Procedures",
      ability: "dex",
      description: "Central lines, intubation, chest tubes, lumbar punctures under acute stress.",
    },
    {
      id: "suturing",
      name: "Suturing",
      ability: "dex",
      description: "Fast, cosmetically clean wound closure, layered dermal closure, tension care.",
    },
    {
      id: "reflexes",
      name: "Reflexes",
      ability: "dex",
      description: "Catching dropped instruments, needle-stick avoidance, dodging patient swings.",
    },

    // CON
    {
      id: "marathon_endurance",
      name: "Marathon Endurance",
      ability: "con",
      description: "Complex surgery during 24-hour shifts, physical stamina without sleep.",
    },
    {
      id: "shift_resilience",
      name: "Shift Resilience",
      ability: "con",
      description: "Resisting fatigue-induced diagnostic errors, managing sensory overload.",
    },
    {
      id: "biohazard_exposure",
      name: "Biohazard Exposure",
      ability: "con",
      description: "Maintaining protocol under infectious spray, caustic odors, and gore.",
    },

    // STR
    {
      id: "cpr_compressions",
      name: "CPR Compressions",
      ability: "str",
      description: "High-quality manual chest compressions, physical resuscitation stamina.",
    },
    {
      id: "orthopedic_reduction",
      name: "Orthopedic Reduction",
      ability: "str",
      description: "Setting displaced fractures, joint relocations, traction against muscle spasm.",
    },
    {
      id: "patient_restraint",
      name: "Patient Restraint",
      ability: "str",
      description: "Safely restraining violent or seizing patients without causing injury.",
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

  return isMedical ? ["medical", "dnd5e"] : ["dnd5e"];
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
