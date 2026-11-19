// custom-mods: the Quest Tracker as a task board with a work-in-progress limit.
// The Engine owns the columns: the narrator sees only active cards as its current tasks, new threads past the
// limit wait in the backlog, and a finished card stays finished. Turned on by the roleplay [task] command.
import type { QuestBoardStatus, QuestProgress } from "../types/game-state.js";
import { normalizeTextForMatch } from "./text-matching.js";

/** Ben's starting point (a GM leaves three clues). Per chat: metadata.questBoardWipLimit. */
export const DEFAULT_QUEST_BOARD_WIP_LIMIT = 3;

export type TaskCommand = { action: "done" | "propose" | "start"; title: string; objective?: string };

export function questBoardWipLimit(metadata: Record<string, unknown>): number {
  const value = metadata.questBoardWipLimit;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : DEFAULT_QUEST_BOARD_WIP_LIMIT;
}

/** A card's column. Cards from before the board have none: finished ones are done, the rest active. */
export function questBoardStatus(quest: QuestProgress): QuestBoardStatus {
  if (quest.completed) return "done";
  return quest.status === "active" || quest.status === "backlog" || quest.status === "done" ? quest.status : "active";
}

/** Whether these cards are on a board (any card carries a column). */
export function isQuestBoard(quests: readonly QuestProgress[]): boolean {
  return quests.some((quest) => quest.status !== undefined);
}

const sameTitle = (a: string, b: string) => normalizeTextForMatch(a) === normalizeTextForMatch(b);

function close(quest: QuestProgress): QuestProgress {
  return { ...quest, completed: true, status: "done" };
}

/**
 * Puts every card in a column. A card whose objectives are all ticked is done. A card without a column (new from
 * the tracker, or from before the board) is active while there is room, otherwise it waits in the backlog.
 * When nothing is active, the oldest backlog card starts, so the board never stalls.
 */
export function settleQuestBoard(quests: readonly QuestProgress[], wipLimit: number): QuestProgress[] {
  const settled = quests.map((quest) => {
    const allTicked = quest.objectives.length > 0 && quest.objectives.every((objective) => objective.completed);
    if (quest.completed || allTicked) return close(quest);
    return { ...quest };
  });
  let active = settled.filter((quest) => quest.status === "active").length;
  for (const quest of settled) {
    if (quest.status !== undefined) continue;
    quest.status = active < wipLimit ? "active" : "backlog";
    if (quest.status === "active") active++;
  }
  if (active === 0) {
    const next = settled.find((quest) => quest.status === "backlog");
    if (next) next.status = "active";
  }
  return settled;
}

/** Applies the narrator's [task] commands, then settles the board. Unknown titles are ignored. */
export function applyTaskCommands(
  quests: readonly QuestProgress[],
  commands: readonly TaskCommand[],
  wipLimit: number,
): QuestProgress[] {
  let board = settleQuestBoard(quests, wipLimit);
  for (const command of commands) {
    const index = board.findIndex((quest) => sameTitle(quest.name, command.title));
    const card = index >= 0 ? board[index]! : null;
    if (command.action === "propose") {
      // ponytail: duplicates are caught by exact title only. Upgrade: the checker answers "same as card X?".
      if (!card)
        board.push({
          questEntryId: command.title,
          name: command.title,
          currentStage: 0,
          objectives: [],
          completed: false,
          status: "backlog",
        });
    } else if (command.action === "start") {
      const active = board.filter((quest) => quest.status === "active").length;
      if (card?.status === "backlog" && active < wipLimit) board[index] = { ...card, status: "active" };
    } else if (card && card.status === "active") {
      // done: a card, or one of its objectives when objective="..." names it.
      board[index] = command.objective
        ? {
            ...card,
            objectives: card.objectives.map((objective) =>
              sameTitle(objective.text, command.objective!) ? { ...objective, completed: true } : objective,
            ),
          }
        : close(card);
    }
    board = settleQuestBoard(board, wipLimit);
  }
  return board;
}

/** Backlog titles the narrator may start, offered only while an active slot is free. */
export function questBoardShortlist(quests: readonly QuestProgress[], wipLimit: number): string[] {
  if (!isQuestBoard(quests)) return [];
  const active = quests.filter((quest) => questBoardStatus(quest) === "active").length;
  if (active >= wipLimit) return [];
  return quests.filter((quest) => questBoardStatus(quest) === "backlog").map((quest) => quest.name);
}

/** The board as the narrator sees it: current tasks with objectives, and closed titles. The backlog stays out. */
export function questBoardPromptLines(quests: readonly QuestProgress[]): { current: string[]; closed: string[] } {
  const current: string[] = [];
  const closed: string[] = [];
  for (const quest of quests) {
    const status = questBoardStatus(quest);
    if (status === "done") closed.push(`- ${quest.name}`);
    if (status !== "active") continue;
    const objectives = quest.objectives.map(
      (objective) => `  ${objective.completed ? "[x]" : "[ ]"} ${objective.text}`,
    );
    current.push([`- ${quest.name}`, ...objectives].join("\n"));
  }
  // ponytail: every closed card is listed for the whole chat. Upgrade: list the latest few once that grows long.
  return { current, closed };
}
