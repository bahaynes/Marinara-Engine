---
name: root-cause
description: Forensics for "why does Marinara keep doing X" questions where many parts interact (story drift, plots that never resolve, trackers that lie, agents that seem ignored). Use before proposing any fix when a behavior has more than one plausible cause, or when Ben says the fixes keep changing. Builds a fishbone of every cause, marks each verified or unproven from stored data, tests the unproven ones, and only then names fixes.
---

# Root cause: fishbone first, fixes last

Vibe-coded systems fail through interacting parts. Each finding looks like the cause and
suggests its own fix, so suggestions drift with whatever was read last. Map everything first.

## Order (do not skip ahead)

1. **State the effect** in one line, with the chat id and the message numbers where it shows.
2. **Draw the fishbone.** List every candidate cause under bones. Default bones for a story chat:
   Planning (Director, secret plot, card), Preset/prompt, Memory (Advanced Memory window, summaries, recall),
   Trackers/agents, Narrator model, Player input, Display (what the UI shows vs what the prompt holds).
   Mark each cause `[V]` (checked against stored data, cite where) or `[?]` (plausible, unproven).
3. **Test every `[?]`** with the cheapest read that could rule it out. Name that evidence before you look.
   A cause that fails its test moves to "ruled out" with the evidence; never drop it silently.
4. **Separate prompt-side from display-side.** A tracker or journal that shows wrong data only matters to the
   plot if that same data reaches the narrator's prompt. Check the stored prompt, not the UI.
5. **Find the through-line**: what do the surviving `[V]` causes have in common? Name the one missing
   Engine-owned mechanism, if there is one.
6. **Only now talk fixes.** Rank by how many surviving bones a fix removes. A fix for one bone is a patch;
   say so. Don't invent thresholds or counts; ask, or make them configurable.

Show the fishbone in the terminal (ASCII) unless Ben asks for a page. Update the same diagram as
causes are ruled in or out; don't start a new list each turn.

## Evidence sources (read-only, cheap first)

- Real next-turn prompt: `python3 .claude/skills/world-jam/jam.py preview <chatId>` -> `/tmp/jam/<chatId>/prompt.md`.
- Past prompts per reply: `extra.cachedPrompt` / `cachedPromptStored` on assistant messages
  (loader in `.claude/skills/fix-caching-issues/prompt_diff.py`; its swipe query breaks on long chats, so read message rows only).
  Advanced Memory lines to grep: `Present message range in the context is: #A–#B`, `Messages #A–#B; story timeframe` (recall excerpts).
- Tracker state over time: `mari db select game_state_snapshots --where "row.chatId==='<id>'"` (sort by createdAt).
- Journal: the chat row's metadata (`gameJournal`). It is display-side.
- Agent runs: `mari_agents runs` with `data: {type: "<agentType>"}`, plus Loki for errors.
- Message timing: `mari chats messages <chatId> --after-post N --limit 1 --json`.

`mari db select` caps at 100 rows silently; check the count.
