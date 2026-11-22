// ──────────────────────────────────────────────
// custom-mods: Zustand Store: the Roleplay ruleset inventory on screen
// ──────────────────────────────────────────────
// A Roleplay chat that plays by a ruleset carries Game Mode's bags. The tracker panel opens them; the
// chat's overlays draw them in Game Mode's own inventory screen.
import { create } from "zustand";

interface RoleplayInventoryState {
  chatId: string | null;
  show: (chatId: string) => void;
  close: () => void;
}

export const useRoleplayInventoryStore = create<RoleplayInventoryState>((set) => ({
  chatId: null,
  show: (chatId) => set({ chatId }),
  close: () => set({ chatId: null }),
}));
