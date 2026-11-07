# Server

Fork-only file; sections from upstream's `AGENTS.md`, loaded when working under `packages/server`.

## Logging

- **Never use `console.log/warn/error` in server code.** Always import the shared Pino logger:
  ```ts
  import { logger } from "../lib/logger.js"; // adjust relative path
  ```
- Use the correct level: `logger.error` for failures, `logger.warn` for non-fatal issues, `logger.info` for operational milestones, `logger.debug` for verbose traces (prompts, timing, state patches).
- When adding a new agent, model generation route, image generation route, or prompt-building helper, wire prompt logging before shipping it. Accept/pass UI `debugMode` where relevant, honor `DEBUG_AGENTS`, and use `logDebugOverride(...)` or an equivalent `debugLog` callback so the final prompt sent to the provider is visible in debug mode even when the default log level is not `debug`.
- Use Pino format specifiers for multi-arg calls: `logger.info("Resolved %d agents", count)` — not `logger.info("Resolved agents:", count)`.
- Log errors with the error object first: `logger.error(err, "Import failed")`.
- Client code (`packages/client/`) should keep using `console.*` — the browser has no Pino, and production builds strip `console.log` automatically.
- See `CONTRIBUTING.md § Logging` for full guidelines and `docs/CONFIGURATION.md § Logging Levels` for the user-facing reference.
