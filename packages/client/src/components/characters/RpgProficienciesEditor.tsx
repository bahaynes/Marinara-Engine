import { useMemo } from "react";
import { X } from "lucide-react";
import { GAME_SKILL_SYSTEMS, type GameSkillDefinition, type RPGSkillProficiency } from "@marinara-engine/shared";
import { useTranslation as useUiTranslation } from "react-i18next";

interface Props {
  value: Record<string, RPGSkillProficiency> | undefined;
  onChange: (next: Record<string, RPGSkillProficiency> | undefined) => void;
}

/** Trained skills for an RPG sheet. Stored structured so skill checks can read them without a prompt line. */
export function RpgProficienciesEditor({ value, onChange }: Props) {
  const { t: localizeUi } = useUiTranslation();
  const entries = Object.entries(value ?? {});

  const skillsById = useMemo(() => {
    const map = new Map<string, GameSkillDefinition>();
    for (const system of GAME_SKILL_SYSTEMS)
      for (const skill of system.skills) if (!map.has(skill.id)) map.set(skill.id, skill);
    return map;
  }, []);

  const write = (next: Record<string, RPGSkillProficiency>) =>
    onChange(Object.keys(next).length > 0 ? next : undefined);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">{localizeUi("ui.rpgproficiencies.title")}</h3>
        <p className="text-[0.6875rem] text-[var(--muted-foreground)]">{localizeUi("ui.rpgproficiencies.help")}</p>
      </div>

      <select
        value=""
        onChange={(e) => e.target.value && write({ ...value, [e.target.value]: "proficient" })}
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"
        aria-label={localizeUi("ui.rpgproficiencies.addSkill")}
      >
        <option value="">{localizeUi("ui.rpgproficiencies.addSkill")}</option>
        {GAME_SKILL_SYSTEMS.map((system) => (
          <optgroup key={system.id} label={system.name}>
            {system.skills
              .filter((skill) => !value?.[skill.id])
              .map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name} ({skill.ability.toUpperCase()})
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      <div className="space-y-2">
        {entries.map(([id, kind]) => {
          const skill = skillsById.get(id);
          const label = skill ? `${skill.name} (${skill.ability.toUpperCase()})` : id;
          return (
            <div
              key={id}
              className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
              <select
                value={kind}
                onChange={(e) => write({ ...value, [id]: e.target.value as RPGSkillProficiency })}
                className="rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs"
                aria-label={localizeUi("ui.rpgproficiencies.levelFor", { value1: label })}
              >
                <option value="proficient">{localizeUi("ui.rpgproficiencies.proficient")}</option>
                <option value="expertise">{localizeUi("ui.rpgproficiencies.expertise")}</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  const { [id]: _removed, ...rest } = value ?? {};
                  write(rest);
                }}
                className="rounded-lg p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--primary)]/15 hover:text-[var(--primary)]"
                aria-label={localizeUi("ui.rpgproficiencies.remove", { value1: label })}
              >
                <X size="0.75rem" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
