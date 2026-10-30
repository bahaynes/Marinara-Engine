#!/usr/bin/env node
// ──────────────────────────────────────────────
// Marinara Engine MCP Server (stdio JSON-RPC 2.0)
// Gives agy / Claude Code an explicit tool list for Marinara's mari-db APIs
// (/api/professor-mari/workspace/db/action and /api/professor-mari/workspace/db/command), plus safe
// idle checks and deploys (scripts/marinara-deploy.py). Erin's instance is read-only unless
// MARINARA_WIFE_WRITES=1 (scripts/mari-mcp-guard.mjs).
// ──────────────────────────────────────────────

import { spawn } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardInstanceCall } from "./mari-mcp-guard.mjs";

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url));
const DEPLOY_SCRIPT = join(SCRIPTS_DIR, "marinara-deploy.py");
const DEPLOY_LOG = join(homedir(), ".cache", "marinara-deploy.log");

// The privileged workspace routes answer loopback only, and a request from the host arrives through the
// Docker gateway. So each call runs inside the container, where `mari` itself runs, with the container's
// own server URL and admin secret.
const POST_JS = `
let input = "";
process.stdin.on("data", (c) => (input += c)).on("end", async () => {
  const { path, body } = JSON.parse(input);
  const res = await fetch((process.env.MARI_SERVER_URL || "http://127.0.0.1:7860") + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-marinara-csrf": "1", "X-Admin-Secret": process.env.ADMIN_SECRET || "" },
    body: JSON.stringify(body),
  });
  process.stdout.write(JSON.stringify({ status: res.status, text: await res.text() }));
});`;

function run(command, args, { input, timeoutMs = 120_000 } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

async function postInContainer(instanceName, path, body) {
  const container = instanceName === "marinara-wife" ? "marinara-wife" : "marinara";
  const { code, stdout, stderr } = await run(
    "docker",
    [
      "exec",
      "-i",
      "-e",
      "NODE_TLS_REJECT_UNAUTHORIZED=0",
      "-e",
      "NODE_NO_WARNINGS=1",
      container,
      "node",
      "-e",
      POST_JS,
    ],
    { input: JSON.stringify({ path, body }) },
  );
  if (code !== 0) throw new Error(`docker exec ${container} failed: ${(stderr || stdout).trim().slice(-500)}`);
  const { status, text } = JSON.parse(stdout);
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // keep text
  }
  if (status >= 400) {
    const msg = (parsed && typeof parsed === "object" && (parsed.message || parsed.error)) || text;
    throw new Error(`Marinara API error (${status}): ${msg}`);
  }
  return parsed;
}

async function callAction(instanceName, payload) {
  return postInContainer(instanceName, "/api/professor-mari/workspace/db/action", {
    ...payload,
    sessionId: `mcp:${instanceName || "marinara"}`,
  });
}

async function callCommand(instanceName, argv) {
  const command = ["mari", ...argv].map((part) => (/\s/u.test(part) ? JSON.stringify(part) : part)).join(" ");
  return postInContainer(instanceName, "/api/professor-mari/workspace/db/command", {
    argv,
    command,
    cwd: "/app",
    sessionId: `mcp:${instanceName || "marinara"}`,
  });
}

/** Starts a deploy in the background (a build takes minutes); marinara_deploy_status reads its log. */
function startDeploy(ref) {
  const log = openSync(DEPLOY_LOG, "w");
  const child = spawn("python3", ["-I", DEPLOY_SCRIPT, "deploy", ...(ref ? [String(ref)] : [])], {
    detached: true,
    stdio: ["ignore", log, log],
  });
  child.unref();
  closeSync(log);
  return `Deploy started (pid ${child.pid}). It builds, waits for both instances to be idle, then recreates marinara. Check marinara_deploy_status.`;
}

const INSTANCE_PROP = {
  type: "string",
  enum: ["marinara", "marinara-wife"],
  description:
    'Target Marinara instance. Default is "marinara" (Ben / story.bahaynes.com). Only use "marinara-wife" when explicitly asked for Erin/wife.',
};

const APPLY_PROP = {
  type: "boolean",
  description: "Set true to apply and save a mutation. Omit or set false for a safe dry-run preview.",
};

