"use client";

import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { XMarkIcon, PlayIcon, MegaphoneIcon } from "@heroicons/react/24/outline";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Announcement {
  id: string;
  title: string;
  subtitle?: string;
  content: string;
  content_type: "markdown" | "text" | "video";
  video_url?: string;
  video_thumbnail?: string;
  cta_label?: string;
  cta_url?: string;
  badge?: string;
  badge_color?: string;
  version: string;
}

export function AnnouncementPopup() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  useEffect(() => {
    // Wait a bit before showing to not overwhelm the user on startup
    const timer = setTimeout(() => {
      fetchAnnouncements();
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  const fetchAnnouncements = async () => {
    try {
      // In a real app, this version comes from IPC window.electronAPI.system.getVersion()
      // Hardcoded here for demo/fallback purposes
      let version = "1.4.0";
      if (typeof window !== "undefined" && (window as any).electronAPI?.system?.getVersion) {
        try {
          version = await (window as any).electronAPI.system.getVersion();
        } catch (e) {
          console.warn("Could not get version via IPC", e);
        }
      }

      // Generate or retrieve a device ID (store in localStorage for simplicity here)
      let deviceId = localStorage.getItem("everfern_device_id");
      if (!deviceId) {
        deviceId = "dev_" + Math.random().toString(36).substring(2, 15);
        localStorage.setItem("everfern_device_id", deviceId);
      }

      const baseUrl = "https://api.everfern.app";

      const res = await fetch(`${baseUrl}/api/announcements/active?version=${version}&device_id=${deviceId}`);

      if (!res.ok) return;

      const data = await res.json();
      if (data.announcements && data.announcements.length > 0) {
        setAnnouncements(data.announcements);
        setIsVisible(true);
      }
    } catch (err) {
      console.error("Failed to fetch announcements:", err);
    }
  };

  const markAsSeen = async (announcementId: string) => {
    try {
      const deviceId = localStorage.getItem("everfern_device_id");
      const baseUrl = "https://api.everfern.app";
      await fetch(`${baseUrl}/api/announcements/active`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcement_id: announcementId, device_id: deviceId }),
      });
    } catch (err) {
      console.error("Failed to mark announcement as seen", err);
    }
  };

  const handleDismiss = () => {
    const current = announcements[currentIndex];
    if (current) markAsSeen(current.id);

    if (currentIndex < announcements.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setIsVideoPlaying(false);
    } else {
      setIsVisible(false);
    }
  };

  const handleCTA = () => {
    const current = announcements[currentIndex];
    if (current?.cta_url) {
      // In electron, this should ideally use shell.openExternal
      if (typeof window !== "undefined" && (window as any).electronAPI?.system?.openExternal) {
        (window as any).electronAPI.system.openExternal(current.cta_url);
      } else {
        window.open(current.cta_url, "_blank");
      }
    }
    handleDismiss();
  };

  const current = announcements[currentIndex];

  const portalContent = (
    <AnimatePresence>
      {isVisible && current && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-6 sm:p-10 bg-black/60 backdrop-blur-sm" style={{ overflow: 'auto' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-[600px] rounded-[24px] overflow-hidden shadow-2xl border border-white/10 bg-[#0A0A0A] text-white"
          >
            {/* Header/Media Section */}
            <div className="relative w-full overflow-hidden bg-neutral-900">
              {/* Close Button */}
              <button
                onClick={handleDismiss}
                className="absolute top-5 right-5 z-10 p-2.5 rounded-full bg-black/40 hover:bg-black/80 text-white/70 hover:text-white backdrop-blur-md transition-colors"
              >
                <XMarkIcon className="w-5 h-5" />
              </button>

              {current.content_type === "video" && current.video_url ? (
                <div className="w-full aspect-video bg-black relative flex items-center justify-center group">
                  {!isVideoPlaying && current.video_thumbnail && (
                    <img
                      src={current.video_thumbnail}
                      alt="Video thumbnail"
                      className="absolute inset-0 w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity"
                    />
                  )}
                  {!isVideoPlaying ? (
                    <button
                      onClick={() => setIsVideoPlaying(true)}
                      className="relative z-10 w-16 h-16 rounded-full bg-white/10 hover:bg-white/20 backdrop-blur-md flex items-center justify-center text-white transition-all transform hover:scale-105 border border-white/20"
                    >
                      <PlayIcon className="w-8 h-8 ml-1" />
                    </button>
                  ) : (
                    <iframe
                      src={
                        current.video_url.includes("youtube")
                          ? current.video_url.replace("watch?v=", "embed/") + "?autoplay=1"
                          : current.video_url
                      }
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      className="w-full h-full border-0"
                    />
                  )}
                </div>
              ) : (
                <div className="w-full h-[180px] bg-[#141414] relative overflow-hidden flex items-center justify-center border-b border-white/5">
                  <div className="absolute inset-0 flex items-center justify-center opacity-10">
                    <MegaphoneIcon className="w-32 h-32 text-white" />
                  </div>
                  {/* Badge if present */}
                  {current.badge && (
                    <div style={{ position: 'absolute', top: '24px', left: '24px', zIndex: 10 }}>
                      <span style={{ padding: '6px 16px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.1em', borderRadius: '9999px', border: '1px solid rgba(255,255,255,0.2)', backgroundColor: 'rgba(0,0,0,0.5)', color: '#fff', backdropFilter: 'blur(12px)' }}>
                        {current.badge}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Content Section */}
            <div className="flex flex-col" style={{ padding: '40px 44px' }}>
              <div style={{ marginBottom: '20px' }}>
                <h3 style={{ fontSize: '28px', fontWeight: 400, color: '#fff', letterSpacing: '-0.02em', marginBottom: '8px', lineHeight: 1.2 }}>
                  {current.title}
                </h3>

                {current.subtitle && (
                  <p style={{ fontSize: '16px', color: '#a3a3a3', fontWeight: 400, lineHeight: 1.6 }}>
                    {current.subtitle}
                  </p>
                )}
              </div>

              <div className="custom-scrollbar" style={{ fontSize: '15px', color: '#d4d4d4', fontWeight: 300, lineHeight: 1.7, marginBottom: '28px', maxHeight: '360px', overflowY: 'auto', paddingRight: '16px' }}>
                {current.content_type === "markdown" ? (
                  <div className="prose prose-invert prose-base max-w-none prose-p:leading-[1.7] prose-p:my-2 prose-headings:font-normal prose-headings:mb-2 prose-headings:mt-4 prose-strong:font-normal prose-a:text-white prose-a:underline-offset-4 hover:prose-a:text-neutral-300">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {current.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{current.content}</div>
                )}
              </div>

              {/* CTA Button */}
              {current.cta_url && (
                <div style={{ marginTop: 'auto' }}>
                  <button
                    onClick={handleCTA}
                    style={{ width: '100%', padding: '14px 24px', borderRadius: '16px', fontSize: '16px', fontWeight: 400, backgroundColor: '#fff', color: '#000', border: 'none', cursor: 'pointer', transition: 'all 0.2s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e5e5e5'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fff'; }}
                  >
                    {current.cta_label || "Check it out"}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  if (typeof document === "undefined") return null;
  return createPortal(portalContent, document.body);
}