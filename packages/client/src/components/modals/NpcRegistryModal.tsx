// ──────────────────────────────────────────────
// NPC Registry Modal — browse story NPCs, manage avatars,
// and promote NPCs to first-class character cards.
// ──────────────────────────────────────────────
import { useState, useRef, useMemo, type ChangeEvent } from "react";
import { UserPlus, ImagePlus, Search, Loader2, Users } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation as useUiTranslation } from "react-i18next";
import { toast } from "sonner";
import { Modal } from "../ui/Modal";
import { api } from "../../lib/api-client";
import { characterKeys } from "../../hooks/use-characters";
import { chatKeys } from "../../hooks/use-chats";

interface NpcRegistryModalProps {
  open: boolean;
  onClose: () => void;
  chatId: string;
}

interface NpcEntry {
  id: string;
  name: string;
  gender: string | null;
  aliases: string[];
  avatar: string | null;
}

interface NpcRegistryResponse {
  active: boolean;
  npcs: NpcEntry[];
  error?: string;
}

export function NpcRegistryModal({ open, onClose, chatId }: NpcRegistryModalProps) {
  const { t: localizeUi } = useUiTranslation();
  const qc = useQueryClient();
  const [filterText, setFilterText] = useState("");
  const [uploadingNpcId, setUploadingNpcId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedNpcForUploadRef = useRef<string | null>(null);

  const queryKey = useMemo(() => ["chats", chatId, "npc-registry"] as const, [chatId]);
  const { data, isLoading } = useQuery<NpcRegistryResponse>({
    queryKey,
    queryFn: () => api.get<NpcRegistryResponse>(`/chats/${chatId}/npc-registry`),
    enabled: open && Boolean(chatId),
    staleTime: 5000,
  });

  const promoteMutation = useMutation({
    mutationFn: async (npc: NpcEntry) => {
      const res = await api.post<{ character: { id: string; name: string } }>(`/chats/${chatId}/npc-registry/promote`, {
        npcId: npc.id,
        name: npc.name,
        avatarPath: npc.avatar,
      });
      return res;
    },
    onSuccess: (_res, npc) => {
      toast.success(
        localizeUi("ui.npcRegistry.promotedSuccess", {
          defaultValue: `Promoted ${npc.name} to a character card!`,
          name: npc.name,
        }),
      );
      void qc.invalidateQueries({ queryKey: characterKeys.all });
      void qc.invalidateQueries({ queryKey: chatKeys.detail(chatId) });
      void qc.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : localizeUi("ui.modals.npcregistrymodal.failedToPromoteCharacterCard"),
      );
    },
  });

  const handleAvatarFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const npcId = selectedNpcForUploadRef.current;
    if (!file || !npcId) return;

    const npc = data?.npcs.find((n) => n.id === npcId);
    if (!npc) return;

    setUploadingNpcId(npcId);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = typeof reader.result === "string" ? reader.result : "";
          if (!dataUrl) return;

          // 1. Upload to NPC avatar storage
          const uploadRes = await api.post<{ avatarPath: string }>(`/avatars/npc/${chatId}`, {
            name: npc.name,
            avatar: dataUrl,
          });

          // 2. Set on NPC registry node
          await api.post(`/chats/${chatId}/npc-registry/avatar`, {
            npcId,
            avatarPath: uploadRes.avatarPath,
          });

          toast.success(
            localizeUi("ui.npcRegistry.avatarUpdated", {
              defaultValue: `Updated avatar for ${npc.name}`,
              name: npc.name,
            }),
          );
          void qc.invalidateQueries({ queryKey });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : localizeUi("ui.modals.npcregistrymodal.failedToUploadAvatar"),
          );
        } finally {
          setUploadingNpcId(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
        }
      };
      reader.readAsDataURL(file);
    } catch {
      setUploadingNpcId(null);
    }
  };

  const triggerUpload = (npcId: string) => {
    selectedNpcForUploadRef.current = npcId;
    fileInputRef.current?.click();
  };

  const filteredNpcs = useMemo(() => {
    if (!data?.npcs) return [];
    if (!filterText.trim()) return data.npcs;
    const term = filterText.toLowerCase();
    return data.npcs.filter(
      (npc) =>
        npc.name.toLowerCase().includes(term) ||
        npc.aliases.some((alias) => alias.toLowerCase().includes(term)) ||
        (npc.gender && npc.gender.toLowerCase().includes(term)),
    );
  }, [data?.npcs, filterText]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={localizeUi("ui.npcRegistry.title", { defaultValue: "Story NPC Registry" })}
      width="max-w-2xl"
    >
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileSelected} />

      <div className="flex flex-col gap-3 p-1">
        {/* Search header */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--muted-foreground)]" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={localizeUi("ui.npcRegistry.searchPlaceholder", {
              defaultValue: "Search NPCs by name, alias, or pronoun...",
            })}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] py-1.5 pl-9 pr-3 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:border-[var(--primary)] focus:outline-none"
          />
        </div>

        {/* Content body */}
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-[var(--muted-foreground)]">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : !data?.active ? (
          <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-[var(--muted-foreground)]">
            <Users className="h-10 w-10 opacity-40" />
            <p>
              {localizeUi("ui.npcRegistry.notActive", {
                defaultValue:
                  "The NPC Registry agent is not active in this chat. Add it in Chat Settings → Agents → Tracker Agents to track named story characters.",
              })}
            </p>
          </div>
        ) : filteredNpcs.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)]">
            {filterText
              ? localizeUi("ui.npcRegistry.noMatches", { defaultValue: "No matching NPCs found." })
              : localizeUi("ui.npcRegistry.empty", {
                  defaultValue: "No named NPCs have been recorded yet in this story.",
                })}
          </div>
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-2 divide-y divide-[var(--border)]/30 overflow-y-auto pr-1">
            {filteredNpcs.map((npc) => {
              const isPromoting = promoteMutation.isPending && promoteMutation.variables?.id === npc.id;
              const isUploading = uploadingNpcId === npc.id;

              return (
                <div key={npc.id} className="flex items-center justify-between gap-3 pt-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Avatar circle */}
                    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--muted)]">
                      {npc.avatar ? (
                        <img src={npc.avatar} alt={npc.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-[var(--muted-foreground)]">
                          {npc.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => triggerUpload(npc.id)}
                        disabled={isUploading}
                        title={localizeUi("ui.npcRegistry.changeAvatar", { defaultValue: "Upload Avatar" })}
                        className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity hover:opacity-100 disabled:opacity-50"
                      >
                        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* NPC Details */}
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-[var(--foreground)]">{npc.name}</span>
                        {npc.gender && (
                          <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[0.625rem] font-medium text-[var(--muted-foreground)]">
                            {npc.gender}
                          </span>
                        )}
                      </div>
                      {npc.aliases.length > 0 && (
                        <span className="truncate text-xs text-[var(--muted-foreground)]">
                          {localizeUi("ui.npcRegistry.aliasesLabel", { defaultValue: "Also: " })}
                          {npc.aliases.join(", ")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => promoteMutation.mutate(npc)}
                      disabled={isPromoting}
                      title={localizeUi("ui.npcRegistry.promoteTitle", {
                        defaultValue: "Promote to full Character Card",
                      })}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--accent-foreground)] disabled:opacity-50"
                    >
                      {isPromoting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="h-3.5 w-3.5" />
                      )}
                      <span>{localizeUi("ui.npcRegistry.promoteBtn", { defaultValue: "Promote to Card" })}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