const REASON_PROP = {
  type: "string",
  description: "Audit reason describing why this mutation is being made.",
};

const TOOLS = [
  {
    name: "mari_chats",
    description:
      "Inspect, search, diagnose, or check prompt caching on Marinara chats. Use action='list' to find chats, 'get' for chat metadata, 'messages' (with last, afterPost, limit, offset) to read turns, 'search' to search message text, 'diagnose' for full chat diagnostics, 'cacheReport' or 'cacheCompare' for prompt-cache analysis, and 'updateMessage' to edit a message.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: ["list", "get", "messages", "search", "diagnose", "cacheReport", "cacheCompare", "updateMessage"],
        },
        chatId: { type: "string", description: "Target chat ID." },
        id: { type: "string", description: "Message ID (for updateMessage) or chat ID." },
        query: { type: "string", description: "Search query for list or search." },
        last: { type: "integer", minimum: 1, maximum: 200, description: "Read the last N messages." },
        afterPost: { type: "integer", minimum: 0, description: "Read messages after post #N (1-indexed)." },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        tail: { type: "boolean" },
        field: { type: "string" },
        data: { type: "object" },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_characters",
    description:
      "Read, search, create, update, or delete Marinara character cards, onboarding flows, ruleset sheets, and character folders. Oversized fields in 'get' list their paths in truncation notes; pass field='<path>' to read a specific field in full.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: [
            "list",
            "get",
            "search",
            "create",
            "update",
            "delete",
            "onboarding.get",
            "onboarding.update",
            "rulesetSheet.get",
            "rulesetSheet.update",
            "folder.list",
            "moveToFolder",
          ],
        },
        characterId: { type: "string", description: "Character ID." },
        id: { type: "string", description: "Alias for characterId." },
        query: { type: "string" },
        folderId: { type: "string" },
        rulesetId: { type: "string" },
        field: { type: "string", description: 'Dotted path to read in full, e.g. "data.extensions.backstory".' },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        data: {
          type: "object",
          description:
            "Character fields for create/update: name, description, personality, scenario, firstMes, mesExample, creatorNotes, backstory, appearance, systemPrompt, postHistoryInstructions, tags, summary, comment, alternateGreetings.",
        },
        patch: { type: "object", description: "Partial character fields to update." },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_personas",
    description: "List, get, search, create, update, or delete user personas and their ruleset sheets.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: ["list", "get", "search", "create", "update", "delete", "rulesetSheet.get", "rulesetSheet.update"],
        },
        personaId: { type: "string", description: "Persona ID." },
        id: { type: "string", description: "Alias for personaId." },
        query: { type: "string" },
        rulesetId: { type: "string" },
        field: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        data: {
          type: "object",
          description: "Persona fields: name, description, personality, backstory, appearance, aboutMe.",
        },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_lorebooks",
    description:
      "Inspect and manage lorebooks and lorebook entries: list, get, entries (paginated), getEntry, getEntries, batch, search, testScan, create, update, addEntry, updateEntry, deleteEntry, linkCharacter, unlinkCharacter, delete.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: [
            "list",
            "get",
            "entries",
            "getEntry",
            "getEntries",
            "batch",
            "search",
            "testScan",
            "create",
            "update",
            "addEntry",
            "updateEntry",
            "deleteEntry",
            "linkCharacter",
            "unlinkCharacter",
            "delete",
            "folder.list",
            "folder.create",
            "libraryFolder.list",
            "libraryFolder.create",
          ],
        },
        lorebookId: { type: "string" },
        entryId: { type: "string" },
        characterId: { type: "string" },
        chatId: { type: "string" },
        id: { type: "string" },
        query: { type: "string" },
        folderId: { type: "string" },
        folderName: { type: "string" },
        parentFolderId: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        field: { type: "string" },
        data: {
          type: "object",
          description:
            "Lorebook or entry fields. Entry fields: name, content, description, keys, secondaryKeys, tag, constant, selective, selectiveLogic, matchWholeWords, caseSensitive, useRegex, position, depth, order, role, group, decisionStatement, decisionMode, sticky, cooldown.",
        },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_presets",
    description: "Inspect and edit prompt presets, prompt sections, section groups, and choice blocks.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: [
            "list",
            "get",
            "search",
            "create",
            "update",
            "sections",
            "getSection",
            "addSection",
            "updateSection",
            "deleteSection",
            "groups",
            "getGroup",
            "addGroup",
            "updateGroup",
            "deleteGroup",
            "choiceBlocks",
            "getChoiceBlock",
            "addChoiceBlock",
            "updateChoiceBlock",
            "deleteChoiceBlock",
          ],
        },
        presetId: { type: "string" },
        id: { type: "string", description: "Section, group, choice block, or preset ID." },
        query: { type: "string" },
        field: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        data: { type: "object" },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_agents",
    description:
      "List, inspect, search, view recent runs (`runs`), create, or update Marinara capability/feature agents.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: ["list", "get", "search", "runs", "create", "update"],
        },
        agentId: { type: "string" },
        chatId: { type: "string" },
        id: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer", minimum: 1 },
        data: { type: "object" },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_themes_and_ui",
    description: "Manage custom CSS themes, Home-screen widgets, and Personal Extension drafts.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: [
            "theme.list",
            "theme.active",
            "theme.get",
            "theme.create",
            "theme.update",
            "theme.setActive",
            "home_widget.list",
            "home_widget.get",
            "home_widget.create",
            "home_widget.update",
            "home_widget.delete",
            "personal_extension.list",
            "personal_extension.get",
            "personal_extension.search",
            "personal_extension.create",
            "personal_extension.update",
          ],
        },
        id: { type: "string" },
        widgetId: { type: "string" },
        extensionId: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        css: { type: "string" },
        js: { type: "string" },
        serverJs: { type: "string" },
        runtime: { type: "string", enum: ["client", "server"] },
        capabilities: {
          type: "array",
          items: { type: "string", enum: ["read_active_characters", "read_active_persona"] },
        },
        activate: { type: "boolean" },
        data: { type: "object" },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_handbooks",
    description:
      'Read Professor Mari built-in authoring handbooks (skill.list, skill.get with id such as "builtin-characters", "builtin-lorebook", "builtin-presets", "builtin-onboarding", "builtin-themes", "builtin-extensions", "builtin-home-widgets", "builtin-repair", "builtin-cache-check") and manage Mari memories (instruction.*).',
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: [
            "skill.list",
            "skill.get",
            "instruction.list",
            "instruction.get",
            "instruction.remember",
            "instruction.update",
            "instruction.forget",
          ],
        },
        id: { type: "string", description: 'Handbook ID (e.g. "builtin-lorebook") or instruction ID.' },
        name: { type: "string" },
        description: { type: "string" },
        data: { type: "object" },
        patch: { type: "object" },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_db",
    description:
      "Run low-level Marinara file-backed database queries and mutations: status, tables, schema, validate, list, get, select (with safe JS --where expression like \"row.name.includes('Tora')\"), patch, insert, delete, rollback.",
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        action: {
          type: "string",
          enum: [
            "status",
            "tables",
            "schema",
            "validate",
            "list",
            "get",
            "select",
            "patch",
            "insert",
            "delete",
            "rollback",
          ],
        },
        table: {
          type: "string",
          description:
            "Table name (e.g. chats, characters, lorebooks, lorebook_entries, api_connections, app_settings).",
        },
        id: { type: "string", description: "Row ID." },
        where: { type: "string", description: "JS filter expression over `row`, e.g. \"row.chatId === 'abc'\"." },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        json: { type: "object", description: "Row data/patch object for insert or patch." },
        journalPath: { type: "string", description: "Journal path for rollback." },
        apply: APPLY_PROP,
        reason: REASON_PROP,
      },
      required: ["action"],
    },
  },
  {
    name: "mari_cli",
    description:
      'Execute any `mari` CLI subcommand directly (e.g. ["code", "health"], ["images", "--help"], ["wiki", "search", " Genshin"], ["themes", "list"]).',
    inputSchema: {
      type: "object",
      properties: {
        instance: INSTANCE_PROP,
        argv: {
          type: "array",
          items: { type: "string" },
          description: 'Arguments after `mari`, e.g. ["code", "health"].',
        },
      },
      required: ["argv"],
    },
  },
  {
    name: "marinara_idle",
    description:
      "Whether restarting a Marinara container now would cut off a generation on either instance or the local model. Check this before anything that restarts a container.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "marinara_deploy",
    description:
      "Deploy a committed, tested custom-mods commit to Ben's marinara instance (never Erin's): builds from a clean worktree, waits until nothing is generating, keeps a rollback image, and rolls back if the health check fails. Runs in the background; follow it with marinara_deploy_status. The commit must have passed the pre-push checks (push it first). Never run docker compose yourself.",
    inputSchema: {
      type: "object",
      properties: { ref: { type: "string", description: 'Commit or branch to deploy. Default "custom-mods".' } },
    },
  },
  {
    name: "marinara_deploy_status",
    description:
      "The log of the latest marinara_deploy run; its last line says DEPLOYED, NOT DEPLOYED or ROLLED BACK when it has finished.",
    inputSchema: { type: "object", properties: {} },
  },
];

