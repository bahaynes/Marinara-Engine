import type { CSSProperties } from "react";
import { Dices } from "lucide-react";
import { rulesetRefSchema, type Chat } from "@marinara-engine/shared";
import { useTranslation as useUiTranslation } from "react-i18next";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useInstalledRulesets } from "../../hooks/use-capability-packages";
import { ChatSettingsSection } from "../../features/chat-settings/ChatSettingsSection";

/** Pins an installed ruleset to a roleplay chat. `[roll: ...]` skill checks then take their
 *  modifiers from each character's ruleset sheet; no pin means plain dice. The pin is the same
 *  `gameRuleset` a game uses, built the way `createRulesetRef` builds it on the server. */
export function RoleplayRulesetSettings({ chat, style }: { chat: Chat; style?: CSSProperties }) {
  const { t: localizeUi } = useUiTranslation();
  const updateMeta = useUpdateChatMetadata({ serialize: true });
  const installed = useInstalledRulesets();
  const rulesets = installed.data ?? [];
  const pin = rulesetRefSchema.safeParse(chat.metadata.gameRuleset);
  const pinnedId = pin.success ? pin.data.id : "";

  const choose = (id: string) => {
    const entry = rulesets.find((ruleset) => ruleset.definition.id === id);
    updateMeta.mutate({
      id: chat.id,
      gameRuleset: entry
        ? {
            id: entry.definition.id,
            version: entry.definition.version,
            packageId: entry.packageId,
            ...(entry.source?.url ? { source: entry.source.url } : {}),
            options: {},
          }
        : null,
    });
  };

  return (
    <ChatSettingsSection
      id={`${chat.mode}-skill-checks`}
      style={style}
      label={localizeUi("ui.chat.roleplayrulesetsettings.skillChecks")}
      icon={<Dices size="0.875rem" />}
      help={localizeUi("ui.chat.roleplayrulesetsettings.skillChecksHelp")}
      contentClassName="pt-1.5"
    >
      <div className="space-y-2">
        <select
          aria-label={localizeUi("ui.chat.roleplayrulesetsettings.ruleset")}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-xs"
          value={pinnedId}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">{localizeUi("ui.chat.roleplayrulesetsettings.none")}</option>
          {pinnedId && !rulesets.some((ruleset) => ruleset.definition.id === pinnedId) && (
            <option value={pinnedId}>{pinnedId}</option>
          )}
          {rulesets.map((ruleset) => (
            <option key={ruleset.definition.id} value={ruleset.definition.id}>
              {ruleset.definition.name}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-[var(--muted-foreground)]">
          {localizeUi(
            pinnedId ? "ui.chat.roleplayrulesetsettings.sheetsHint" : "ui.chat.roleplayrulesetsettings.plainDice",
          )}
        </p>
      </div>
    </ChatSettingsSection>
  );
}
