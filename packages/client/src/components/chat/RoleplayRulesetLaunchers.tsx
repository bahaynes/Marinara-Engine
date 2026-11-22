// ──────────────────────────────────────────────
// custom-mods: the ruleset buttons a Roleplay chat's tracker panels carry
//
// A Roleplay chat played by a ruleset gets a button for its first sheet (the persona's) and, when the
// ruleset has items, one for the party's bags. Both the tracker window and the docked tracker panel
// show them, so the sheets and the inventory are a click away from the trackers.
// ──────────────────────────────────────────────
import { useMemo } from "react";
import { Backpack, ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chat.store";
import { useGameRuleset } from "../../hooks/use-game-ruleset";
import { parseChatMetadata } from "../../lib/chat-display";
import { useRoleplaySheetStore } from "../../stores/roleplay-sheet.store";
import { useRoleplayInventoryStore } from "../../stores/roleplay-inventory.store";
import { roleplaySheetNames } from "./RoleplayRuleset";

/** The first sheet's name, and whether the pinned ruleset has items; nothing for a chat with no pin. */
export function useRoleplayRulesetLaunch(chatId: string | null) {
  const rawMetadata = useChatStore((s) =>
    chatId && s.activeChat?.id === chatId && s.activeChat.mode === "roleplay" ? s.activeChat.metadata : null,
  );
  const metadata = useMemo(() => (rawMetadata ? parseChatMetadata(rawMetadata) : null), [rawMetadata]);
  const ruleset = useGameRuleset(metadata);
  const firstSheet = metadata?.gameRuleset != null ? (roleplaySheetNames(metadata)[0] ?? null) : null;
  return { firstSheet, hasItems: !!firstSheet && ruleset.status === "ok" && !!ruleset.definition.items };
}

export function RoleplayRulesetLauncherButtons({
  chatId,
  firstSheet,
  hasItems,
  buttonClassName,
}: {
  chatId: string;
  firstSheet: string | null;
  hasItems: boolean;
  buttonClassName: string;
}) {
  const { t } = useTranslation();
  if (!firstSheet) return null;
  const sheetLabel = t("chat.settings.ruleset.openSheetOf", { name: firstSheet });
  const inventoryLabel = t("chat.settings.ruleset.openInventory");
  return (
    <>
      <button
        type="button"
        aria-label={sheetLabel}
        title={sheetLabel}
        onClick={() => useRoleplaySheetStore.getState().show({ chatId, name: firstSheet, build: false })}
        className={buttonClassName}
      >
        <ScrollText size="0.875rem" aria-hidden="true" />
      </button>
      {hasItems && (
        <button
          type="button"
          aria-label={inventoryLabel}
          title={inventoryLabel}
          onClick={() => useRoleplayInventoryStore.getState().show(chatId)}
          className={buttonClassName}
        >
          <Backpack size="0.875rem" aria-hidden="true" />
        </button>
      )}
    </>
  );
}