function stripInstance(args) {
  const { instance, ...rest } = args || {};
  return { instance, rest };
}

async function dispatchTool(name, rawArgs) {
  const { instance, rest } = stripInstance(guardInstanceCall(name, rawArgs ?? {}));

  switch (name) {
    case "marinara_idle": {
      const { code, stdout, stderr } = await run("python3", ["-I", DEPLOY_SCRIPT, "idle"], { timeoutMs: 300_000 });
      if (code !== 0) throw new Error(`idle check failed: ${(stderr || stdout).trim().slice(-500)}`);
      return JSON.parse(stdout);
    }
    case "marinara_deploy":
      return startDeploy(rest.ref);
    case "marinara_deploy_status":
      return existsSync(DEPLOY_LOG)
        ? readFileSync(DEPLOY_LOG, "utf8").split("\n").slice(-30).join("\n")
        : "No deploy has run yet.";
    case "mari_chats": {
      const { action, ...params } = rest;
      return callAction(instance, { ...params, action: `chat.${action}` });
    }
    case "mari_characters": {
      const { action, ...params } = rest;
      if (action === "delete") {
        const targetId = params.characterId || params.id;
        if (!targetId) throw new Error("characterId or id is required for delete");
        const argv = ["characters", "delete", String(targetId)];
        if (params.apply) argv.push("--apply");
        if (params.reason) argv.push("--reason", String(params.reason));
        return callCommand(instance, argv);
      }
      return callAction(instance, { ...params, action: `character.${action}` });
    }
    case "mari_personas": {
      const { action, ...params } = rest;
      if (action === "delete") {
        const targetId = params.personaId || params.id;
        if (!targetId) throw new Error("personaId or id is required for delete");
        const argv = ["personas", "delete", String(targetId)];
        if (params.apply) argv.push("--apply");
        if (params.reason) argv.push("--reason", String(params.reason));
        return callCommand(instance, argv);
      }
      return callAction(instance, { ...params, action: `persona.${action}` });
    }
    case "mari_lorebooks": {
      const { action, ...params } = rest;
      if (action === "delete") {
        const targetId = params.lorebookId || params.id;
        if (!targetId) throw new Error("lorebookId or id is required for delete");
        const argv = ["lorebooks", "delete", String(targetId)];
        if (params.apply) argv.push("--apply");
        if (params.reason) argv.push("--reason", String(params.reason));
        return callCommand(instance, argv);
      }
      return callAction(instance, { ...params, action: `lorebook.${action}` });
    }
    case "mari_presets": {
      const { action, ...params } = rest;
      return callAction(instance, { ...params, action: `preset.${action}` });
    }
    case "mari_agents": {
      const { action, ...params } = rest;
      return callAction(instance, { ...params, action: `agent.${action}` });
    }
    case "mari_themes_and_ui": {
      const { action, ...params } = rest;
      return callAction(instance, { ...params, action });
    }
    case "mari_handbooks": {
      const { action, ...params } = rest;
      return callAction(instance, { ...params, action });
    }
    case "mari_db": {
      const { action, table, id, where, limit, offset, json, journalPath, apply, reason } = rest;
      const argv = ["db", String(action)];
      if (action === "schema" || action === "list") {
        if (!table) throw new Error(`table is required for db ${action}`);
        argv.push(String(table));
      } else if (action === "validate") {
        if (table) argv.push("--table", String(table));
      } else if (action === "get" || action === "delete") {
        if (!table || !id) throw new Error(`table and id are required for db ${action}`);
        argv.push(String(table), String(id));
      } else if (action === "select") {
        if (!table) throw new Error("table is required for db select");
        argv.push(String(table));
        if (where) argv.push("--where", String(where));
      } else if (action === "patch") {
        if (!table || !id || !json) throw new Error("table, id, and json are required for db patch");
        argv.push(String(table), String(id), "--json", JSON.stringify(json));
      } else if (action === "insert") {
        if (!table || !json) throw new Error("table and json are required for db insert");
        argv.push(String(table), "--json", JSON.stringify(json));
      } else if (action === "rollback") {
        if (!journalPath) throw new Error("journalPath is required for db rollback");
        argv.push(String(journalPath));
      }
      if (limit !== undefined) argv.push("--limit", String(limit));
      if (offset !== undefined) argv.push("--offset", String(offset));
      if (apply) argv.push("--apply");
      if (reason) argv.push("--reason", String(reason));
      return callCommand(instance, argv);
    }
    case "mari_cli": {
      const argv = Array.isArray(rest.argv) ? rest.argv.map(String) : [];
      if (argv.length === 0) throw new Error("argv must be a non-empty array");
      return callCommand(instance, argv);
    }
    default:
      throw new Error(`Unknown Marinara MCP tool: ${name}`);
  }
}

