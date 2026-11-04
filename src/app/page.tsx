"use client";

import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ArrowRight, Bot, Mountain, Plug } from "lucide-react";
import { GlassShell, GlassTitle, GlassCard, GlassPill, stagger, rise } from "./components/onboarding/GlassShell";

const PILLARS = [
  { icon: Bot, name: "Workers", meta: "Your digital team", desc: "Describe a job once. A worker does it on its own computer, every time." },
  { icon: Mountain, name: "Own VM", meta: "Alpine Linux", desc: "Workers run in a small sandboxed Linux machine, not on your desktop." },
  { icon: Plug, name: "Your tools", meta: "Mail, docs, apps", desc: "Connect the apps you already use. Every action can be watched live." },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let active = true;
    const checkConfig = async () => {
      if ((window as any).electronAPI?.loadConfig) {
        // Wrap in a timeout — if the IPC bridge isn't ready yet (common on Mac at cold start)
        // the call can hang forever keeping isChecking=true (grey screen).
        const res = await Promise.race([
          (window as any).electronAPI.loadConfig(),
          new Promise<{ success: false }>((resolve) => setTimeout(() => resolve({ success: false }), 3000)),
        ]);
        if (!active) return;
        if (res.success && (res as any).config) {
          router.push("/chat");
          return;
        }
      }

      // Check if logged in via EverFern Cloud
      const stored = localStorage.getItem("everfern_cloud_session");
      if (stored) {
        try {
          const session = JSON.parse(stored);
          if (session?.user?.onboardingDone) {
            // Auto-save config and go to chat
            const token = session.accessToken;
            if (token && (window as any).electronAPI?.saveConfig) {
              const config = {
                  provider: 'everfern',
                  apiKey: token,
                  model: 'everfern-1',
                  timestamp: new Date().toISOString(),
                  vlm: { engine: "everfern", provider: "everfern", model: "everfern-1", apiKey: token }
              };
              await (window as any).electronAPI.saveConfig(config);
            }
            if (!active) return;
            router.push("/chat");
            return;
          }
        } catch { }
      }

      if (active) setIsChecking(false);
    };
    checkConfig();
    return () => { active = false; };
  }, [router]);

  // Calm placeholder during the IPC check: same frame colour as the shell, no flash
  if (isChecking) return <div style={{ position: "fixed", inset: 0, background: "#ececea" }} />;

  return (
    <GlassShell photo="lake" progress={[1, 3]} bottomLeft={<span>Open source · runs on your machine</span>}>
      <motion.div
        variants={stagger}
        initial="hidden"
        animate="show"
        style={{ width: "100%", maxWidth: 760, display: "flex", flexDirection: "column", alignItems: "center" }}
      >
        <GlassTitle
          title="Welcome to EverFern"
          subtitle="Build AI workers that use a computer the way you do: open apps, read mail, fill forms, and report back."
        />

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, width: "100%" }}>
          {PILLARS.map(({ icon: Icon, name, meta, desc }) => (
            <GlassCard key={name} style={{ cursor: "default" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="ef-icon-tile"><Icon size={17} strokeWidth={1.8} /></span>
                <div>
                  <div className="ef-card-name">{name}</div>
                  <div className="ef-card-meta">{meta}</div>
                </div>
              </div>
              <p className="ef-card-desc">{desc}</p>
            </GlassCard>
          ))}
        </div>

        <motion.div variants={rise} style={{ marginTop: 28, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <GlassPill onClick={() => router.push("/auth")}>
            Get started <ArrowRight size={15} />
          </GlassPill>
          <span className="ef-note">Takes about two minutes.</span>
        </motion.div>
      </motion.div>
    </GlassShell>
  );
}
