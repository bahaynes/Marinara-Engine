import type { CSSProperties } from "react";
import { Dices } from "lucide-react";
import { rulesetRefSchema, type Chat } from "@marinara-engine/shared";
import { useTranslation as useUiTranslation } from "react-i18next";
import { useUpdateChatMetadata } from "../../hooks/use-chats";
import { useInstalledRulesets } from "../../hooks/use-capability-packages";
import {
  restoredRulesetLayers,
  rulesetLayerChoices,
  rulesetLayerOptions,
  toggleRulesetLayer,
} from "../../lib/ruleset-layers";
import { cn } from "../../lib/utils";
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
  // The variants the pinned ruleset ships (Inspiration, for one). They can be switched at any time here.
  const pinned = pin.success ? rulesets.find((ruleset) => ruleset.definition.id === pin.data.id) : undefined;
  const layerIds = pinned && pin.success ? restoredRulesetLayers(pinned.definition, pin.data.options) : [];
  const layerChoices = pinned ? rulesetLayerChoices(pinned.definition, layerIds) : [];

  const toggleLayer = (layerId: string) => {
    if (!pinned || !pin.success) return;
    const next = toggleRulesetLayer(pinned.definition, layerIds, layerId);
    updateMeta.mutate({ id: chat.id, gameRuleset: { ...pin.data, options: rulesetLayerOptions(next) } });
  };

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
        {layerChoices.length > 0 && (
          <div className="space-y-1.5 text-xs">
            <span className="block font-medium text-[var(--foreground)]">
              {localizeUi("game.ruleset.setup.layersHeading")}
            </span>
            <ul className="space-y-1.5">
              {layerChoices.map((choice) => (
                <li key={choice.layer.id}>
                  <label className={cn("flex items-start gap-2", choice.blockedBy && "opacity-60")}>
                    <input
                      type="checkbox"
                      checked={choice.checked}
                      disabled={Boolean(choice.blockedBy)}
                      onChange={() => toggleLayer(choice.layer.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-[var(--foreground)]">{choice.layer.label}</span>
                      {choice.layer.summary && (
                        <span className="block text-[var(--muted-foreground)]">{choice.layer.summary}</span>
                      )}
                      {choice.blockedBy && (
                        <span className="block text-[var(--muted-foreground)]">
                          {localizeUi("game.ruleset.setup.layerBlocked", { layer: choice.blockedBy.label })}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ChatSettingsSection>
  );
}
