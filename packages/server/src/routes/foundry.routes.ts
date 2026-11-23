// custom-mods: Phase 1 Foundry VTT -> Marinara bridge route.
import type { FastifyInstance } from "fastify";
import { logger } from "../lib/logger.js";
import { requirePrivilegedAccess } from "../middleware/privileged-gate.js";
import { parseExtra, resolveVisibleGameStateAnchor } from "./generate/generate-route-utils.js";
import { createChatsStorage } from "../services/storage/chats.storage.js";
import { createGameStateStorage, parseStoredRulesetLive } from "../services/storage/game-state.storage.js";
import {
  applyFoundryActorsToRulesetLive,
  formatFoundryCombatRecap,
  foundryCombatResultSchema,
} from "../services/game/foundry-bridge.service.js";
import { parseBody } from "../utils/parse-body.js";

export async function foundryRoutes(app: FastifyInstance) {
  const storage = createChatsStorage(app.db);

  app.post<{ Params: { id: string } }>("/:id/foundry/combat-result", async (req, reply) => {
    if (!requirePrivilegedAccess(req, reply, { feature: "Foundry VTT bridge" })) return;
    const input = parseBody(foundryCombatResultSchema, req.body, reply, "Invalid Foundry combat payload");
    if (!input) return reply;

    const chat = await storage.getById(req.params.id);
    if (!chat) return reply.status(404).send({ error: "Chat not found" });

    const chatMeta = parseExtra(chat.metadata);
    const gameStateStore = createGameStateStorage(app.db);
    const msgs = await storage.listMessages(req.params.id);
    const visibleAnchor = resolveVisibleGameStateAnchor(msgs);
    const currentRow = await gameStateStore.getForGeneration(req.params.id, {
      preferLatestVisible: true,
      visibleAnchor,
    });
    const currentLive = parseStoredRulesetLive(currentRow?.rulesetLive);
    const { live, updatedMembers } = applyFoundryActorsToRulesetLive(currentLive, chatMeta.gameCharacterCards, input);

    if (currentRow?.messageId) {
      await gameStateStore.updateByMessage(
        currentRow.messageId,
        currentRow.swipeIndex,
        req.params.id,
        { rulesetLive: live },
        false,
      );
    } else if (currentRow) {
      await gameStateStore.updateLatest(req.params.id, { rulesetLive: live }, false);
    } else {
      await gameStateStore.create(
        {
          chatId: req.params.id,
          messageId: "",
          swipeIndex: 0,
          date: null,
          time: null,
          location: null,
          weather: null,
          temperature: null,
          worldCustomFields: [],
          presentCharacters: [],
          recentEvents: [],
          playerStats: null,
          personaStats: null,
          fieldLocks: {},
          hiddenTrackerFields: {},
          rulesetLive: live,
        },
        null,
      );
    }

    const recap = formatFoundryCombatRecap(input);
    let messageId: string | null = null;
    if (input.postMessage !== false) {
      const created = await storage.createMessage({
        chatId: req.params.id,
        role: "user",
        characterId: null,
        content: recap,
      });
      messageId = created?.id ?? null;
    }

    logger.info(
      "[foundry] Synced combat result to chat %s (updated=%d, messageId=%s)",
      req.params.id,
      updatedMembers.length,
      messageId ?? "none",
    );
    return { ok: true, chatId: req.params.id, updatedMembers, messageId, recap };
  });
}
