import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A game scene illustration is kept under game-assets and also shown in the chat's gallery. The gallery
// entry is a hardlink to the same file, so the image costs its bytes once, and removing either name
// (gallery delete, retention) leaves the other intact.
const dataDir = mkdtempSync(join(tmpdir(), "marinara-gallery-link-"));
process.env.DATA_DIR = dataDir;
const { linkImageToDisk, removeSavedImageFromDisk } =
  await import("../../packages/server/src/services/image/image-generation.js");

try {
  const assetDir = join(dataDir, "game-assets", "backgrounds", "illustrations");
  mkdirSync(assetDir, { recursive: true });
  const asset = join(assetDir, "scene.png");
  writeFileSync(asset, "illustration bytes");

  const relative = linkImageToDisk("chat-1", asset, "png");
  assert.match(relative, /^chat-1\/[^/]+\.png$/);
  const galleryFile = join(dataDir, "gallery", relative);
  assert.equal(readFileSync(galleryFile, "utf8"), "illustration bytes");
  assert.equal(statSync(galleryFile).ino, statSync(asset).ino, "one file on disk, two names");
  assert.equal(statSync(asset).nlink, 2);

  removeSavedImageFromDisk(relative);
  assert.equal(existsSync(galleryFile), false);
  assert.equal(readFileSync(asset, "utf8"), "illustration bytes", "deleting the gallery entry keeps the asset");
  assert.equal(statSync(asset).nlink, 1);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
process.stdout.write("Gallery image hardlink regression passed.\n");
