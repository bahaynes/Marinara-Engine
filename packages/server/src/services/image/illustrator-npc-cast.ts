// custom-mods: people the Illustrator can draw who have no card of their own.
import { getCapabilityService } from "../capability-packages/capability-service-registry.service.js";
import type { IllustratorChatCharacterReference } from "./illustrator-references.js";

/** The NPC Registry package's service (agents fork, `fork/packages/npc-registry`). */
export type NpcRegistryService = {
  current: (chatId: string) => Promise<{
    npcs: Map<string, { id: string; name: string; avatar?: string; looks?: string; aliases?: string[] }>;
  }>;
  setAvatar?: (chatId: string, npcIdOrName: string, avatarPath: string) => Promise<string | null>;
  setLooks?: (chatId: string, npcIdOrName: string, looks: string) => Promise<string | null>;
};

export function getNpcRegistryService(): NpcRegistryService | null {
  return getCapabilityService<NpcRegistryService>("npc-registry");
}

/** Cast ids for people without a card start with this, so callers can tell them from cards. */
export function isIllustratorNpcCastId(id: string): boolean {
  return id.startsWith("npc:") || id.startsWith("npc-registry:");
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Card-less people for the Illustrator cast: this turn's tracker rows that carry a portrait, and
 * NPC Registry entries with a portrait or stored looks. Names the cast already holds are skipped;
 * a registry entry fills what the tracker row lacks for the same name.
 */
export async function loadIllustratorNpcCast(args: {
  chatId: string;
  knownNames: readonly string[];
  presentCharacters?: unknown;
}): Promise<IllustratorChatCharacterReference[]> {
  const byName = new Map<string, IllustratorChatCharacterReference>();
  const known = new Set(args.knownNames.map((name) => name.trim().toLowerCase()));
  const add = (entry: IllustratorChatCharacterReference) => {
    const key = entry.name.toLowerCase();
    if (known.has(key)) return;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, entry);
      return;
    }
    existing.avatarPath ||= entry.avatarPath ?? null;
    existing.appearance ||= entry.appearance ?? null;
  };

  if (Array.isArray(args.presentCharacters)) {
    for (const row of args.presentCharacters as Array<Record<string, unknown>>) {
      const name = text(row?.name);
      const avatarPath = text(row?.avatarPath);
      if (name && avatarPath) add({ id: `npc:${name}`, name, avatarPath, appearance: text(row.appearance) || null });
    }
  }

  try {
    const resolved = await getNpcRegistryService()?.current(args.chatId);
    for (const entry of resolved?.npcs?.values() ?? []) {
      const name = text(entry.name);
      const avatarPath = text(entry.avatar);
      const looks = text(entry.looks);
      if (name && (avatarPath || looks)) {
        add({ id: `npc-registry:${entry.id}`, name, avatarPath: avatarPath || null, appearance: looks || null });
      }
    }
  } catch {
    // The registry package is optional; without it only tracker portraits count.
  }
  return [...byName.values()];
}
