import { setTimeout as delay } from "node:timers/promises";
import { isProviderLocalUrlsEnabled, isTtsLocalUrlsEnabled } from "../../config/runtime-config.js";
import { safeFetch } from "../../utils/security.js";

const POLL_INTERVAL_MS = 1_500;

export interface ComfyUiAudioRequest {
  baseUrl: string;
  apiKey?: string;
  comfyuiWorkflow?: string | null;
  prompt: string;
  lyrics?: string;
  durationSeconds: number;
  seed?: number;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
}

type ComfyAudioArtifact = { filename: string; subfolder?: string; type?: string };

/** Escape a string for safe embedding inside an existing JSON string literal. */
function escapeJsonStringContent(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** Substitute Marinara audio placeholders into a ComfyUI API-format workflow JSON string. */
export function buildComfyUiAudioWorkflow(input: {
  workflowJson: string;
  prompt: string;
  lyrics?: string;
  durationSeconds: number;
  seed: number;
}): Record<string, unknown> {
  if (!input.workflowJson.trim()) {
    throw new Error("Configure a ComfyUI API-format workflow JSON on this connection");
  }
  const duration = Number.isFinite(input.durationSeconds) && input.durationSeconds > 0 ? input.durationSeconds : 30;
  const lyrics = input.lyrics?.trim() || "[Instrumental]";
  const seed = String(Math.trunc(input.seed));
  const rendered = input.workflowJson
    .replaceAll("%prompt%", escapeJsonStringContent(input.prompt))
    .replaceAll("%lyrics%", escapeJsonStringContent(lyrics))
    .replaceAll('"%duration%"', String(duration))
    .replaceAll("%duration%", String(duration))
    .replaceAll('"%seed%"', seed)
    .replaceAll("%seed%", seed);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rendered);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ComfyUI audio workflow JSON: ${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ComfyUI audio workflow must be a JSON object exported via Save (API Format)");
  }
  return parsed as Record<string, unknown>;
}

function findAudioArtifact(outputs: Record<string, unknown> | undefined): ComfyAudioArtifact | null {
  if (!outputs) return null;
  for (const nodeOutput of Object.values(outputs)) {
    if (!nodeOutput || typeof nodeOutput !== "object") continue;
    const record = nodeOutput as Record<string, unknown>;
    const list = Array.isArray(record.audio) ? record.audio : Array.isArray(record.audios) ? record.audios : null;
    if (!list?.length) continue;
    const first = list[0];
    if (first && typeof first === "object" && typeof (first as ComfyAudioArtifact).filename === "string") {
      return first as ComfyAudioArtifact;
    }
  }
  return null;
}

function extractExecutionError(status: Record<string, unknown> | undefined): string | null {
  if (!status || status.status_str !== "error") return null;
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const entry of messages) {
    if (!Array.isArray(entry) || entry[0] !== "execution_error" || !entry[1] || typeof entry[1] !== "object") continue;
    const detail = entry[1] as { exception_message?: unknown; node_type?: unknown };
    if (typeof detail.exception_message === "string" && detail.exception_message.trim()) {
      const node = typeof detail.node_type === "string" ? `${detail.node_type}: ` : "";
      return `${node}${detail.exception_message.trim()}`.slice(0, 300);
    }
  }
  return "ComfyUI workflow execution failed";
}

/** Submit an API-format ComfyUI audio workflow, wait for completion, and download the generated MP3. */
export async function generateComfyUiAudio(input: ComfyUiAudioRequest): Promise<Uint8Array> {
  const base = new URL(input.baseUrl);
  if (base.username || base.password || base.search || base.hash) {
    throw new Error("Use a ComfyUI base URL without credentials or query parameters");
  }
  const allowLocal = isTtsLocalUrlsEnabled() || isProviderLocalUrlsEnabled();
  const policy = {
    allowLocal,
    allowedOrigins: [base.origin],
    allowedProtocols: allowLocal ? ["http:", "https:"] : ["https:"],
    maxRedirects: 0,
  };
  const signal = input.signal
    ? AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)])
    : AbortSignal.timeout(input.timeoutMs);
  signal.throwIfAborted();

  const seed = input.seed ?? Math.floor(Math.random() * 2_147_483_647);
  const workflow = buildComfyUiAudioWorkflow({
    workflowJson: input.comfyuiWorkflow ?? "",
    prompt: input.prompt,
    lyrics: input.lyrics,
    durationSeconds: input.durationSeconds,
    seed,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
  };
  const root = base.pathname.replace(/\/+$/, "");
  const endpoint = (path: string) => new URL(`${root}${path}`, base.origin);

  const queueResponse = await safeFetch(endpoint("/prompt"), {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt: workflow }),
    signal,
    policy,
    maxResponseBytes: 1024 * 1024,
    decodeCompressedResponse: true,
  });
  if (!queueResponse.ok) {
    throw new Error(`ComfyUI /prompt returned HTTP ${queueResponse.status}`);
  }
  const queued = (await queueResponse.json()) as { prompt_id?: unknown; node_errors?: Record<string, unknown> };
  if (queued.node_errors && Object.keys(queued.node_errors).length > 0) {
    throw new Error(`ComfyUI workflow rejected with node errors: ${Object.keys(queued.node_errors).join(", ")}`);
  }
  if (typeof queued.prompt_id !== "string" || !queued.prompt_id) {
    throw new Error("ComfyUI /prompt returned no prompt_id");
  }

  let artifact: ComfyAudioArtifact | null = null;
  while (!artifact) {
    await delay(POLL_INTERVAL_MS, undefined, { signal });
    const historyResponse = await safeFetch(endpoint(`/history/${encodeURIComponent(queued.prompt_id)}`), {
      method: "GET",
      headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined,
      signal,
      policy,
      maxResponseBytes: 2 * 1024 * 1024,
      decodeCompressedResponse: true,
    });
    if (!historyResponse.ok) {
      throw new Error(`ComfyUI /history returned HTTP ${historyResponse.status}`);
    }
    const history = (await historyResponse.json()) as Record<
      string,
      { status?: Record<string, unknown>; outputs?: Record<string, unknown> }
    >;
    const entry = history[queued.prompt_id];
    if (!entry) continue;
    const errorMessage = extractExecutionError(entry.status);
    if (errorMessage) throw new Error(errorMessage);
    artifact = findAudioArtifact(entry.outputs);
    if (!artifact && (entry.status?.completed === true || entry.status?.status_str === "success")) {
      throw new Error("ComfyUI workflow completed without an audio output (use SaveAudioMP3)");
    }
  }

  const viewUrl = endpoint("/view");
  viewUrl.searchParams.set("filename", artifact.filename);
  if (artifact.subfolder) viewUrl.searchParams.set("subfolder", artifact.subfolder);
  viewUrl.searchParams.set("type", artifact.type || "output");

  const audioResponse = await safeFetch(viewUrl, {
    method: "GET",
    headers: input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : undefined,
    signal,
    policy,
    maxResponseBytes: input.maxBytes,
    decodeCompressedResponse: true,
  });
  if (!audioResponse.ok) {
    throw new Error(`ComfyUI /view returned HTTP ${audioResponse.status}`);
  }
  return new Uint8Array(await audioResponse.arrayBuffer());
}
