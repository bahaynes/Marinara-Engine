import { useMemo, useState } from "react";
import { BookOpen, Check, Search } from "lucide-react";
import {
  GAME_SKILL_SYSTEMS,
  resolveDefaultGameSkillSystemIds,
  type Chat,
  type GameAbilityKey,
  type GameSkillDefinition,
} from "@marinara-engine/shared";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { cn } from "../../lib/utils";
import { AgentSettingsCard } from "./AgentSettingsControls";
import { SettingsSwitch } from "../panels/settings/SettingControls";
import { useTranslation as useUiTranslation } from "react-i18next";

const ABILITY_COLORS: Record<GameAbilityKey, { bg: string; text: string; border: string }> = {
  str: { bg: "bg-red-500/10 dark:bg-red-500/20", text: "text-red-600 dark:text-red-400", border: "border-red-500/30" },
  dex: {
    bg: "bg-emerald-500/10 dark:bg-emerald-500/20",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-500/30",
  },
  con: {
    bg: "bg-orange-500/10 dark:bg-orange-500/20",
    text: "text-orange-600 dark:text-orange-400",
    border: "border-orange-500/30",
  },
  int: {
    bg: "bg-blue-500/10 dark:bg-blue-500/20",
    text: "text-blue-600 dark:text-blue-400",
    border: "border-blue-500/30",
  },
  wis: {
    bg: "bg-purple-500/10 dark:bg-purple-500/20",
    text: "text-purple-600 dark:text-purple-400",
    border: "border-purple-500/30",
  },
  cha: {
    bg: "bg-amber-500/10 dark:bg-amber-500/20",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/30",
  },
};

const ABILITY_TABS: Array<{ key: "all" | GameAbilityKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "int", label: "INT" },
  { key: "wis", label: "WIS" },
  { key: "cha", label: "CHA" },
  { key: "dex", label: "DEX" },
  { key: "con", label: "CON" },
  { key: "str", label: "STR" },
];

