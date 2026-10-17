/**
 * A shared world's seam: what other parties did, and the shared calendar.
 *
 *   - A package sharing the world stores other parties' deeds on the chat (`gameLedgerForeign`). They move
 *     the world (who holds a place, what it went through) but never this party's renown, standing or
 *     journal; word of them is news. Their days, holds and travel never come along.
 *   - The shared calendar (`gameWorldDayFloor`) is a floor the world's day steps up to, never back from:
 *     the party's own days count toward it, not on top of it.
 *   - A session's fold leaves foreign deeds out: the package stores them on every session afresh.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  WORLD_GENERATOR_VERSION,
  WORLD_DEED_KINDS,
  WORLD_STARTER_KITS,
  checkWorldBrief,
  compileGameWorld,
  parseWorldKit,
  worldForeignLedger,
  worldPresent,
  worldSnapshot,
} from "../../packages/shared/src/index.js";

const dataDir = mkdtempSync(join(tmpdir(), "marinara-world-ledger-foreign-"));
process.env.DATA_DIR = dataDir;
process.env.FILE_STORAGE_DIR = join(dataDir, "storage");
process.env.LOG_LEVEL = "silent";

const parsed = parseWorldKit(WORLD_STARTER_KITS.find((each) => each.id === "high_fantasy")!);
assert.ok(parsed.ok);
const kit = parsed.kit;
const plain = checkWorldBrief(kit, { briefVersion: 1, premise: "The river provinces quarrel." });
assert.ok(plain.ok);
const layout = compileGameWorld({ kit, seed: 7, grounding: "expand", brief: plain.brief });
const town = layout.places.filter((place) => place.rank !== undefined).sort((a, b) => b.rank! - a.rank!)[0]!;
const group = "The Ferrymen";
const checked = checkWorldBrief(kit, {
  briefVersion: 1,
  premise: "The river provinces quarrel.",
  places: [{ name: town.name, layer: town.layer }],
  groups: [{ name: group, kind: kit.groupKinds[0]!.id, seat: town.name }],
});
assert.ok(checked.ok, checked.ok ? "" : checked.issues.join("; "));
const world = {
  seed: 7,
  generatorVersion: WORLD_GENERATOR_VERSION,
  grounding: "expand" as const,
  brief: checked.brief,
};
const game = { kit, ...world, world: compileGameWorld({ kit, ...world }) };

// The validator: only deeds and facts with who did them; their time and travel are stripped.
assert.deepEqual(
  worldForeignLedger([
    { by: "Ana", deed: "take", group, place: town.name, days: "30", at: "Elsewhere", hold: "x" },
    { deed: "destroy", place: town.name },
    { by: "Ana", days: "5" },
    { by: "Ana", deed: "help", group: 3 },
    "nonsense",
  ]),
  [{ by: "Ana", deed: "take", group, place: town.name }],
);
assert.deepEqual(worldForeignLedger({ by: "Ana" }), []);

const { default: Fastify } = await import("../../packages/server/node_modules/fastify/fastify.js");
const { getDB, closeDB } = await import("../../packages/server/src/db/connection.js");
const { gameRoutes } = await import("../../packages/server/src/routes/game.routes.js");
const { createChatsStorage } = await import("../../packages/server/src/services/storage/chats.storage.js");
const { createGameWorldSnapshotsStorage } =
  await import("../../packages/server/src/services/storage/game-world-snapshots.storage.js");
const { gameRepliesBefore } = await import("../../packages/server/src/services/game/game-market.service.js");

try {
  const db = await getDB();
  const chats = createChatsStorage(db);
  const app = Fastify();
  app.decorate("db", db);
  await app.register(gameRoutes, { prefix: "/api/game" });
  try {
    const gameId = "shared-game";
    const first = (await chats.create({
      name: "Shared — Session 1",
      mode: "game",
      characterIds: [],
      groupId: gameId,
    }))!;
    const say = (chatId: string, role: "user" | "assistant", content: string) =>
      chats.createMessage({ chatId, role, characterId: null, content });
    await say(first.id, "assistant", `[place: name="${town.name}" result="ok"]\nThe gates open.`);
    await say(first.id, "assistant", `Two days pass.\n[world: days="2" result="ok"]`);

    const aloneLedger = (await gameRepliesBefore(db, first.id)).ledger;
    const alone = worldPresent(game, aloneLedger);
    await chats.patchMetadata(first.id, {
      gameLedgerForeign: [
        { by: "Ana's party", deed: "take", group, place: town.name, days: "40" },
        { by: "Ana's party", deed: "help", group },
      ],
      gameWorldDayFloor: 9,
    });
    const read = await gameRepliesBefore(db, first.id);
    const shared = worldPresent(game, read.ledger);
    assert.equal(shared.day, 9, "the shared calendar is the day the world is at; a foreign deed's days never count");
    assert.equal(shared.renown, alone.renown, "another party's deeds are not this party's renown");
    assert.equal(shared.standing[group] ?? 0, alone.standing[group] ?? 0, "nor its standing");
    assert.deepEqual(shared.deeds, alone.deeds, "nor its journal");
    assert.ok(
      Object.values(shared.done).some((lines) => lines.includes(`${group} took it.`)),
      "but the place's history has it",
    );
    assert.ok(
      shared.news.some((news) => news.text === `Word is ${group} took ${town.name} (Ana's party).`),
      "and word of it travels",
    );
    assert.equal(
      worldPresent(game, (await gameRepliesBefore(db, first.id, null, { foreign: false })).ledger).renown,
      alone.renown,
    );

    // Every deed another party does leaves this party's renown, standing and journal as they were.
    for (const deed of Object.keys(WORLD_DEED_KINDS)) {
      const entry = { by: "Ana's party", deed, group, with: group, place: town.name, who: "Ana" };
      const one = worldPresent(game, [...aloneLedger, ...worldForeignLedger([entry])]);
      assert.equal(one.renown, alone.renown, `${deed}: renown`);
      assert.deepEqual(one.standing, alone.standing, `${deed}: standing`);
      assert.deepEqual(one.deeds, alone.deeds, `${deed}: journal`);
      assert.ok(
        one.news.some((news) => /^Word is (?!.*undefined)/.test(news.text)),
        `${deed}: word of it`,
      );
    }

    // A floor behind the party's own day never sets it back.
    await chats.patchMetadata(first.id, { gameWorldDayFloor: 1 });
    assert.equal(worldPresent(game, (await gameRepliesBefore(db, first.id)).ledger).day, 2);
    await chats.patchMetadata(first.id, { gameWorldDayFloor: 9 });

    // ── The next session folds on without the foreign deeds; the package stores them again ──
    await createGameWorldSnapshotsStorage(db).put(first.id, worldSnapshot(game));
    await chats.patchMetadata(first.id, (current) => ({
      ...current,
      gameId,
      gameSessionNumber: 1,
      gameSessionStatus: "concluded",
      gamePreviousSessionSummaries: [{ summary: "Session 1 concluded." }],
      gameWorldKit: kit,
      gameWorld: world,
    }));
    const started = await app.inject({ method: "POST", url: "/api/game/session/start", payload: { gameId } });
    assert.equal(started.statusCode, 200, started.body);
    const second = started.json().sessionChat.id as string;
    await chats.patchMetadata(second, { gameLedgerForeign: [] });
    assert.ok(await createGameWorldSnapshotsStorage(db).getFold(second), "the new session folds on");
    const next = worldPresent(game, (await gameRepliesBefore(db, second)).ledger);
    assert.equal(next.day, 9, "the calendar is the world's: it comes along");
    assert.ok(
      !Object.values(next.done).some((lines) => lines.includes(`${group} took it.`)),
      "a foreign deed the package no longer stores is gone: it was never baked in",
    );
  } finally {
    await app.close();
    await closeDB();
  }
  console.log("World ledger foreign: other parties move the world, never this party's own standing.");
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
