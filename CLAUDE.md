# CLAUDE.md

Fork-only file: upstream uses `AGENTS.md` as the single agent guide. Claude Code reads it through this import.

@AGENTS.md

## Fork engineering rules

- Impersonate turns are the recurring edge case (the last message may be a user message written as the character). Check every change that touches cache, state commits, trackers, or message history against an impersonate turn.
- Prefer Engine-owned logic (code-enforced gating, state, ordering) over prompt text that asks the model nicely. Propose a prompt-only fix only when code isn't viable, and say so.
- Prompt prefix order decides caching: stable content first, volatile content last.
