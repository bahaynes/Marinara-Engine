// custom-mods: the narrator's [task] commands move cards on the quest board (shared utils/quest-board.ts).
import {
  applyTaskCommands,
  isRoleplayCommandEnabled,
  normalizeQuestCollectionForQuestMerge,
  questBoardShortlist,
  questBoardWipLimit,
  type RoleplayCommandActivity,
  type TaskCommand,
} from "@marinara-engine/shared";
import { isDeepStrictEqual } from "node:util";
import { logger } from "../../lib/logger.js";
import type { createGameStateStorage } from "../../services/storage/game-state.storage.js";
import {
  buildLockedPlayerStatsArrayPatch,
  parseGameStateRow,
  parseSnapshotPlayerStats,
} from "./generate-route-utils.js";

type Store = ReturnType<typeof createGameStateStorage>;
type BaseSnapshot = NonNullable<Parameters<Store["updateByMessage"]>[5]>["baseSnapshot"];

/** The board is on for a Roleplay chat with the [task] command and the Quest Tracker. */
export function questBoardOn(chatMode: string, metadata: Record<string, unknown>, agentTypes: Iterable<string>) {
  return chatMode === "roleplay" && isRoleplayCommandEnabled(metadata, "task") && [...agentTypes].includes("quest");
}

/** Backlog titles to offer the narrator this turn, from the state it is writing on. */
export function taskShortlistForPrompt(
  snapshot: { playerStats?: unknown } | null | undefined,
  metadata: Record<string, unknown>,
) {
  return questBoardShortlist(
    normalizeQuestCollectionForQuestMerge(parseSnapshotPlayerStats(snapshot).activeQuests),
    questBoardWipLimit(metadata),
  );
}

export function taskCommandsFrom(activity: readonly RoleplayCommandActivity[]): TaskCommand[] {
  return activity.flatMap(({ command, deleted, error }) =>
    command.type === "task" && !deleted && !error
      ? [
          {
            action: command.action,
            title: command.title,
            ...(command.objective ? { objective: command.objective } : {}),
            ...(command.partOf ? { partOf: command.partOf } : {}),
          },
        ]
      : [],
  );
}

/**
 * After the agents: applies this reply's [task] commands and settles the board on the reply's swipe, honouring
 * field locks. Runs every board turn, so cards the tracker created this turn get a column. A failure only logs.
 */
export async function writeTaskBoardForTurn(args: {
  store: Store;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  baseSnapshot: BaseSnapshot;
  commands: readonly TaskCommand[];
  metadata: Record<string, unknown>;
  onPersisted?: (activeQuests: unknown[]) => void;
}): Promise<void> {
  try {
    let snapshot = await args.store.getByChatAndMessage(args.chatId, args.messageId, args.swipeIndex);
    const previous = normalizeQuestCollectionForQuestMerge(
      parseSnapshotPlayerStats(snapshot ?? args.baseSnapshot).activeQuests,
    );
    const board = applyTaskCommands(previous, args.commands, questBoardWipLimit(args.metadata));
    if (isDeepStrictEqual(board, previous)) return;
    if (!snapshot) {
      await args.store.updateByMessage(args.messageId, args.swipeIndex, args.chatId, {}, undefined, {
        baseSnapshot: args.baseSnapshot ?? null,
      });
      snapshot = await args.store.getByChatAndMessage(args.chatId, args.messageId, args.swipeIndex);
    }
    const locked = buildLockedPlayerStatsArrayPatch({
      field: "activeQuests",
      values: board,
      snapshot,
      lockState: snapshot ? parseGameStateRow(snapshot as Record<string, unknown>) : null,
    });
    if (!locked.changed) return;
    await args.store.updateByMessage(
      args.messageId,
      args.swipeIndex,
      args.chatId,
      { playerStats: locked.playerStats },
      undefined,
      { baseSnapshot: args.baseSnapshot ?? null },
    );
    args.onPersisted?.(locked.values);
    logger.info(
      "[task-board] chat %s msg %s swipe %d: %d command(s); %s",
      args.chatId,
      args.messageId,
      args.swipeIndex,
      args.commands.length,
      board.map((quest) => `${quest.status}:${quest.name}`).join(" | "),
    );
  } catch (err) {
    logger.warn(err, "[task-board] Could not write the quest board");
  }
}