// ── Stdio JSON-RPC 2.0 Framing (supports both newline-delimited JSON and Content-Length headers) ──

let useContentLengthFraming = false;

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  if (useContentLengthFraming) {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`);
  } else {
    process.stdout.write(`${json}\n`);
  }
}

async function handleRpcMessage(msg) {
  if (!msg || typeof msg !== "object") return;
  const { id, method, params } = msg;

  // Notifications have no id
  if (id === undefined || id === null) return;

  try {
    if (method === "initialize") {
      sendMessage({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "marinara", version: "1.0.0" },
          instructions:
            "Marinara Engine MCP Server (Professor Mari workspace tools). Default instance is 'marinara' (Ben / story.bahaynes.com). 'marinara-wife' (Erin) is read-only unless Ben enabled writes. Mutations dry-run by default; pass apply=true and a reason to persist changes. Restart or deploy only through marinara_idle / marinara_deploy, never docker directly.",
        },
      });
      return;
    }

    if (method === "ping") {
      sendMessage({ jsonrpc: "2.0", id, result: {} });
      return;
    }

    if (method === "tools/list") {
      sendMessage({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
      return;
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      try {
        const result = await dispatchTool(toolName, toolArgs);
        const isErr = result && typeof result === "object" && result.ok === false;
        const formatted = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        sendMessage({
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: formatted }],
            isError: Boolean(isErr),
          },
        });
      } catch (toolErr) {
        sendMessage({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: toolErr instanceof Error ? toolErr.message : String(toolErr),
              },
            ],
            isError: true,
          },
        });
      }
      return;
    }

    sendMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  } catch (err) {
    sendMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    });
  }
}

let inputBuffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);

  while (inputBuffer.length > 0) {
    // Check for Content-Length header framing
    const headerCheck = inputBuffer.subarray(0, Math.min(inputBuffer.length, 32)).toString("utf8");
    if (/^Content-Length:/iu.test(headerCheck)) {
      useContentLengthFraming = true;
      const headerEnd = inputBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;
      const headerText = inputBuffer.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/iu.exec(headerText);
      if (!match) {
        inputBuffer = inputBuffer.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (inputBuffer.length < bodyStart + length) break;
      const bodyText = inputBuffer.subarray(bodyStart, bodyStart + length).toString("utf8");
      inputBuffer = inputBuffer.subarray(bodyStart + length);
      try {
        void handleRpcMessage(JSON.parse(bodyText));
      } catch {
        // ignore malformed JSON
      }
      continue;
    }

    // Newline-delimited JSON framing
    const nlIndex = inputBuffer.indexOf(0x0a);
    if (nlIndex === -1) break;
    const line = inputBuffer.subarray(0, nlIndex).toString("utf8").trim();
    inputBuffer = inputBuffer.subarray(nlIndex + 1);
    if (!line) continue;
    try {
      void handleRpcMessage(JSON.parse(line));
    } catch {
      // ignore malformed line
    }
  }
});
