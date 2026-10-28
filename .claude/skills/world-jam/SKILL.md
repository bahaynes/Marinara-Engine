---
name: world-jam
description: Jam on a live Marinara chat's world with Ben - lore, cards, personas, presets, story direction - and write agreed facts into the instance. Use when he wants to worldbuild, asks why a reply drifted from the lore, wants a card/persona/lorebook/preset changed, or asks "why did the narrator say X". Includes jam.py, which reads a chat's whole world in one call so these conversations stay cheap.
---

# World jam

A conversation about a story's world, with the live instance as the canvas. Ben
plays on `marinara` (default; `marinara-wife` only when he says so, and only with
Erin's confirmation). Use `manage-marinara` for anything beyond this skill.

## Which conversation is this?

Decide from his last message, and say so in one line if it is ambiguous:

| Mode | Signals | What you do |
|---|---|---|
| **Jam** | "what if", "I liked", questions about the world, enjoying it | Offer ideas and open questions. Write facts only once he agrees to them. |
| **Diagnose** | "why did it say X", "this is drifting", a pasted reply | Find the cause in the bundle or prompt before theorising. Separate lore gaps, prompt rules, and model error. |
| **Engine** | the cause is code, a missing feature, or a bug | Switch to normal repo work (`custom-mods` skill). Say you are switching. |

Never end a jam turn with a sign-off. End on the open threads (two to four
concrete questions or next steps). He decides when the session ends.

## Read the world once: `jam.py`

```bash
J=.claude/skills/world-jam/jam.py
python3 $J bundle <chatId> [--last 12]   # -> /tmp/jam/<chatId>/{chat,cards,persona,lore,preset,messages,active}.md
python3 $J preview <chatId>              # -> prompt.md: the exact prompt the next turn sends, plus an outline
```

- Run `bundle` once at the start, then `Read`/`grep` the file you need. Do not
  re-query `mari` for what the bundle already holds. Re-run it after edits or
  when he has played more turns.
- Every heading carries `[table id]`, so edits need no lookup.
- `lore.md` has full entry text. (`mari lorebooks entries` cuts it at 200 chars.)
- `active.md` is what the engine's own scan activates right now.
- `preview` is the ground truth when the question is "what did the model see".
  Read only the slices you need (`grep -n` then `Read` with offset).
- Find a chat id with `docker exec -i marinara mari chats list --limit 10`.

## Edit exactly what was agreed

```bash
python3 $J edit <table> <id> <field> --old "exact text" --new "replacement"          # dry run
python3 $J edit <table> <id> <field> --old "exact text" --new "replacement" --apply --reason "..."
```

`field` can be a dotted path into a JSON column (`data.description`,
`data.extensions.backstory`, `data.post_history_instructions`). The edit refuses
unless `--old` occurs exactly once. Applied writes are reversible from the review
card. Show Ben the before and after.

Rules for content:
- **His premise wins.** Change only lines that contradict what he said. Ask for
  the premise when it is missing; do not fill the gap with your own.
- **Invent when invited**, inside his premise, and show exactly what you wrote.
- **Lore gaps cause drift.** When a reply makes up a number, age, date or
  history that the lore does not pin, the fix is usually one lore line with his
  answer, not a prompt rule. Ask him for the fact.
- Phrase lore and card rules positively; never name the behaviour you want
  gone. No concrete noun lists the model will fixate on.
- Logic (counting, gating, state) belongs in Engine code, not in prompt text.

## Cache cost of an edit

Every edit to text that is in every prompt costs one full cache rebuild per
affected chat. Say which bucket an edit is in:
- always in the prompt, before history: preset sections, card, persona,
  constant lore entries. One miss per chat that uses it (presets can span dozens
  of chats; count them with `mari db select chats --where "row.promptPresetId === '<id>'"`).
- keyword lore, scenario entries, post-history, depth-0 sections: after history,
  so they are cheap.
Batch related edits so a chat pays the miss once.

## Presets: Chesterton's fence

Before removing or rewriting a preset line, find why it is there:
1. Compare with upstream's default preset, `packages/server/src/db/default-preset.json`
   (Marinara's Universal Preset), and its history
   (`git log -S"<phrase>" -- packages/server/src/db/default-preset.json`).
2. A line that names machinery ("sanitation engine", "state buffer") must match
   real code. `grep -rn` the server for it; if nothing handles it, it is noise.
3. Prefer restoring upstream's tested wording over writing new rules. Keep
   deliberate fork choices (ask if unsure) and the section order and placement,
   which carry the cache layout.
4. Variables are choice blocks (`choice_blocks` table). A stored choice whose
   value no longer matches any option falls back to the first option.
