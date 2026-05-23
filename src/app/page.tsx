"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import WindowControls from "./components/WindowControls";

export default function OnboardingPage() {
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const checkConfig = async () => {
      if ((window as any).electronAPI?.loadConfig) {
        const res = await (window as any).electronAPI.loadConfig();
        if (res.success && res.config) {
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
                  model: 'minimax-m2.7',
                  timestamp: new Date().toISOString(),
                  vlm: { engine: "everfern", provider: "everfern", model: "minimax-m2.7" }
              };
              await (window as any).electronAPI.saveConfig(config);
            }
            router.push("/chat");
            return;
          }
        } catch { }
      }

      setIsChecking(false);
    };
    checkConfig();
  }, [router]);

  if (isChecking) return <div className="min-h-screen bg-[#171615]" />;

  return (
    <main
      className="flex flex-col items-center justify-center min-h-screen bg-[#f5f4f0] text-[#201e24]"
      style={{ fontFamily: "var(--font-sans)" }}
    >
      {/* Window Controls - Top Right */}
      <div style={{ position: "fixed", top: 16, right: 20, zIndex: 100 }}>
        <WindowControls />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", bounce: 0.2, duration: 0.8 }}
        className="flex flex-col items-center text-center gap-6 px-8"
        style={{ maxWidth: 440 }}
      >
        {/* Logo */}
        <Image
          src="/images/logos/black-logo-withoutbg.png"
          alt="EverFern Logo"
          width={72}
          height={72}
        />

        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1
            style={{
              fontSize: 44,
              fontWeight: 400,
              letterSpacing: "-0.035em",
              color: "#201e24",
              lineHeight: 1.15,
              margin: 0,
            }}
          >
            Get started with{" "}
            <span style={{ fontWeight: 700 }}>EverFern</span>
          </h1>
          <p
            style={{
              fontSize: 15,
              color: "#71717a",
              fontWeight: 400,
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            The fastest way to orchestrate your workspace
          </p>
        </div>

        {/* CTA Button */}
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, type: "spring", bounce: 0.2, duration: 0.6 }}
          style={{ width: "100%", marginTop: 8 }}
        >
          <Link
            href="/auth"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              padding: "14px 24px",
              backgroundColor: "#201e24",
              color: "#ffffff",
              borderRadius: "12px",
              fontWeight: 600,
              fontSize: "15px",
              border: "none",
              cursor: "pointer",
              fontFamily: "var(--font-sans)",
              boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
              textDecoration: "none",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.opacity = "0.9";
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLAnchorElement).style.opacity = "1";
              (e.currentTarget as HTMLAnchorElement).style.transform = "translateY(0)";
            }}
          >
            Get started
            <ArrowRight size={18} style={{ marginLeft: 8, opacity: 0.8 }} />
          </Link>
        </motion.div>
      </motion.div>
    </main>
  );
}