export function GameSkillSystemsSettings({ chat }: { chat: Chat }) {
  const { t: localizeUi } = useUiTranslation();
  const updateMeta = useUpdateChatMetadata({ serialize: true });
  const metadata = chat.metadata;

  const [search, setSearch] = useState("");
  const [selectedAbility, setSelectedAbility] = useState<"all" | GameAbilityKey>("all");

  const defaultSystems = useMemo(
    () =>
      resolveDefaultGameSkillSystemIds({
        combatStyle: metadata.combatStyle as string | null,
        genre: metadata.gameGenre as string | null,
        setting: metadata.gameSetting as string | null,
      }),
    [metadata.combatStyle, metadata.gameGenre, metadata.gameSetting],
  );

  const activeSystemIds = useMemo(() => {
    if (Array.isArray(metadata.gameSkillSystems) && metadata.gameSkillSystems.length > 0) {
      return metadata.gameSkillSystems as string[];
    }
    return defaultSystems;
  }, [metadata.gameSkillSystems, defaultSystems]);

  const disabledSkillIds = useMemo(() => {
    if (Array.isArray(metadata.gameDisabledSkills)) {
      return new Set((metadata.gameDisabledSkills as string[]).map((id) => id.toLowerCase()));
    }
    return new Set<string>();
  }, [metadata.gameDisabledSkills]);

  const toggleSystem = (systemId: string) => {
    const isCurrentlyActive = activeSystemIds.includes(systemId);
    let nextSystems: string[];
    if (isCurrentlyActive) {
      nextSystems = activeSystemIds.filter((id) => id !== systemId);
    } else {
      nextSystems = [...activeSystemIds, systemId];
    }
    // Prevent having zero active systems
    if (nextSystems.length === 0) {
      nextSystems = [systemId];
    }
    updateMeta.mutate({
      id: chat.id,
      gameSkillSystems: nextSystems,
    });
  };

  const toggleSkill = (skillId: string) => {
    const nextDisabled = new Set(disabledSkillIds);
    if (nextDisabled.has(skillId.toLowerCase())) {
      nextDisabled.delete(skillId.toLowerCase());
    } else {
      nextDisabled.add(skillId.toLowerCase());
    }
    updateMeta.mutate({
      id: chat.id,
      gameDisabledSkills: Array.from(nextDisabled),
    });
  };

  const displayedSkills = useMemo(() => {
    const allSkills: Array<GameSkillDefinition & { systemName: string }> = [];
    const seen = new Set<string>();

    for (const sys of GAME_SKILL_SYSTEMS) {
      if (!activeSystemIds.includes(sys.id)) continue;
      for (const skill of sys.skills) {
        if (seen.has(skill.id)) continue;
        seen.add(skill.id);
        allSkills.push({ ...skill, systemName: sys.name });
      }
    }

    return allSkills.filter((skill) => {
      if (selectedAbility !== "all" && skill.ability !== selectedAbility) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.ability.toLowerCase().includes(q)
      );
    });
  }, [activeSystemIds, selectedAbility, search]);

  const totalActiveSkillCount = useMemo(() => {
    let count = 0;
    const seen = new Set<string>();
    for (const sys of GAME_SKILL_SYSTEMS) {
      if (!activeSystemIds.includes(sys.id)) continue;
      for (const skill of sys.skills) {
        if (!seen.has(skill.id) && !disabledSkillIds.has(skill.id)) {
          seen.add(skill.id);
          count++;
        }
      }
    }
    return count;
  }, [activeSystemIds, disabledSkillIds]);

  return (
    <div className="mb-3" data-game-skill-systems>
      <AgentSettingsCard
        id={`${chat.id}:game-skill-systems`}
        icon={<BookOpen size="0.75rem" className="mt-0.5 text-[var(--primary)]" />}
        title={localizeUi("ui.chat.gameskillsystemssettings.skillSystemsRepertoire")}
        description={localizeUi("ui.chat.gameskillsystemssettings.value1ActiveSkillsInGmCheckRepertoire", {
          value1: totalActiveSkillCount,
        })}
        initialOpen={false}
      >
        <div className="space-y-3 pt-1">
          {/* System Toggles */}
          <div className="space-y-2">
            <span className="text-[11px] font-medium tracking-wide uppercase text-[var(--muted-foreground)]">
              {localizeUi("ui.chat.gameskillsystemssettings.activeSkillSystems")}
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {GAME_SKILL_SYSTEMS.map((system) => {
                const isActive = activeSystemIds.includes(system.id);
                return (
                  <div
                    key={system.id}
                    className={cn(
                      "flex flex-col justify-between rounded-lg border p-2.5 transition-colors",
                      isActive
                        ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                        : "border-[var(--border)] bg-[var(--background)]/60 opacity-70",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-[var(--foreground)]">{system.name}</span>
                          <span className="rounded bg-[var(--muted)] px-1.5 py-0.2 text-[10px] text-[var(--muted-foreground)]">
                            {system.skills.length} {localizeUi("ui.chat.gameskillsystemssettings.skills")}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] leading-tight text-[var(--muted-foreground)]">
                          {system.description}
                        </p>
                      </div>
                      <SettingsSwitch
                        ariaLabel={system.name}
                        checked={isActive}
                        onChange={() => toggleSystem(system.id)}
                        className="scale-90"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Search & Ability Filters */}
          <div className="space-y-2 pt-1">
            <div className="relative">
              <Search
                size="0.75rem"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={localizeUi("ui.chat.gameskillsystemssettings.searchSkillsEGDiagnosticsPoliticsPerception")}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] py-1.5 pl-8 pr-3 text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
              />
            </div>

            {/* Ability Filter Chips */}
            <div className="flex flex-wrap gap-1">
              {ABILITY_TABS.map((tab) => {
                const isSelected = selectedAbility === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setSelectedAbility(tab.key)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                      isSelected
                        ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Skills Glossary List */}
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {displayedSkills.length === 0 ? (
              <div className="py-4 text-center text-xs text-[var(--muted-foreground)]">
                {localizeUi("ui.chat.gameskillsystemssettings.noMatchingSkillsFound")}
              </div>
            ) : (
              displayedSkills.map((skill) => {
                const isDisabled = disabledSkillIds.has(skill.id.toLowerCase());
                const color = ABILITY_COLORS[skill.ability] ?? {
                  bg: "bg-gray-500/10",
                  text: "text-gray-500",
                  border: "border-gray-500/30",
                };

                return (
                  <div
                    key={skill.id}
                    onClick={() => toggleSkill(skill.id)}
                    className={cn(
                      "group flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border)]/70 p-2 text-left transition-colors hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]/40",
                      isDisabled && "opacity-40 grayscale",
                    )}
                  >
                    <div className="mt-0.5 shrink-0">
                      <div
                        className={cn(
                          "flex h-4 w-4 items-center justify-center rounded border transition-colors",
                          !isDisabled
                            ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                            : "border-[var(--border)] bg-[var(--background)]",
                        )}
                      >
                        {!isDisabled && <Check size="0.65rem" strokeWidth={3} />}
                      </div>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-[var(--foreground)]">{skill.name}</span>
                        <span
                          className={cn(
                            "rounded border px-1 py-0.1 text-[9px] font-bold uppercase tracking-wider",
                            color.bg,
                            color.text,
                            color.border,
                          )}
                        >
                          {skill.ability}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] leading-tight text-[var(--muted-foreground)]">
                        {skill.description}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </AgentSettingsCard>
    </div>
  );
}
