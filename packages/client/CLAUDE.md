# Client

Fork-only file; sections from upstream's `AGENTS.md`, loaded when working under `packages/client`.

## Frontend Changes

- **Read `packages/client/.instructions.md` before editing any client code.** It is the authoritative reference for architecture, patterns, conventions, and common-mistake avoidance.
- Treat localization as part of every client UI change. New or changed user-facing labels, messages, tooltips, placeholders, toasts, confirmations, accessibility text, tutorials, and similar copy must use semantic localization keys and update the canonical English catalog in the same change. Community locale files are intentionally partial: update only translations the contributor can responsibly supply, and let missing keys fall back to English. Never touch every bundled locale merely to copy English or satisfy key parity. Do not translate model prompts or user-authored content. Run `pnpm localization:check` before shipping.
- Validate with `pnpm check` (TypeScript + ESLint). Use `pnpm regression:prompt` for prompt/lorebook/macro regressions and `pnpm smoke:ui` for the browser shell smoke suite when the change touches those areas.
- Client code keeps using `console.*`: the browser has no Pino, and production builds strip `console.log` automatically.
