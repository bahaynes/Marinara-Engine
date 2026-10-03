// ──────────────────────────────────────────────
// Service: Dynamic / Ephemeral Character Sprite Generation
// ──────────────────────────────────────────────
import { existsSync, readdirSync, statSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { extname, join } from "path";
import { normalizeSpriteExpressionLabel } from "@marinara-engine/shared";
import { eq } from "../../db/file-query.js";
import type { DB } from "../../db/connection.js";
import { apiConnections, characters, personas } from "../../db/schema/index.js";
import { logger } from "../../lib/logger.js";
import { DATA_DIR } from "../../utils/data-dir.js";
import { readAvatarBase64 } from "../game/game-asset-generation.js";
import { readPreferredFullBodySpriteBase64 } from "../game/sprite.service.js";
import { createConnectionsStorage } from "../storage/connections.storage.js";
import { generateImage } from "./image-generation.js";
import { resolveConnectionImageDefaults } from "./image-generation-defaults.js";

const SPRITE_EXTS = new Set([".png", ".webp", ".jpg", ".jpeg", ".gif"]);

export interface GenerateCharacterSpriteOptions {
  characterId: string;
  expression: string;
  appearance?: string | null;
  characterName?: string | null;
  avatarPath?: string | null;
  connectionId?: string | null;
  signal?: AbortSignal;
}

export interface SpriteResolutionResult {
  characterId: string;
  expression: string;
  filename: string;
  url: string;
  generated: boolean;
}

const inFlightGenerations = new Map<string, Promise<SpriteResolutionResult | null>>();

export function buildDynamicSpritePrompt(expression: string, appearance?: string | null): string {
  const cleanAppearance = appearance?.trim();
  const appearanceClause = cleanAppearance ? `Character appearance: ${cleanAppearance}. ` : "";
  return `Modify character facial expression to: ${expression}. ${appearanceClause}Maintain exact same hairstyle, clothing, features, and lighting from reference. Clean transparent background visual novel sprite.`;
}

function isSafeId(id: string): boolean {
  return Boolean(id) && !id.includes("..") && !id.includes("/") && !id.includes("\\");
}

export function findExistingCharacterSprite(characterId: string, expression: string): SpriteResolutionResult | null {
  if (!isSafeId(characterId)) return null;
  const normExpression = normalizeSpriteExpressionLabel(expression);
  if (!normExpression) return null;

  const dir = join(DATA_DIR, "sprites", characterId);
  if (!existsSync(dir)) return null;

  try {
    const files = readdirSync(dir);
    for (const f of files) {
      const ext = extname(f).toLowerCase();
      if (!SPRITE_EXTS.has(ext)) continue;
      const baseName = f.slice(0, -ext.length);
      if (baseName.toLowerCase() === normExpression.toLowerCase()) {
        const mtime = statSync(join(dir, f)).mtimeMs;
        return {
          characterId,
          expression: normExpression,
          filename: f,
          url: `/api/sprites/${characterId}/file/${encodeURIComponent(f)}?v=${Math.floor(mtime)}`,
          generated: false,
        };
      }
    }
  } catch {
    /* non-critical */
  }

  return null;
}

export async function getDynamicSpriteConnection(db: DB, connectionId?: string | null) {
  const connections = createConnectionsStorage(db);
  if (connectionId) {
    const conn = await connections.getWithKey(connectionId);
    if (conn) return conn;
  }

  const all = await db.select().from(apiConnections).where(eq(apiConnections.provider, "image_generation"));

  // 1. Match FluxEdit-Expression connection or one configured with reference + prompt placeholders
  const matched = all.find(
    (c) =>
      c.id === "EU5mz6-zotmhFlzy-i7Ad" ||
      c.name?.toLowerCase().includes("fluxedit-expression") ||
      c.name?.toLowerCase().includes("fluxedit") ||
      (typeof c.comfyuiWorkflow === "string" &&
        c.comfyuiWorkflow.includes("%reference_image_name%") &&
        c.comfyuiWorkflow.includes("%prompt%")),
  );

  if (matched) {
    return await connections.getWithKey(matched.id);
  }

  return await connections.getDefaultForImageGeneration();
}

async function resolveReferenceImageBase64(
  db: DB,
  characterId: string,
  providedAvatarPath?: string | null,
): Promise<string | null> {
  // 1. Try any existing sprite as high-fidelity character reference
  const fullBodyRef = readPreferredFullBodySpriteBase64(characterId);
  if (fullBodyRef?.base64) return fullBodyRef.base64;

  const dir = join(DATA_DIR, "sprites", characterId);
  if (existsSync(dir)) {
    try {
      const files = readdirSync(dir).filter((f) => SPRITE_EXTS.has(extname(f).toLowerCase()));
      const neutralFile = files.find((f) => /^(neutral|default|idle|normal)\./i.test(f)) ?? files[0];
      if (neutralFile) {
        const { readFileSync } = await import("fs");
        return readFileSync(join(dir, neutralFile)).toString("base64");
      }
    } catch {
      /* non-critical */
    }
  }

  // 2. Try provided avatar path
  if (providedAvatarPath) {
    const avatar = readAvatarBase64(providedAvatarPath);
    if (avatar) return avatar;
  }

  // 3. Query characters table
  try {
    const rows = await db
      .select({ avatarPath: characters.avatarPath })
      .from(characters)
      .where(eq(characters.id, characterId))
      .limit(1);
    if (rows[0]?.avatarPath) {
      const avatar = readAvatarBase64(rows[0].avatarPath);
      if (avatar) return avatar;
    }
  } catch {
    /* non-critical */
  }

  // 4. Query personas table in case this is a user persona
  try {
    const personaRows = await db
      .select({ avatarPath: personas.avatarPath })
      .from(personas)
      .where(eq(personas.id, characterId))
      .limit(1);
    if (personaRows[0]?.avatarPath) {
      const avatar = readAvatarBase64(personaRows[0].avatarPath);
      if (avatar) return avatar;
    }
  } catch {
    /* non-critical */
  }

  return null;
}

export async function resolveOrGenerateCharacterSprite(
  db: DB,
  options: GenerateCharacterSpriteOptions,
): Promise<SpriteResolutionResult | null> {
  const { characterId, expression } = options;
  if (!isSafeId(characterId)) return null;

  const normExpression = normalizeSpriteExpressionLabel(expression);
  if (!normExpression) return null;

  // 1. Return immediately if sprite already exists
  const existing = findExistingCharacterSprite(characterId, normExpression);
  if (existing) return existing;

  // 2. Check in-flight generation to deduplicate
  const queueKey = `${characterId}:${normExpression}`;
  const inFlight = inFlightGenerations.get(queueKey);
  if (inFlight) return await inFlight;

  const generationPromise = (async (): Promise<SpriteResolutionResult | null> => {
    try {
      const conn = await getDynamicSpriteConnection(db, options.connectionId);
      if (!conn) {
        logger.warn("[ephemeral-sprite] No suitable image connection found for sprite generation");
        return null;
      }

      // Resolve character appearance if not provided
      let appearance = options.appearance ?? null;
      if (!appearance) {
        try {
          const charRows = await db
            .select({ data: characters.data })
            .from(characters)
            .where(eq(characters.id, characterId))
            .limit(1);
          if (charRows[0]?.data) {
            const parsed = JSON.parse(charRows[0].data);
            appearance =
              (typeof parsed.appearance === "string" ? parsed.appearance : null) ??
              (typeof parsed.description === "string" ? parsed.description : null);
          }
        } catch {
          /* non-critical */
        }
      }

      const referenceBase64 = await resolveReferenceImageBase64(db, characterId, options.avatarPath);
      if (!referenceBase64) {
        logger.warn("[ephemeral-sprite] Cannot generate sprite for %s without reference image or avatar", characterId);
        return null;
      }

      const prompt = buildDynamicSpritePrompt(normExpression, appearance);
      const imgModel = conn.model || "";
      const imgBaseUrl = conn.baseUrl || "http://10.10.10.113:8188";
      const imgApiKey = conn.apiKey || "";
      const imgSource = (conn as any).imageGenerationSource || conn.imageService || "comfyui";
      const imgServiceHint = conn.imageService || imgSource;
      const imageDefaults = resolveConnectionImageDefaults(conn);

      logger.info(
        '[ephemeral-sprite] Generating dynamic sprite for %s ("%s") using %s (%s)',
        characterId,
        normExpression,
        conn.name ?? conn.id,
        imgModel,
      );

      const imageResult = await generateImage(imgModel, imgBaseUrl, imgApiKey, imgServiceHint, {
        prompt,
        model: imgModel,
        referenceImage: referenceBase64,
        comfyWorkflow: conn.comfyuiWorkflow || undefined,
        imageDefaults,
        transparentBackground: true,
        imageEndpointId: conn.imageEndpointId || undefined,
        signal: options.signal,
      });

      if (!imageResult?.base64) {
        logger.warn("[ephemeral-sprite] ComfyUI returned empty image result for %s", characterId);
        return null;
      }

      const buffer = Buffer.from(imageResult.base64, "base64");
      const targetDir = join(DATA_DIR, "sprites", characterId);
      await mkdir(targetDir, { recursive: true });

      const filename = `${normExpression}.png`;
      const targetPath = join(targetDir, filename);
      await writeFile(targetPath, buffer);

      const mtime = Date.now();
      logger.info("[ephemeral-sprite] Successfully saved dynamic sprite: %s (%s)", targetPath, normExpression);

      return {
        characterId,
        expression: normExpression,
        filename,
        url: `/api/sprites/${characterId}/file/${encodeURIComponent(filename)}?v=${mtime}`,
        generated: true,
      };
    } catch (err: any) {
      logger.error(
        err,
        "[ephemeral-sprite] Failed to generate dynamic sprite for %s (%s)",
        characterId,
        normExpression,
      );
      return null;
    }
  })();

  inFlightGenerations.set(queueKey, generationPromise);
  try {
    return await generationPromise;
  } finally {
    if (inFlightGenerations.get(queueKey) === generationPromise) {
      inFlightGenerations.delete(queueKey);
    }
  }
}
