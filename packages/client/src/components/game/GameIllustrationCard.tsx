// custom-mods: Event CG / Scene Illustration card for Game Mode.
// Displays targeted illustrations produced by Illustrator 2 (or other image agents)
// directly on the Game Surface with full-screen lightbox, set-as-background, and animation actions.
import { useState, useMemo, useEffect, useCallback } from "react";
import { Film, Maximize2, Pin, Sparkles, Wallpaper, X, Check } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { Message, MessageAttachment } from "@marinara-engine/shared";
import { useGameAssetStore } from "../../stores/game-asset.store";
import { useGalleryStore } from "../../stores/gallery.store";
import { cn } from "../../lib/utils";
import { useTranslation as useUiTranslation } from "react-i18next";

interface GameIllustrationCardProps {
  chatId: string;
  message: Message | null;
  onSetBackground?: (url: string) => void;
  onAnimate?: (galleryId?: string) => void;
  className?: string;
}

interface ActiveIllustration {
  url: string;
  prompt?: string;
  reason?: string;
  galleryId?: string;
  messageId?: string;
}

export function GameIllustrationCard({
  chatId,
  message,
  onSetBackground,
  onAnimate,
  className,
}: GameIllustrationCardProps) {
  const { t: localizeUi } = useUiTranslation();
  const latestLiveIllustration = useGameAssetStore((s) => s.latestIllustration);
  const currentBackground = useGameAssetStore((s) => s.currentBackground);
  const pinImage = useGalleryStore((s) => s.pinImage);

  const [dismissedMessageId, setDismissedMessageId] = useState<string | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [backgroundApplied, setBackgroundApplied] = useState(false);
  const [pinned, setPinned] = useState(false);

  // Extract illustration from current turn message attachments
  const messageIllustration = useMemo<ActiveIllustration | null>(() => {
    if (!message) return null;
    try {
      const extra = typeof message.extra === "string" ? JSON.parse(message.extra) : message.extra;
      const attachments = (extra?.attachments ?? []) as MessageAttachment[];
      const imageAttachment = attachments.find(
        (att) => att.type === "image" || (typeof att.url === "string" && att.url.length > 0),
      );
      if (imageAttachment?.url) {
        return {
          url: imageAttachment.url,
          prompt: imageAttachment.prompt,
          galleryId: imageAttachment.galleryId,
          messageId: message.id,
        };
      }
    } catch {
      // Ignore parse failure
    }
    return null;
  }, [message]);

  // Prefer live SSE illustration if it belongs to this message/chat, else turn message attachment
  const activeIllustration = useMemo<ActiveIllustration | null>(() => {
    if (latestLiveIllustration && (!message || latestLiveIllustration.messageId === message.id)) {
      return latestLiveIllustration;
    }
    return messageIllustration;
  }, [latestLiveIllustration, message, messageIllustration]);

  // Reset dismissed state on message change
  useEffect(() => {
    setBackgroundApplied(false);
    setPinned(false);
  }, [message?.id]);

  // Handle escape key in lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  const handleApplyBackground = useCallback(() => {
    if (!activeIllustration?.url) return;
    onSetBackground?.(activeIllustration.url);
    setBackgroundApplied(true);
    setTimeout(() => setBackgroundApplied(false), 2500);
  }, [activeIllustration, onSetBackground]);

  const handlePin = useCallback(() => {
    if (!activeIllustration?.url) return;
    pinImage({
      id: activeIllustration.galleryId ?? `ill-${Date.now()}`,
      chatId,
      filePath: activeIllustration.url,
      prompt: activeIllustration.prompt ?? activeIllustration.reason ?? "Scene illustration",
      provider: "illustrator",
      model: "custom",
      createdAt: new Date().toISOString(),
      url: activeIllustration.url,
      width: null,
      height: null,
    });
    setPinned(true);
    setTimeout(() => setPinned(false), 2500);
  }, [activeIllustration, chatId, pinImage]);

  if (!activeIllustration || (message?.id && dismissedMessageId === message.id)) {
    return null;
  }

  const isCurrentBg = currentBackground === activeIllustration.url;

  return (
    <>
      {/* Floating Canvas Card */}
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -12, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "pointer-events-auto absolute right-3 top-14 z-40 flex w-64 flex-col overflow-hidden rounded-xl border border-white/20 bg-black/85 p-2.5 shadow-2xl backdrop-blur-md transition-shadow hover:shadow-[0_8px_32px_rgba(0,0,0,0.6)] sm:w-72",
            className,
          )}
          data-game-skip-bg-nav="true"
        >
          {/* Card Header */}
          <div className="mb-2 flex items-center justify-between gap-1.5 border-b border-white/10 pb-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-200">
              <Sparkles size={13} className="text-amber-300" />
              <span className="truncate">{activeIllustration.reason || "Scene Illustration"}</span>
            </div>
            <button
              type="button"
              onClick={() => message?.id && setDismissedMessageId(message.id)}
              className="flex h-5 w-5 items-center justify-center rounded text-white/50 transition-colors hover:bg-white/10 hover:text-white"
              title={localizeUi("ui.game.gameillustrationcard.dismissIllustrationForThisTurn")}
              aria-label={localizeUi("ui.game.gameillustrationcard.dismissIllustration")}
            >
              <X size={13} />
            </button>
          </div>

          {/* Thumbnail / Click to Expand */}
          <div
            className="group relative aspect-video w-full cursor-pointer overflow-hidden rounded-lg border border-white/10 bg-black/40"
            onClick={() => setLightboxOpen(true)}
            title={localizeUi("ui.game.gameillustrationcard.clickToViewFullIllustration")}
          >
            <img
              src={activeIllustration.url}
              alt={activeIllustration.reason || "Scene illustration"}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <span className="flex items-center gap-1 rounded-full bg-black/70 px-2.5 py-1 text-[0.6875rem] font-medium text-white shadow-md backdrop-blur-sm">
                <Maximize2 size={11} /> {localizeUi("ui.game.gameillustrationcard.expandCg")}
              </span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="mt-2 flex items-center justify-between gap-1 pt-0.5">
            <button
              type="button"
              onClick={handleApplyBackground}
              disabled={isCurrentBg}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[0.6875rem] font-medium transition-colors",
                isCurrentBg
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-default"
                  : "bg-white/10 text-white/90 hover:bg-white/20 hover:text-white border border-white/10",
              )}
              title={
                isCurrentBg
                  ? localizeUi("ui.game.gameillustrationcard.currentlyActiveSceneBackground")
                  : localizeUi("ui.game.gameillustrationcard.setAsGameSceneBackground")
              }
            >
              {backgroundApplied || isCurrentBg ? (
                <>
                  <Check size={12} className="text-emerald-400" />
                  <span>{localizeUi("ui.game.gameillustrationcard.sceneActive")}</span>
                </>
              ) : (
                <>
                  <Wallpaper size={12} />
                  <span>{localizeUi("ui.game.gameillustrationcard.setBackground")}</span>
                </>
              )}
            </button>

            {onAnimate && (
              <button
                type="button"
                onClick={() => onAnimate(activeIllustration.galleryId)}
                className="flex items-center justify-center rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[0.6875rem] font-medium text-white/90 transition-colors hover:bg-white/20 hover:text-white"
                title={localizeUi("ui.game.gameillustrationcard.generateAnMp4VideoFromThisIllustration")}
              >
                <Film size={12} />
              </button>
            )}

            <button
              type="button"
              onClick={handlePin}
              className="flex items-center justify-center rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[0.6875rem] font-medium text-white/90 transition-colors hover:bg-white/20 hover:text-white"
              title={
                pinned
                  ? localizeUi("ui.game.gameillustrationcard.pinnedToScreen")
                  : localizeUi("ui.game.gameillustrationcard.pinFloatingOverlay")
              }
            >
              <Pin size={12} className={pinned ? "text-amber-400 fill-amber-400" : ""} />
            </button>

            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              className="flex items-center justify-center rounded-md border border-white/10 bg-white/10 px-2 py-1 text-[0.6875rem] font-medium text-white/90 transition-colors hover:bg-white/20 hover:text-white"
              title={localizeUi("ui.game.gameillustrationcard.viewFullResolution")}
            >
              <Maximize2 size={12} />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Fullscreen Event CG Lightbox */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[95] flex flex-col items-center justify-center bg-black/90 p-4 backdrop-blur-md"
            onClick={() => setLightboxOpen(false)}
          >
            {/* Top Close Bar */}
            <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white/80 transition-colors hover:bg-white/30 hover:text-white"
                title={localizeUi("ui.game.gameillustrationcard.closeEsc")}
                aria-label={localizeUi("capabilities.actions.close")}
              >
                <X size={18} />
              </button>
            </div>

            {/* Main Full-Size Image */}
            <div
              className="relative flex max-h-[82vh] max-w-[92vw] items-center justify-center overflow-hidden rounded-xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={activeIllustration.url}
                alt={activeIllustration.reason || "Event CG"}
                className="max-h-[82vh] max-w-[92vw] object-contain rounded-xl"
              />
            </div>

            {/* Bottom Caption & Controls */}
            <div
              className="mt-3 flex max-w-2xl flex-col items-center gap-2 px-4 text-center"
              onClick={(e) => e.stopPropagation()}
            >
              {activeIllustration.reason && (
                <p className="text-sm font-medium text-amber-200">{activeIllustration.reason}</p>
              )}
              {activeIllustration.prompt && (
                <p className="max-h-20 overflow-y-auto text-xs text-white/70 italic leading-relaxed">
                  "{activeIllustration.prompt}"
                </p>
              )}

              <div className="mt-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleApplyBackground}
                  disabled={isCurrentBg}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-md transition-colors",
                    isCurrentBg
                      ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 cursor-default"
                      : "bg-white/20 text-white hover:bg-white/30 border border-white/20",
                  )}
                >
                  <Wallpaper size={14} />
                  <span>
                    {isCurrentBg
                      ? localizeUi("ui.game.gameillustrationcard.currentSceneBackground")
                      : localizeUi("ui.game.gameillustrationcard.setAsSceneBackground")}
                  </span>
                </button>

                {onAnimate && (
                  <button
                    type="button"
                    onClick={() => {
                      setLightboxOpen(false);
                      onAnimate(activeIllustration.galleryId);
                    }}
                    className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/20 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-colors hover:bg-white/30"
                  >
                    <Film size={14} />
                    <span>{localizeUi("ui.game.gameillustrationcard.animateVideo")}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={handlePin}
                  className="flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/20 px-3 py-1.5 text-xs font-semibold text-white shadow-md transition-colors hover:bg-white/30"
                >
                  <Pin size={14} className={pinned ? "text-amber-400 fill-amber-400" : ""} />
                  <span>
                    {pinned
                      ? localizeUi("ui.game.gameillustrationcard.pinned")
                      : localizeUi("ui.game.gameillustrationcard.pinOverlay")}
                  </span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
