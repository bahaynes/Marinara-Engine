// custom-mods: the inventory parts of the Game Master's prompt context, moved out of the generate route
// so a Roleplay chat pinned to a ruleset tells its bags exactly as Game Mode does.
import {
  gameInventoryBagKey,
  gameInventoryBags,
  gameInventoryBearerStatus,
  gameInventoryFoldStandIn,
  gameInventoryTotals,
  rulesetChargesStart,
  rulesetItemPromptFacts,
  rulesetPurseText,
  type GameInventoryStack,
  type RulesetItemBook,
} from "@marinara-engine/shared";
import type { GmInventoryPromptContext } from "./gm-prompts.js";

/** What each bag holds and what its ruleset items are, for `gmInventoryListLines`. */
export function gmInventoryPromptParts(
  promptInventoryStacks: GameInventoryStack[],
  promptItemBook: RulesetItemBook | undefined,
  gameStandIn: string | undefined,
): Partial<GmInventoryPromptContext> {
  // What each character carries, binds and wears against what they can, when the ruleset says.
  const promptBearers =
    promptItemBook?.bearer || promptItemBook?.slots
      ? Object.fromEntries(
          [undefined, ...new Set(promptInventoryStacks.flatMap((stack) => (stack.holder ? [stack.holder] : [])))].map(
            (holder) => [
              gameInventoryBagKey(holder),
              gameInventoryBearerStatus(promptInventoryStacks, holder, promptItemBook),
            ],
          ),
        )
      : undefined;
  // What each bag's coins are worth, family by family, where the ruleset has coins.
  const promptPurses = promptItemBook?.coins.length
    ? Object.fromEntries(
        [undefined, ...new Set(promptInventoryStacks.flatMap((stack) => (stack.holder ? [stack.holder] : [])))].map(
          (holder) => [gameInventoryBagKey(holder), rulesetPurseText(promptItemBook, promptInventoryStacks, holder)],
        ),
      )
    : undefined;
  // A fake's facts are what it truly is, which only the Game Master reads (1.79).
  const promptItemFacts = promptItemBook
    ? Object.fromEntries(
        promptInventoryStacks.flatMap((stack) =>
          [stack.item, stack.truly].flatMap((ref) => {
            const known = ref ? promptItemBook.itemOf(ref) : undefined;
            return known ? [[known.item, rulesetItemPromptFacts(known.facts, known.summary)]] : [];
          }),
        ),
      )
    : undefined;
  const promptFakeNames = promptItemBook
    ? Object.fromEntries(
        promptInventoryStacks.flatMap((stack) => {
          const known = stack.truly ? promptItemBook.itemOf(stack.truly) : undefined;
          return known ? [[known.item, known.name]] : [];
        }),
      )
    : undefined;
  // What each stack of an item that holds charges has left: its kept count, or all of them.
  const promptCharges = promptItemBook
    ? (stack: (typeof promptInventoryStacks)[number]) => {
        const held = stack.item ? promptItemBook.itemOf(stack.item)?.facts.use?.charges : undefined;
        const max = held?.max;
        // Found with rolled charges (1.573) until something changed them.
        const now = stack.charges ?? (held ? rulesetChargesStart(held, held.max, stack.id) : 0);
        return max === undefined ? undefined : { now: Math.min(max, now), max };
      }
    : undefined;
  return {
    // One line per item with its total, so a stack the player split reads as one thing,
    // and the same per bag once anybody else in the party carries something.
    playerInventory: (() => {
      const inv = gameInventoryTotals(promptInventoryStacks, promptCharges);
      return inv.length > 0 ? inv : undefined;
    })(),
    partyInventory: gameInventoryBags(gameInventoryFoldStandIn(promptInventoryStacks, gameStandIn), promptCharges),
    ...(gameStandIn ? { playerBagName: gameStandIn } : {}),
    ...(promptItemFacts ? { inventoryItemFacts: promptItemFacts } : {}),
    ...(promptFakeNames && Object.keys(promptFakeNames).length > 0 ? { inventoryFakeNames: promptFakeNames } : {}),
    ...(promptBearers ? { inventoryBearers: promptBearers } : {}),
    ...(promptPurses ? { inventoryPurses: promptPurses } : {}),
  };
}
