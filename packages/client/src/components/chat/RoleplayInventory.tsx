// ──────────────────────────────────────────────
// custom-mods: Game Mode's inventory in a Roleplay chat played by a ruleset
// ──────────────────────────────────────────────
// Every ruleset card carries its own bag, as in Game Mode. The narrator changes them with [inventory:]
// tags; here the player looks, adds the ruleset's items, wears them and hands them over, through Game
// Mode's own inventory screen and route.
import { useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation as useUiTranslation } from "react-i18next";
import {
  gameInventoryBagKey,
  normalizeGameInventoryStacks,
  rulesetCardHolder,
  type GameInventoryOp,
  type GameInventoryOpResult,
  type GameInventoryStack,
  type GameInventoryWear,
  type RulesetItemBookEntry,
} from "@marinara-engine/shared";
import { GameInventory, type InventoryBag } from "../game/GameInventory";
import { roleplaySheetNames } from "./RoleplayRuleset";
import { api } from "../../lib/api-client";
import { describeGameInventoryRefusal } from "../../lib/game-inventory-refusal";
import { chatKeys, claimChatMetadataFields } from "../../hooks/use-chats";
import { usePersona } from "../../hooks/use-characters";
import { useGameRuleset } from "../../hooks/use-game-ruleset";
import { useRulesetItemBook } from "../../hooks/use-ruleset-item-book";
import { useRoleplayInventoryStore } from "../../stores/roleplay-inventory.store";

export function RoleplayInventory({
  chatId,
  personaId,
  metadata,
}: {
  chatId: string;
  personaId: string | null;
  metadata: Record<string, unknown>;
}) {
  const { t: localizeUi } = useUiTranslation();
  const queryClient = useQueryClient();
  const close = useRoleplayInventoryStore((state) => state.close);
  const resolved = useGameRuleset(metadata);
  const book = useRulesetItemBook(resolved, undefined, metadata.gameInventedItems);
  const persona = usePersona(personaId);
  const stacks = useMemo(() => normalizeGameInventoryStacks(metadata.gameInventory), [metadata.gameInventory]);
  const names = useMemo(() => roleplaySheetNames(metadata), [metadata]);

  // The player's card reads the bag with no holder, as the server's tags and fights read it.
  const bags = useMemo<InventoryBag[]>(() => {
    const holderOf = rulesetCardHolder(names, persona.data?.name ?? null);
    const seen = new Set<string>();
    const out: InventoryBag[] = [];
    for (const name of names) {
      const holder = holderOf(name) ?? undefined;
      const key = gameInventoryBagKey(holder);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(holder ? { holder, name } : { name });
    }
    for (const stack of stacks) {
      if (!stack.holder || seen.has(gameInventoryBagKey(stack.holder))) continue;
      seen.add(gameInventoryBagKey(stack.holder));
      out.push({ holder: stack.holder, name: stack.holder });
    }
    return out.length ? out : [{ name: localizeUi("ui.game.gameinventory.you") }];
  }, [names, persona.data?.name, stacks, localizeUi]);

  // ponytail: each change is posted and the chat read again; Game Mode's screen also orders answers
  // that cross on the way. Upgrade path: share GameSurface's sendInventory sequencing.
  const commit = useCallback(
    async (ops: GameInventoryOp[]): Promise<GameInventoryOpResult[]> => {
      claimChatMetadataFields(chatId, ["gameInventory", "gameJournal"]);
      await queryClient.cancelQueries({ queryKey: chatKeys.detail(chatId) });
      try {
        const response = await api.post<{ inventory: GameInventoryStack[]; results: GameInventoryOpResult[] }>(
          "/game/inventory",
          { chatId, ops },
        );
        return response?.results ?? [];
      } finally {
        void queryClient.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      }
    },
    [chatId, queryClient],
  );

  const refused = (result: GameInventoryOpResult | undefined, name: string, key: string, who?: string) => {
    toast.error(
      describeGameInventoryRefusal(localizeUi, result && !result.ok ? result.reason : undefined, name, key, who),
    );
    return null;
  };
  const labelOf = (id: string) => {
    const stack = stacks.find((entry) => entry.id === id);
    return stack?.nickname ?? stack?.name ?? "";
  };

  const run = async (ops: GameInventoryOp[], name: string, key: string, who?: string): Promise<string | null> => {
    try {
      const [result] = await commit(ops);
      if (!result?.ok) return refused(result, name, key, who);
      return result.id ?? null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : localizeUi(key, { value1: name }));
      return null;
    }
  };

  const definition = resolved.status === "ok" ? resolved.definition : undefined;
  return createPortal(
    <div className="relative z-[10000]">
      <GameInventory
        items={stacks}
        bags={bags}
        open
        onClose={close}
        itemBook={book}
        rulesetDefinition={definition}
        canInteract
        onAddItem={(name, holder) =>
          run(
            [{ op: "add", name, count: 1, holder }],
            name,
            "ui.game.gamesurfacecomponent.failedToAddValue1ToInventory",
            holder ?? "",
          )
        }
        onAddRulesetItems={async (picks: RulesetItemBookEntry[], holder) => {
          const shown = picks.map((pick) => pick.name).join(", ");
          try {
            const results = await commit(
              picks.map((pick) => ({ op: "add" as const, name: pick.name, item: pick.item, count: 1, holder })),
            );
            const bad = results.find((result) => !result?.ok);
            if (bad) refused(bad, shown, "ui.game.gamesurfacecomponent.failedToAddValue1ToInventory", holder ?? "");
            const last = [...results].reverse().find((result) => result?.ok);
            return last?.ok ? (last.id ?? null) : null;
          } catch (error) {
            toast.error(error instanceof Error ? error.message : shown);
            return null;
          }
        }}
        onWearItem={(stackId, wear: GameInventoryWear) =>
          run([{ op: wear, id: stackId }], labelOf(stackId), "ui.game.gamesurfacecomponent.failedToChangeValue1")
        }
        onGiveItem={(stackId, to, count) =>
          run(
            [{ op: "give", id: stackId, ...(to ? { to } : {}), ...(count ? { count } : {}) }],
            labelOf(stackId),
            "ui.game.gamesurfacecomponent.failedToChangeValue1",
          )
        }
        onSetItemQuantity={async (stackId, quantity) => {
          await run(
            [{ op: "set", id: stackId, quantity }],
            labelOf(stackId),
            "ui.game.gamesurfacecomponent.failedToChangeValue1",
          );
        }}
      />
    </div>,
    document.body,
  );
}
