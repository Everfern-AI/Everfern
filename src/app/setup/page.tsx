"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence } from "framer-motion";
import {
    ChevronRight,
    ChevronLeft,
    Plus,
    Cpu,
    Cloud,
    Server,
    Key,
    ArrowRight,
    Globe,
    Sparkles,
    X,
    Coffee,
    Check,
    Shield,
    Star,
    Heart,
    ExternalLink,
} from "lucide-react";

import WindowControls from "../components/WindowControls";
import LinuxVMSetupStep from "./LinuxVMSetupStep";
import { useTheme } from "@/components/ThemeProvider";

// ── Provider Logos ────────────────

const OpenAILogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/openai.svg" alt="OpenAI Logo" width={size} height={size} className="dark:invert opacity-90" />
);

const AnthropicLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/claude.svg" alt="Anthropic Logo" width={size} height={size} className="grayscale opacity-80" />
);

const DeepSeekLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/deepseek.svg" alt="DeepSeek Logo" width={size} height={size} className="grayscale opacity-80" />
);

const GeminiLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/gemini.svg" alt="Gemini Logo" width={size} height={size} className="grayscale opacity-80" />
);

const NvidiaLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/nvidia.svg" alt="Nvidia Logo" width={size} height={size} className="grayscale opacity-80" />
);

const OpenRouterLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/openrouter.svg" alt="OpenRouter Logo" width={size} height={size} className="grayscale opacity-80" />
);

const MiniMaxLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/minimax.svg" alt="MiniMax Logo" width={size} height={size} className="grayscale opacity-80" />
);

const OllamaLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/ollama.svg" alt="Ollama Logo" width={size} height={size} className="dark:invert opacity-90" />
);

const DeepgramLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/Deepgram.svg" alt="Deepgram Logo" width={size} height={size} className="dark:invert opacity-90" />
);

const ElevenLabsLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/elevenlabs.svg" alt="ElevenLabs Logo" width={size} height={size} className="grayscale opacity-80" />
);

const LMStudioLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/lm-studio.png" alt="LM Studio Logo" width={size} height={size} className="grayscale opacity-80" />
);

const EverFernBglessLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/logos/black-logo-withoutbg.png" alt="EverFern Cloud" width={size} height={size} className="dark:invert opacity-90" />
);



const RedditIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="#FF4500" style={{ width: size, height: size }}>
        <g>
            <path d="M17.16,9.15a2,2,0,0,0-3.32-1.5,10.6,10.6,0,0,0-3.69-.65l.78-2.45,2.15.46a1.18,1.18,0,1,0,1.16-.94,1.19,1.19,0,0,0-1.12.83l-2.4-.51a.39.39,0,0,0-.45.27l-.87,2.74a10.87,10.87,0,0,0-3.81.64A2,2,0,0,0,2.26,9.15a2,2,0,0,0,1,1.75,8,8,0,0,0-.1,1.25,8,8,0,0,0,14.62,4,8,8,0,0,0-.1-1.25A2,2,0,0,0,17.16,9.15ZM6.21,11a1,1,0,1,1,1,1A1,1,0,0,1,6.21,11Zm7.33,3.78a5.27,5.27,0,0,1-7.08,0,.35.35,0,0,1,.49-.49,4.56,4.56,0,0,0,6.1,0,.35.35,0,0,1,.49.49Zm-.12-2.78a1,1,0,1,1,1-1A1,1,0,0,1,13.42,12Z" />
        </g>
    </svg>
);

const IndieHackersIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" style={{ width: size, height: size, color: "var(--color-text-primary)" }}>
        <path d="M0 0h24v24H0V0Zm5.4 17.2h2.4V6.8H5.4v10.4Zm4.8 0h2.4v-4h3.6v4h2.4V6.8h-2.4v4h-3.6v-4h-2.4v10.4Z"></path>
    </svg>
);

const TwitterIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" style={{ width: size, height: size }}>
        <g clipPath="url(#clip0_84_15697)">
            <rect width="512" height="512" fill="#000" rx="60"></rect>
            <path fill="#fff" d="M355.904 100H408.832L293.2 232.16L429.232 412H322.72L239.296 302.928L143.84 412H90.8805L214.56 270.64L84.0645 100H193.28L268.688 199.696L355.904 100ZM337.328 380.32H366.656L177.344 130.016H145.872L337.328 380.32Z"></path>
        </g>
        <defs>
            <clipPath id="clip0_84_15697">
                <rect width="512" height="512" fill="#fff"></rect>
            </clipPath>
        </defs>
    </svg>
);

const HackerNewsIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" style={{ width: size, height: size }}>
        <path fill="#F36003" d="M24 2.571A2.572 2.572 0 0 0 21.429 0H2.571A2.572 2.572 0 0 0 0 2.571v18.857A2.572 2.572 0 0 0 2.571 24h18.857A2.572 2.572 0 0 0 24 21.429V2.571zm-11.186 10.88v5.406h-1.682v-5.502L6.856 5.143h1.998c2.812 5.266 2.635 5.422 3.177 6.728.659-1.447.311-1.307 3.247-6.728h1.864l-4.329 8.309h.001z"></path>
    </svg>
);

const GitHubIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" style={{ width: size, height: size }}>
        <path fill="#00020c" fillRule="evenodd" d="m60,12c0-4.42-3.58-8-8-8H12c-4.42,0-8,3.58-8,8v40c0,4.42,3.58,8,8,8h40c4.42,0,8-3.58,8-8V12h0Z"></path>
        <path fill="#fff" fillRule="evenodd" d="m26.73,47.67c0,1.1-.01,2.3-.01,3.4,0,.26-.13.51-.34.67-.21.16-.49.2-.74.13-8.4-2.7-14.49-10.58-14.49-19.87,0-11.51,9.34-20.85,20.85-20.85s20.85,9.34,20.85,20.85c0,9.28-6.08,17.15-14.46,19.85-.25.08-.53.03-.74-.13-.21-.16-.34-.4-.34-.67-.02-2.45-.03-5.34-.03-6.65s-1.28-2.39-1.28-2.39c0,0,9.45-1.16,9.45-9.34,0-5.19-2.06-6.94-2.06-6.94.44-1.86.38-3.63-.1-5.31-.07-.24-.31-.4-.56-.38-2.01.18-3.85.91-5.52,2.24,0,0-2.95-.81-5.2-.81h0c-2.25,0-5.2.81-5.2.81-1.67-1.32-3.52-2.06-5.52-2.24-.25-.02-.49.14-.56.38-.48,1.68-.54,3.45-.11,5.31,0,0-2.05,1.75-2.05,6.94,0,8.18,9.45,9.34,9.45,9.34,0,0-1.28,1.08-1.28,2.39v.3c-.72.26-1.7.5-2.8.43-2.99-.2-3.39-3.42-4.62-3.94-.9-.38-1.78-.43-2.45-.37-.2.02-.36.16-.41.35-.05.19.02.39.18.51.81.55,1.89,1.33,2.19,1.9.81,1.52,2.06,3.93,3.67,4.19,1.96.32,3.36.13,4.25-.12h0Z"></path>
    </svg>
);

const OtherIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ width: size, height: size }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
    </svg>
);

const DiscordIcon = ({ size = 24 }: { size?: number }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5865F2" style={{ width: size, height: size }}>
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
);

// ── Types ────────────────
type LogKind = "info" | "cmd" | "success" | "warn" | "err" | "done" | "fail" | "pip" | "dl" | "muted";

interface LogLine {
    line: string;
    step: number;
    kind: LogKind;
    // pip progress fields (optional)
    pkg?: string;
    pct?: number;
    speed?: string;
    eta?: string;
}

// ── Log color map ────────────────
function logColor(kind: LogKind): string {
    switch (kind) {
        case "info": return "#60a5fa";   // blue — status messages
        case "cmd": return "#a78bfa";   // purple — shell commands
        case "pip": return "#f9a8d4";   // pink — pip package names
        case "dl": return "#34d399";   // green — download/clone lines
        case "success": return "#4ade80";   // bright green — success
        case "done": return "#4ade80";   // bright green
        case "warn": return "#fb923c";   // orange — warnings
        case "err": return "#f87171";   // red — errors
        case "fail": return 'var(--color-error)';   // red — fatal
        case "muted": return "#3f3f46";   // very dim — separators
        default: return "#71717a";   // gray — generic output
    }
}

// Shared transition config
const pageVariants = {
    enter: { opacity: 0, y: 12, scale: 0.99 },
    center: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -8, scale: 0.99 },
};
const pageTransition: any = { duration: 0.22, ease: [0.25, 0.1, 0.25, 1] };

// Reusable back button
const BackButton = ({ onClick }: { onClick: () => void }) => (
    <button
        onClick={onClick}
        style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: 'var(--color-text-tertiary)',
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 500,
            letterSpacing: "0.01em",
            padding: "4px 0",
            marginBottom: 32,
            transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-text-primary)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-tertiary)')}
    >
        <ChevronLeft size={15} strokeWidth={2} />
        Back
    </button>
);

// ── Steam animation for coffee cup ────────────────
const steamKeyframes = `
@keyframes steam {
    0%   { transform: translateY(0)   scaleX(1);   opacity: 0.7; }
    50%  { transform: translateY(-8px) scaleX(1.2); opacity: 0.4; }
    100% { transform: translateY(-16px) scaleX(0.8); opacity: 0; }
}
@keyframes spinnerAnim {
    to { transform: rotate(360deg); }
}
`;

// ── Coffee Break Banner ────────────────
function CoffeeBreakBanner({ currentPkg, pipPct, pipSpeed, overallPct }: {
    currentPkg: string;
    pipPct: number;
    pipSpeed: string;
    overallPct: number;
}) {
    return (
        <div style={{
            background: "rgba(32,30,36,0.04)",
            border: "1px solid rgba(32,30,36,0.1)",
            borderRadius: 16,
            padding: "16px 20px",
            display: "flex",
            alignItems: "center",
            gap: 18,
            marginBottom: 14,
        }}>
            {/* Coffee cup SVG with steam */}
            <style>{steamKeyframes}</style>
            <div style={{ flexShrink: 0, position: "relative" }}>
                <svg width="52" height="52" viewBox="0 0 52 52" fill="none">
                    {/* Steam trails */}
                    <path d="M17 12 Q19 7 17 2" stroke='var(--color-primary)' strokeWidth="1.5" strokeLinecap="round"
                        style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0s", opacity: 0.7 }} />
                    <path d="M23 12 Q25 6 23 1" stroke='var(--color-primary)' strokeWidth="1.5" strokeLinecap="round"
                        style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0.4s", opacity: 0.7 }} />
                    <path d="M29 12 Q31 7 29 2" stroke='var(--color-primary)' strokeWidth="1.5" strokeLinecap="round"
                        style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0.8s", opacity: 0.7 }} />
                    {/* Cup body */}
                    <rect x="9" y="15" width="28" height="22" rx="4"
                        fill="rgba(59,130,246,0.1)" stroke="rgba(59,130,246,0.35)" strokeWidth="1.2" />
                    {/* Liquid surface */}
                    <rect x="11" y="27" width="24" height="8" rx="2"
                        fill="rgba(59,130,246,0.18)" />
                    {/* Handle */}
                    <path d="M37 19 Q45 19 45 26 Q45 33 37 33"
                        stroke="rgba(59,130,246,0.35)" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    {/* Saucer */}
                    <ellipse cx="23" cy="39" rx="17" ry="3.5"
                        fill="rgba(59,130,246,0.07)" stroke="rgba(59,130,246,0.2)" strokeWidth="1" />
                </svg>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Take a coffee break</span>
                    <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const,
                        letterSpacing: "0.12em", background: "rgba(59,130,246,0.15)",
                        color: 'var(--color-primary)', padding: "2px 7px", borderRadius: 999,
                    }}>Installing</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.6, margin: "0 0 10px" }}>
                    This might take a few minutes. Dependencies are being downloaded automatically.
                </p>

                {/* Overall progress */}
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: "uppercase" as const, letterSpacing: "0.1em", fontWeight: 600 }}>
                            Overall Progress
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--color-text-primary)', fontFamily: "monospace" }}>
                            {Math.round(overallPct)}%
                        </span>
                    </div>
                    <div style={{ height: 4, background: "rgba(32,30,36,0.1)", borderRadius: 999, overflow: "hidden" }}>
                        <div style={{
                            height: "100%",
                            width: `${overallPct}%`,
                            background: "linear-gradient(90deg, #2563eb, #3b82f6)",
                            borderRadius: 999,
                            transition: "width 0.4s ease",
                        }} />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Pip Progress Bar ────────────────
function PipProgressBar({ pkg, pct, speed, eta }: {
    pkg: string; pct: number; speed: string; eta?: string;
}) {
    if (!pkg) return null;
    return (
        <div style={{
            padding: "8px 14px",
            borderBottom: "1px solid rgba(32,30,36,0.05)",
            background: "rgba(32,30,36,0.02)",
        }}>
            {/* Package name line */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5, fontFamily: "monospace", fontSize: 11.5 }}>
                <span style={{ color: 'var(--color-primary)' }}>Downloading</span>
                <span style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{pkg}</span>
                {speed && <span style={{ color: 'var(--color-text-tertiary)', marginLeft: "auto" }}>{speed}</span>}
                {eta && <span style={{ color: "#a1a1aa" }}>eta {eta}</span>}
            </div>
            {/* Progress bar row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* pip-style bar with block chars feel */}
                <div style={{
                    flex: 1, height: 6,
                    background: "rgba(32,30,36,0.1)",
                    borderRadius: 3, overflow: "hidden",
                }}>
                    <div style={{
                        height: "100%",
                        width: `${pct}%`,
                        background: 'var(--color-primary)',
                        borderRadius: 3,
                        transition: "width 0.2s linear",
                    }} />
                </div>
                <span style={{
                    fontSize: 10, fontFamily: "monospace",
                    color: pct === 100 ? "#16a34a" : 'var(--color-text-tertiary)',
                    minWidth: 32, textAlign: "right" as const,
                }}>
                    {pct}%
                </span>
            </div>
        </div>
    );
}

// ── Step Pills ────────────────
function StepPills({ installStep }: { installStep: number }) {
    const steps = [
        { icon: "📦", title: "Conda Env", desc: "Python 3.11" },
        { icon: "🌐", title: "Clone Repo", desc: "Latest ShowUI" },
        { icon: "🧱", title: "Dependencies", desc: "Torch & Vision" },
    ];
    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {steps.map((s, i) => {
                const isDone = i < installStep - 1;
                const isActive = i === installStep - 1;
                return (
                    <div key={i} style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 5,
                        padding: "12px 10px",
                        borderRadius: 12,
                        background: isDone
                            ? "rgba(34,197,94,0.08)"
                            : isActive
                                ? "rgba(59,130,246,0.08)"
                                : "rgba(32,30,36,0.03)",
                        border: isDone
                            ? "1px solid rgba(34,197,94,0.25)"
                            : isActive
                                ? "1px solid rgba(59,130,246,0.3)"
                                : "1px solid rgba(32,30,36,0.08)",
                        opacity: (!isDone && !isActive) ? 0.6 : 1,
                        transition: "all 0.3s ease",
                    }}>
                        <span style={{ fontSize: 18 }}>{s.icon}</span>
                        <div style={{
                            fontSize: 10, fontWeight: 700,
                            color: isDone ? "#16a34a" : isActive ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                            textTransform: "uppercase" as const, letterSpacing: "0.1em",
                        }}>{s.title}</div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{s.desc}</div>
                    </div>
                );
            })}
        </div>
    );
}

export default function SetupPage() {
    const router = useRouter();
    const { theme, setTheme } = useTheme();
    const [step, setStep] = useState(1);
    const [selectedTheme, setSelectedTheme] = useState<'light' | 'dark'>('light');
    const [referralSource, setReferralSource] = useState("");
    const [referralOtherText, setReferralOtherText] = useState("");
    const [submittingReferral, setSubmittingReferral] = useState(false);
    const [hasStarredRepo, setHasStarredRepo] = useState(false);

    const handleNextFromReferral = async () => {
        if (!referralSource) return;
        if (referralSource === 'other' && !referralOtherText.trim()) return;

        setSubmittingReferral(true);
        try {
            const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.everfern.app";
            const keyToUse = apiKey.trim() || undefined;

            await fetch(`${API_URL}/api/analytics/referral`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(keyToUse ? { 'Authorization': `Bearer ${keyToUse}` } : {})
                },
                body: JSON.stringify({
                    referral_source: referralSource,
                    other_details: referralSource === 'other' ? referralOtherText.trim() : null
                })
            });
        } catch (e) {
            console.error("Failed to submit referral info", e);
        } finally {
            setSubmittingReferral(false);
            setStep(9);
        }
    };

    // Force light theme by default during onboarding
    useEffect(() => {
        if (theme !== 'light') {
            setTheme('light');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Track app install once
    useEffect(() => {
        if (typeof window !== 'undefined' && !localStorage.getItem('everfern_install_tracked')) {
            const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.everfern.app";
            fetch(`${API_URL}/api/analytics/install`, { method: "POST" })
                .then(() => {
                    localStorage.setItem('everfern_install_tracked', 'true');
                })
                .catch(err => console.error("Failed to track install:", err));
        }
    }, []);

    const [engine, setEngine] = useState<"local" | "online" | "everfern" | null>(null);
    const [voiceProvider, setVoiceProvider] = useState<"deepgram" | "elevenlabs" | "local" | null>(null);
    const [voiceDeepgramKey, setVoiceDeepgramKey] = useState("");
    const [voiceElevenlabsKey, setVoiceElevenlabsKey] = useState("");
    const [provider, setProvider] = useState<string | null>(null);
    const [apiKey, setApiKey] = useState("");
    const [vlmMode, setVlmMode] = useState<"local" | "cloud" | "everfern">("local");
    const [vlmCloudProvider, setVlmCloudProvider] = useState("ollama");
    const [vlmCloudModel, setVlmCloudModel] = useState("qwen3-vl:235b-cloud");
    const [vlmCloudUrl, setVlmCloudUrl] = useState("https://ollama.com");
    const [vlmCloudKey, setVlmCloudKey] = useState("");
    const [showuiUrl, setShowuiUrl] = useState("http://127.0.0.1:7860");
    const [useShowUI, setUseShowUI] = useState<boolean | null>(null);
    const [isInstalling, setIsInstalling] = useState(false);
    const [installLogs, setInstallLogs] = useState<LogLine[]>([]);
    const [installStep, setInstallStep] = useState(0);
    const [installError, setInstallError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [showMoreModal, setShowMoreModal] = useState(false);

    const [pipPkg, setPipPkg] = useState("");
    const [pipPct, setPipPct] = useState(0);
    const [pipSpeed, setPipSpeed] = useState("");
    const [pipEta, setPipEta] = useState("");
    const [overallPct, setOverallPct] = useState(0);

    const [mockStep, setMockStep] = useState(0);

    useEffect(() => {
        if (step !== 6) return;
        const interval = setInterval(() => {
            setMockStep(prev => (prev + 1) % 6);
        }, 3000);
        return () => clearInterval(interval);
    }, [step]);

    // Ollama state
    const [ollamaInstalled, setOllamaInstalled] = useState<boolean | null>(null);
    const [modelInstalled, setModelInstalled] = useState<boolean | null>(null);
    const [isInstallingOllama, setIsInstallingOllama] = useState(false);
    const [ollamaInstallDone, setOllamaInstallDone] = useState(false);
    const [ollamaInstallPct, setOllamaInstallPct] = useState(0);
    const [ollamaInstallPhase, setOllamaInstallPhase] = useState<"downloading" | "finalizing" | "done">("downloading");
    const [isPullingModel, setIsPullingModel] = useState(false);
    const [ollamaLogs, setOllamaLogs] = useState<string[]>([]);
    const [pullPct, setPullPct] = useState(0);

    const stripAnsi = (str: string) => {
        return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
    };

    const checkOllamaStatus = async () => {
        if ((window as any).electronAPI?.system?.ollamaStatus) {
            const res = await (window as any).electronAPI.system.ollamaStatus();
            setOllamaInstalled(res.installed);
            setModelInstalled(res.modelInstalled);
            // If both are installed, and we are on step 4, we can finish early
            if (res.installed && res.modelInstalled && step === 4) {
                setStep(11);
            }
        }
    };

    const logEndRef = useRef<HTMLDivElement>(null);

    // Auto-scroll terminal
    useEffect(() => {
        logEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [installLogs, pipPct]);

    useEffect(() => {
        if ((window as any).electronAPI?.showui?.onInstallLine) {
            (window as any).electronAPI.showui.onInstallLine((data: any) => {
                // Handle progress overrides from script
                if (data.pct !== undefined) {
                    setOverallPct(data.pct);
                    // Infer step if pct is high enough
                    if (data.pct > 85) setInstallStep(3);
                    else if (data.pct > 40) setInstallStep(2);
                    else if (data.pct > 5) setInstallStep(1);
                }

                // Handle pip progress lines
                if (data.kind === "pip") {
                    if (data.pkg) setPipPkg(data.pkg);
                    if (data.pct !== undefined) {
                        setPipPct(data.pct);
                        // Micro-advance overall progress during pip for better UX
                        setOverallPct(prev => Math.min(prev + 0.1, 99));
                    }
                    if (data.speed) setPipSpeed(data.speed);
                    if (data.eta) setPipEta(data.eta);
                    return;
                }

                setInstallLogs(prev => [...prev, data]);

                if (data.step > 0 && data.pct === undefined) {
                    setInstallStep(prev => Math.max(prev, data.step));
                }

                if (data.kind === "fail") setInstallError(data.line);
                if (data.kind === "done") {
                    setIsInstalling(false);
                    setOverallPct(100);
                    setPipPkg("");
                }
            });
        }
        return () => {
            (window as any).electronAPI?.showui?.removeInstallListeners?.();
        };
    }, [installStep]);

    const startInstall = async () => {
        setIsInstalling(true);
        setInstallError(null);
        setInstallStep(1);
        setOverallPct(0);
        setPipPkg("");
        setPipPct(0);
        setInstallLogs([{
            line: "Initializing ShowUI installation pipeline...",
            step: 0,
            kind: "info",
        }]);
        try {
            const res = await (window as any).electronAPI.showui.install();
            if (!res.success) setInstallError(res.error || "Installation failed.");
        } catch (err) {
            setInstallError(String(err));
        } finally {
            setIsInstalling(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        const config: any = {
            engine, provider, apiKey,
            showuiUrl: useShowUI ? showuiUrl : undefined,
            timestamp: new Date().toISOString(),
        };
        if (voiceProvider) {
            config.voice = {
                provider: voiceProvider,
                deepgramKey: voiceDeepgramKey.trim() || undefined,
                elevenlabsKey: voiceElevenlabsKey.trim() || undefined
            };
        }
        // Add specialized VLM engine if Ollama is available OR cloud mode is selected
        if (vlmMode === "cloud" && vlmCloudModel.trim()) {
            let finalCloudKey = vlmCloudKey.trim() || undefined;
            if (vlmCloudProvider === 'everfern' && !finalCloudKey) {
                try {
                    const stored = localStorage.getItem("everfern_cloud_session");
                    if (stored) {
                        const parsed = JSON.parse(stored);
                        finalCloudKey = parsed?.accessToken;
                    }
                } catch { }
            }

            config.vlm = {
                engine: "cloud",
                provider: vlmCloudProvider,
                model: vlmCloudModel.trim() || getVisionDefaultModel(vlmCloudProvider),
                baseUrl: vlmCloudUrl.trim() || undefined,
                apiKey: finalCloudKey
            };
        } else if (vlmMode === "local" && (ollamaInstalled && modelInstalled)) {
            config.vlm = {
                engine: "local",
                provider: "ollama",
                model: "qwen3-vl:2b",
                baseUrl: "http://localhost:11434"
            };
            if (engine === "local") {
                config.provider = "ollama";
            }
        } else if (vlmMode === "everfern") {
            let cloudToken = undefined;
            try {
                const stored = localStorage.getItem("everfern_cloud_session");
                if (stored) {
                    cloudToken = JSON.parse(stored).accessToken;
                }
            } catch { }

            config.vlm = {
                engine: "everfern",
                provider: "everfern",
                model: "everfern-1",
                apiKey: cloudToken
            };
        }
        // Ensure main apiKey is set for everfern engine (token lives in VLM config)
        if (engine === "everfern" && !config.apiKey) {
            try {
                const stored = localStorage.getItem("everfern_cloud_session");
                if (stored) {
                    const session = JSON.parse(stored);
                    config.apiKey = session?.accessToken;
                }
            } catch { }
        }

        if ((window as any).electronAPI?.saveConfig) {
            await (window as any).electronAPI.saveConfig(config);
        }

        // Mark onboarding complete via landing API (fire-and-forget — best effort)
        try {
            const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "https://everfern.app";
            const stored = localStorage.getItem("everfern_cloud_session");
            if (stored) {
                const parsed = JSON.parse(stored);
                const accessToken = parsed?.accessToken;
                if (accessToken) {
                    await fetch(`${LANDING_URL}/api/user/onboarding-done`, {
                        method: "POST",
                        headers: { "Authorization": `Bearer ${accessToken}` },
                    });
                    // Update local session cache too
                    parsed.user.onboardingDone = true;
                    localStorage.setItem("everfern_cloud_session", JSON.stringify(parsed));
                }
            }
        } catch {
            // Not signed in as cloud user — skip silently
        }

        setTimeout(() => router.push("/chat"), 800);
    };

    const handleInstallOllama = async () => {
        setIsInstallingOllama(true);
        setOllamaInstallDone(false);
        setOllamaInstallPct(0);
        setOllamaInstallPhase("downloading");
        setOllamaLogs([]);
        if ((window as any).electronAPI?.system?.onOllamaInstallLine) {
            (window as any).electronAPI.system.onOllamaInstallLine((data: { line: string }) => {
                const line = data.line;
                // Parse percentage like "###### 78.5%" or "98.1%"
                const pctMatch = line.match(/(\d+\.?\d*)%/);
                if (pctMatch) {
                    const pct = parseFloat(pctMatch[1]);
                    setOllamaInstallPct(pct);
                    setOllamaInstallPhase(pct >= 100 ? "finalizing" : "downloading");
                }
                setOllamaLogs(prev => [...prev.slice(-40), line]);
            });
        }
        if ((window as any).electronAPI?.system?.ollamaInstall) {
            const res = await (window as any).electronAPI.system.ollamaInstall();
            if (res.success) {
                setOllamaInstalled(true);
                setOllamaInstallPct(100);
                setOllamaInstallPhase("done");
                setOllamaInstallDone(true);
                setOllamaLogs(["✓ Ollama installed successfully!"]);
            } else {
                setOllamaLogs(prev => [...prev, `✗ Installation failed with code ${res.code}`]);
            }
        }
        setIsInstallingOllama(false);
    };

    const handlePullModel = async () => {
        setIsPullingModel(true);
        setPullPct(0);
        setOllamaLogs([]);
        if ((window as any).electronAPI?.system?.onOllamaInstallLine) {
            (window as any).electronAPI.system.onOllamaInstallLine((data: { line: string }) => {
                const rawLine = data.line;
                const cleanLine = stripAnsi(rawLine);

                // Parse percentage like "###### 78.5%" or " 2%"
                const pctMatch = cleanLine.match(/(\d+\.?\d*)%/);
                if (pctMatch) {
                    const pct = parseFloat(pctMatch[1]);
                    // Only update if it's a progress update for a layer being pulled
                    if (cleanLine.includes("pulling") || cleanLine.includes("verifying")) {
                        setPullPct(pct);
                    }
                }

                setOllamaLogs(prev => {
                    const last = prev[prev.length - 1] || "";
                    // Update current line if it's a progress line
                    if (cleanLine.includes("pulling") && last.includes("pulling")) {
                        const newLogs = [...prev];
                        newLogs[newLogs.length - 1] = cleanLine;
                        return newLogs;
                    }
                    return [...prev.slice(-30), cleanLine];
                });
            });
        }
        try {
            const res = await (window as any).electronAPI.system.ollamaPull("qwen3-vl:2b");
            if (res.success) {
                setPullPct(100);
                setModelInstalled(true);
                // Go to final step (save) directly since we use an Omni model
                setTimeout(() => setStep(11), 1500);
            } else {
                setOllamaLogs(prev => [...prev, `✗ Model pull failed with code ${res.code}`]);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsPullingModel(false);
        }
    };

    return (
        <div
            className="flex flex-col min-h-screen bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-y-auto"
            style={{ fontFamily: "var(--font-sans)" }}
        >
            {/* ── Header ── */}
            <header
                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8, WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                    <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={18} height={18} style={{ filter: theme === 'dark' ? 'invert(1) brightness(0.9)' : 'none' }} />
                </div>
                <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                    <WindowControls />
                </div>
            </header>
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 20, gap: 6 }}>
                {(() => {
                    const getActiveDotIndex = () => {
                        if (step <= 4) return step;
                        if (step === 5) return 5;
                        if (step === 11) return 6;
                        if (step === 6) return 7;
                        if (step === 7) return 8;
                        if (step === 8) return 9;
                        if (step === 9) return 10;
                        if (step === 10) return 11;
                        if (step === 12) return 12;
                        return 12;
                    };
                    const activeIndex = getActiveDotIndex();
                    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(s => (
                        <div
                            key={s}
                            style={{
                                width: s === activeIndex ? 20 : 6,
                                height: 4,
                                borderRadius: 999,
                                background: s === activeIndex ? 'var(--color-text-primary)' : s < activeIndex ? 'var(--color-text-secondary)' : 'var(--color-border)',
                                transition: "all 0.3s ease",
                            }}
                        />
                    ));
                })()}
            </div>
            <main className="flex-1 flex flex-col items-center justify-center p-8">
                <AnimatePresence mode="wait">

                    {/* ── Step 1: Choose Engine ── */}
                    {step === 1 && (
                        <motion.div
                            key="step1"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", alignItems: "center" }}
                        >
                            <BackButton onClick={() => router.push("/auth")} />

                            <div style={{ textAlign: "center", marginBottom: 40 }}>
                                <h1 style={{ fontSize: 36, fontWeight: 500, letterSpacing: "-0.03em", color: 'var(--color-text-primary)', marginBottom: 10, lineHeight: 1.1 }}>
                                    Choose your engine
                                </h1>
                                <p style={{ fontSize: 14, color: 'var(--color-text-tertiary)', lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
                                    EverFern can power your workspace using local infrastructure or top-tier cloud providers.
                                </p>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, width: "100%" }}>
                                {[
                                    { id: "local", name: "Local Engine", icon: Cpu, desc: "Ollama or LM Studio" },
                                    { id: "online", name: "AI Provider", icon: Cloud, desc: "OpenAI, Anthropic, etc." },
                                    { id: "everfern", name: "EverFern Cloud", icon: EverFernBglessLogo, desc: "Managed & Optimized" }
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => {
                                            setEngine(opt.id as any);
                                            if (opt.id === "everfern") {
                                                const cloudSession = localStorage.getItem("everfern_cloud_session") || localStorage.getItem("everfern_auth_token");
                                                if (!cloudSession) {
                                                    router.push("/auth?redirect=/setup");
                                                    return;
                                                }
                                                setProvider("everfern");
                                                setStep(4);
                                                return;
                                            }
                                            setStep(2);
                                        }}
                                        disabled={false}
                                        style={{
                                            background: "rgba(255,255,255,0.02)",
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 16,
                                            padding: "28px 20px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 20,
                                            cursor: "pointer",
                                            transition: "all 0.18s ease",
                                            aspectRatio: "1",
                                            opacity: 1,
                                            position: "relative",
                                            overflow: "hidden"
                                        }}
                                        onMouseEnter={e => {
                                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)";
                                            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-text-tertiary)';
                                            (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                        }}
                                        onMouseLeave={e => {
                                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                                            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                                            (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                                        }}
                                    >

                                        <div style={{
                                            width: 52, height: 52, borderRadius: 14,
                                            background: "rgba(255,255,255,0.04)",
                                            border: "1px solid rgba(255,255,255,0.07)",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            color: "#71717a",
                                        }}>
                                            <opt.icon size={24} />
                                        </div>
                                        <div style={{ textAlign: "center" }}>
                                            <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 5, color: 'var(--color-text-primary)' }}>
                                                {opt.name}
                                            </div>
                                            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                                                {opt.desc}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* ── Step 2: Select Provider ── */}
                    {step === 2 && (
                        <motion.div
                            key="step2"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column" }}
                        >
                            <BackButton onClick={() => setStep(1)} />

                            <div style={{ marginBottom: 32 }}>
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", color: 'var(--color-text-primary)', marginBottom: 8, lineHeight: 1.2 }}>
                                    Select AI Provider
                                </h2>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                                    Pick the provider you want to connect.
                                </p>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {engine === "local" ? (
                                    <>
                                        {[
                                            { id: "ollama", name: "Ollama", logo: OllamaLogo },
                                            { id: "lmstudio", name: "LM Studio", logo: LMStudioLogo }
                                        ].map(p => (
                                            <ProviderRow key={p.id} p={p} onClick={() => { setProvider(p.id); setStep(3); }} />
                                        ))}
                                    </>
                                ) : engine === "online" ? (
                                    <>
                                        <style>{`
                                            .provider-scroll::-webkit-scrollbar {
                                                width: 6px;
                                            }
                                            .provider-scroll::-webkit-scrollbar-track {
                                                background: rgba(32,30,36,0.02);
                                                border-radius: 4px;
                                            }
                                            .provider-scroll::-webkit-scrollbar-thumb {
                                                background: rgba(32,30,36,0.15);
                                                border-radius: 4px;
                                            }
                                            .provider-scroll::-webkit-scrollbar-thumb:hover {
                                                background: rgba(32,30,36,0.25);
                                            }
                                        `}</style>
                                        <div className="provider-scroll" style={{ maxHeight: 460, overflowY: "auto", paddingRight: 8, display: "flex", flexDirection: "column", gap: 10 }}>
                                            {[
                                                { id: "openai", name: "OpenAI", logo: OpenAILogo },
                                                { id: "anthropic", name: "Anthropic", logo: AnthropicLogo },
                                                { id: "deepseek", name: "DeepSeek", logo: DeepSeekLogo },
                                                { id: "gemini", name: "Google Gemini", logo: GeminiLogo },
                                                { id: "ollama-cloud", name: "Ollama Cloud", logo: OllamaLogo },
                                                { id: "nvidia", name: "Nvidia NIM", logo: NvidiaLogo },
                                                { id: "openrouter", name: "OpenRouter", logo: OpenRouterLogo },
                                                { id: "minimax", name: "MiniMax", logo: MiniMaxLogo }
                                            ].map(p => (
                                                <ProviderRow key={p.id} p={p} onClick={() => { setProvider(p.id); setStep(3); }} />
                                            ))}
                                        </div>
                                    </>
                                ) : (
                                    <button
                                        onClick={() => {
                                            const sessionStr = localStorage.getItem("everfern_cloud_session");
                                            if (!sessionStr) {
                                                if (window.confirm("You must be logged in to EverFern Cloud to use this option. Go to login?")) {
                                                    router.push("/auth");
                                                }
                                                return;
                                            }
                                            setProvider("everfern"); setStep(4);
                                        }}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "16px 18px",
                                            borderRadius: 14,
                                            background: "rgba(32,30,36,0.04)",
                                            border: "1px solid rgba(32,30,36,0.1)",
                                            cursor: "pointer",
                                            transition: "all 0.15s",
                                            width: "100%"
                                        }}
                                        onMouseEnter={e => (e.currentTarget.style.background = "rgba(32,30,36,0.06)")}
                                        onMouseLeave={e => (e.currentTarget.style.background = "rgba(32,30,36,0.04)")}
                                    >
                                        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                                            <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(32,30,36,0.06)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                <EverFernBglessLogo size={18} />
                                            </div>
                                            <div style={{ textAlign: "left" }}>
                                                <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--color-text-primary)', display: "block" }}>EverFern Cloud</span>
                                                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Uses front tier models</span>
                                            </div>
                                        </div>
                                    </button>
                                )}


                            </div>
                        </motion.div>
                    )}

                    {/* ── Step 3: API Key ── */}
                    {step === 3 && (
                        <motion.div
                            key="step3"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 380, display: "flex", flexDirection: "column" }}
                        >
                            <BackButton onClick={() => setStep(2)} />

                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 36 }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: 16,
                                    background: "rgba(32,30,36,0.04)",
                                    border: "1px solid rgba(32,30,36,0.1)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    marginBottom: 20, color: 'var(--color-text-tertiary)',
                                }}>
                                    <Key size={24} strokeWidth={1.5} />
                                </div>
                                <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", color: 'var(--color-text-primary)', marginBottom: 8 }}>
                                    Authenticator
                                </h2>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6, maxWidth: 280 }}>
                                    {engine === "local"
                                        ? <>Enter your <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{provider}</span> Server URL below, or leave blank for default.</>
                                        : <>Enter your <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 500 }}>{provider}</span> API key below.</>
                                    }
                                </p>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                                <input
                                    type="password"
                                    placeholder={engine === "local" ? "Server URL (optional)" : "sk-••••••••••••"}
                                    value={apiKey}
                                    onChange={(e) => setApiKey(e.target.value)}
                                    style={{
                                        width: "100%", height: 52,
                                        background: "rgba(32,30,36,0.04)",
                                        border: "1px solid rgba(32,30,36,0.1)",
                                        borderRadius: 12,
                                        padding: "0 16px",
                                        color: 'var(--color-text-primary)', fontSize: 14,
                                        outline: "none",
                                        transition: "border-color 0.15s",
                                        boxSizing: "border-box",
                                    }}
                                    onFocus={e => (e.currentTarget.style.borderColor = "rgba(32,30,36,0.2)")}
                                    onBlur={e => (e.currentTarget.style.borderColor = "rgba(32,30,36,0.1)")}
                                />
                                <button
                                    onClick={async () => {
                                        await checkOllamaStatus();
                                        setStep(4);
                                    }}
                                    style={{
                                        width: "100%", height: 52,
                                        background: 'var(--color-text-primary)', color: 'var(--color-bg-base)',
                                        borderRadius: 12, fontWeight: 600, fontSize: 14,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        gap: 8, cursor: "pointer", border: "none",
                                        transition: "background 0.15s", letterSpacing: "0.01em",
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                                >
                                    Continue <ArrowRight size={16} strokeWidth={2.5} />
                                </button>
                            </div>

                            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: "center", marginTop: 20, lineHeight: 1.6 }}>
                                Keys are stored locally at{" "}
                                <code style={{ fontFamily: "monospace", color: 'var(--color-text-tertiary)', fontSize: 10.5 }}>~/.everfern/config.json</code>{" "}
                                and never sent to our servers.
                            </p>
                        </motion.div>
                    )}

                    {/* ── Step 4: Local Vision Model ── */}
                    {step === 4 && (
                        <motion.div
                            key="step4"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 540, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(engine === "everfern" ? 1 : 3)} />
                            </div>

                            <div style={{ marginBottom: 36 }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: 16,
                                    background: "rgba(32,30,36,0.04)",
                                    border: "1px solid rgba(32,30,36,0.1)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: "#60a5fa", margin: "40px auto 32px auto",
                                }}>
                                    <Cpu size={24} strokeWidth={1.5} />
                                </div>
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: 'var(--color-text-primary)', marginBottom: 12, lineHeight: 1.1 }}>
                                    Vision AI Setup
                                </h2>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6, maxWidth: 360, margin: "0 auto" }}>
                                    Install Ollama to run the Qwen3 VL 2B model locally, or connect your EverFern agent to a cloud-hosted vision API.
                                </p>
                            </div>

                            {/* Toggle Cards */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, width: "100%", marginBottom: 32 }}>
                                {[
                                    { id: "local", name: "Local GPU", icon: Cpu, desc: "Run Qwen3 VL 2B via Ollama locally." },
                                    { id: "cloud", name: "Cloud Provider", icon: Cloud, desc: "Use OpenAI, Anthropic, or others." },
                                    { id: "everfern", name: "EverFern Cloud", icon: EverFernBglessLogo, desc: "Managed & optimized by EverFern." }
                                ].map(opt => (
                                    <button
                                        key={opt.id}
                                        onClick={() => {
                                            if (opt.id === "everfern") {
                                                const cloudSession = localStorage.getItem("everfern_cloud_session") || localStorage.getItem("everfern_auth_token");
                                                if (!cloudSession) {
                                                    router.push("/auth?redirect=/setup");
                                                    return;
                                                }
                                            }
                                            setVlmMode(opt.id as any);
                                        }}
                                        style={{
                                            background: vlmMode === opt.id ? "rgba(32,30,36,0.06)" : "rgba(255,255,255,0.02)",
                                            border: `1px solid ${vlmMode === opt.id ? 'var(--color-text-tertiary)' : 'var(--color-border)'}`,
                                            borderRadius: 16,
                                            padding: "24px 16px",
                                            display: "flex",
                                            flexDirection: "column",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 16,
                                            cursor: "pointer",
                                            transition: "all 0.18s ease",
                                            opacity: 1,
                                            position: "relative"
                                        }}
                                        onMouseEnter={e => {
                                            if (vlmMode === opt.id) return;
                                            (e.currentTarget as HTMLElement).style.background = "rgba(32,30,36,0.02)";
                                            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-text-tertiary)';
                                        }}
                                        onMouseLeave={e => {
                                            if (vlmMode === opt.id) return;
                                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                                            (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                                        }}
                                    >
                                        {vlmMode === opt.id && (
                                            <div style={{ position: "absolute", top: 12, right: 12, color: 'var(--color-text-primary)' }}>
                                                <Check width={16} height={16} strokeWidth={2.5} />
                                            </div>
                                        )}
                                        <div style={{
                                            width: 46, height: 46, borderRadius: 12,
                                            background: "rgba(32,30,36,0.04)",
                                            border: "1px solid rgba(32,30,36,0.07)",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            color: "#71717a",
                                        }}>
                                            <opt.icon size={22} />
                                        </div>
                                        <div style={{ textAlign: "center" }}>
                                            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, color: 'var(--color-text-primary)' }}>
                                                {opt.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                                                {opt.desc}
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
                                {vlmMode === "local" && (
                                    <>
                                        {(ollamaInstalled === false || ollamaInstalled === null) ? (
                                            <div style={{ background: "rgba(32,30,36,0.04)", border: "1px solid rgba(32,30,36,0.1)", borderRadius: 16, padding: 24 }}>
                                                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(32,30,36,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                        <OllamaLogo size={22} />
                                                    </div>
                                                    <div style={{ textAlign: "left" }}>
                                                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>Install Ollama</div>
                                                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Required to run the local vision model</div>
                                                    </div>
                                                </div>
                                                <button onClick={handleInstallOllama} disabled={isInstallingOllama}
                                                    style={{ width: "100%", padding: "14px", backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg-base)', borderRadius: 12, fontWeight: 600, fontSize: 14, border: "none", cursor: isInstallingOllama ? "wait" : "pointer", opacity: isInstallingOllama ? 0.7 : 1 }}>
                                                    {isInstallingOllama ? "Installing..." : "Install Automatically"}
                                                </button>

                                                {/* Progress bar — shown while installing */}
                                                {(isInstallingOllama || ollamaInstallDone) && (
                                                    <div style={{ marginTop: 22 }}>
                                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                                                            <span style={{ fontSize: 12, color: ollamaInstallPhase === "done" ? "#4ade80" : "#a1a1aa", fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                                                                {ollamaInstallPhase === "downloading" && (
                                                                    <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>⬇ Downloading Ollama...</motion.span>
                                                                )}
                                                                {ollamaInstallPhase === "finalizing" && (
                                                                    <motion.span animate={{ opacity: [1, 0.4, 1] }} transition={{ repeat: Infinity, duration: 0.8 }}>⚙ Finalizing installation...</motion.span>
                                                                )}
                                                                {ollamaInstallPhase === "done" && <span>✓ Installation complete!</span>}
                                                            </span>
                                                            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontFamily: "monospace" }}>
                                                                {ollamaInstallPhase !== "done" ? `${ollamaInstallPct.toFixed(1)}%` : "100%"}
                                                            </span>
                                                        </div>
                                                        <div style={{ width: "100%", height: 6, borderRadius: 999, background: "rgba(32,30,36,0.1)", overflow: "hidden" }}>
                                                            <motion.div
                                                                animate={{ width: `${ollamaInstallPhase === "finalizing" ? 100 : ollamaInstallPct}%` }}
                                                                transition={{ ease: "linear", duration: 0.3 }}
                                                                style={{
                                                                    height: "100%", borderRadius: 999,
                                                                    background: ollamaInstallPhase === "done"
                                                                        ? "linear-gradient(90deg, #4ade80, #22c55e)"
                                                                        : "linear-gradient(90deg, #3b82f6, #60a5fa)",
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            <div style={{ background: "rgba(32,30,36,0.04)", border: "1px solid rgba(32,30,36,0.1)", borderRadius: 16, padding: 24, position: "relative" }}>
                                                <div style={{ position: "absolute", top: 12, right: 12, background: "rgba(74, 222, 128, 0.15)", color: "#4ade80", padding: "4px 8px", borderRadius: 8, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", border: "1px solid rgba(74, 222, 128, 0.3)" }}>Ollama Installed</div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                                                    <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(32,30,36,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                        <OllamaLogo size={22} />
                                                    </div>
                                                    <div style={{ textAlign: "left" }}>
                                                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)' }}>Qwen3 VL (2B)</div>
                                                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>~2.5 GB • Fast Local Inference</div>
                                                    </div>
                                                </div>
                                                <button onClick={handlePullModel} disabled={isPullingModel || isInstallingOllama}
                                                    style={{ width: "100%", padding: "14px", backgroundColor: 'var(--color-primary)', color: 'var(--color-bg-surface)', borderRadius: 12, fontWeight: 600, fontSize: 14, border: "none", cursor: (isPullingModel || isInstallingOllama) ? "wait" : "pointer", opacity: (isPullingModel || isInstallingOllama) ? 0.7 : 1 }}>
                                                    {isPullingModel ? `Downloading... ${pullPct.toFixed(1)}%` : "Download & Set as Default"}
                                                </button>

                                                {/* Pull progress bar */}
                                                {isPullingModel && (
                                                    <div style={{ marginTop: 18 }}>
                                                        <div style={{ width: "100%", height: 6, borderRadius: 999, background: "rgba(32,30,36,0.1)", overflow: "hidden" }}>
                                                            <motion.div
                                                                animate={{ width: `${pullPct}%` }}
                                                                transition={{ ease: "linear", duration: 0.3 }}
                                                                style={{ height: "100%", borderRadius: 999, background: "linear-gradient(90deg, #3b82f6, #60a5fa)" }}
                                                            />
                                                        </div>
                                                        <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8, textAlign: "center" }}>Downloading model weights... ~2.5 GB total</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Terminal Output for Ollama */}
                                        {(ollamaLogs.length > 0) && (
                                            <div style={{ width: "100%", height: 120, backgroundColor: 'var(--color-bg-base)', borderRadius: 12, padding: 12, border: "1px solid rgba(32,30,36,0.1)", overflowY: "auto", textAlign: "left" }}>
                                                <pre style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                                                    {ollamaLogs.join('\n')}
                                                </pre>
                                            </div>
                                        )}
                                    </>
                                )}

                                {vlmMode === "cloud" && (
                                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>Provider</label>
                                            <select value={vlmCloudProvider} onChange={(e) => {
                                                const provider = e.target.value;
                                                setVlmCloudProvider(provider);
                                                setVlmCloudModel(getVisionDefaultModel(provider));
                                                setVlmCloudUrl(getVisionDefaultBaseUrl(provider));
                                            }}
                                                style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, outline: "none", cursor: "pointer", transition: "all 0.2s" }}>
                                                <option value="ollama" style={{ background: 'var(--color-bg-base)' }}>Ollama Compatible Endpoint</option>
                                                <option value="everfern" style={{ background: 'var(--color-bg-base)' }}>EverFern Cloud</option>
                                                <option value="openrouter" style={{ background: 'var(--color-bg-base)' }}>OpenRouter</option>
                                                <option value="minimax" style={{ background: 'var(--color-bg-base)' }}>MiniMax API</option>
                                                <option value="openai" style={{ background: 'var(--color-bg-base)' }}>OpenAI</option>
                                                <option value="anthropic" style={{ background: 'var(--color-bg-base)' }}>Anthropic</option>
                                                <option value="nvidia" style={{ background: 'var(--color-bg-base)' }}>Nvidia NIM</option>
                                            </select>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>Model Name</label>
                                            <div style={{ position: "relative" }}>
                                                {vlmCloudProvider === 'ollama' ? (
                                                    <select value={vlmCloudModel} onChange={(e) => setVlmCloudModel(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, outline: "none", cursor: "pointer", transition: "all 0.2s" }}>
                                                        <option value="qwen3-vl:235b-cloud">Qwen3 VL 235B (Default)</option>
                                                        <option value="kimi-k2.6:cloud">Kimi K2.6 Cloud</option>
                                                        <option value="glm-5.1:cloud">GLM 5.1 Cloud</option>
                                                    </select>
                                                ) : vlmCloudProvider === 'everfern' ? (
                                                    <select value={vlmCloudModel} onChange={(e) => setVlmCloudModel(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, outline: "none", cursor: "pointer", transition: "all 0.2s" }}>
                                                        <option value="everfern-vision-v1">EverFern Vision v1 (Default)</option>
                                                    </select>
                                                ) : (
                                                    <>
                                                        <input type="text" placeholder={getVisionDefaultModel(vlmCloudProvider)} value={vlmCloudModel} onChange={(e) => setVlmCloudModel(e.target.value)}
                                                            style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                            onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                            onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                                        <Cpu size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: 'var(--color-text-tertiary)' }} />
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {vlmCloudProvider !== 'ollama' && vlmCloudProvider !== 'everfern' && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>Host URL (Optional)</label>
                                                <div style={{ position: "relative" }}>
                                                    <input type="text" placeholder="Optional custom base URL" value={vlmCloudUrl} onChange={(e) => setVlmCloudUrl(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                        onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                        onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                                    <Globe size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: 'var(--color-text-tertiary)' }} />
                                                </div>
                                            </div>
                                        )}
                                        {vlmCloudProvider !== 'everfern' && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                                <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>API Key</label>
                                                <div style={{ position: "relative" }}>
                                                    <input type="password" placeholder="sk-..." value={vlmCloudKey} onChange={(e) => setVlmCloudKey(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                        onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                        onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                                    <Key size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: 'var(--color-text-tertiary)' }} />
                                                </div>
                                            </div>
                                        )}
                                        <button onClick={() => setStep(11)} disabled={isSaving || !vlmCloudModel.trim()} style={{ marginTop: 12, width: "100%", padding: "16px", backgroundColor: vlmCloudModel.trim() ? 'var(--color-text-primary)' : "rgba(32,30,36,0.1)", color: vlmCloudModel.trim() ? 'var(--color-bg-base)' : 'var(--color-text-tertiary)', borderRadius: 14, fontWeight: 600, fontSize: 14, border: "none", cursor: vlmCloudModel.trim() ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
                                            {isSaving ? "Saving..." : "Save & Continue"}
                                        </button>
                                    </div>
                                )}

                                {vlmMode === "everfern" && (
                                    <button
                                        onClick={() => setStep(11)}
                                        style={{
                                            width: "100%", height: 52,
                                            background: 'var(--color-text-primary)', color: 'var(--color-bg-base)',
                                            borderRadius: 12, fontWeight: 600, fontSize: 14,
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            gap: 8, cursor: "pointer", border: "none",
                                            transition: "background 0.15s", letterSpacing: "0.01em"
                                        }}
                                    >
                                        Continue <ArrowRight size={16} strokeWidth={2.5} />
                                    </button>
                                )}
                            </div>

                            <button onClick={() => setStep(11)} style={{ marginTop: 24, fontSize: 13, color: 'var(--color-text-tertiary)', background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}>
                                Skip local AI setup & Continue
                            </button>
                        </motion.div>
                    )}


                    {/* ── Step 11: Voice Setup ── */}
                    {step === 11 && (
                        <motion.div
                            key="step11"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 540, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(vlmMode === "local" ? 5 : 4)} />
                            </div>

                            <div style={{ marginBottom: 36 }}>
                                <div style={{
                                    width: 56, height: 56, borderRadius: 16,
                                    background: "rgba(32,30,36,0.04)",
                                    border: "1px solid rgba(32,30,36,0.1)",
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    color: "#60a5fa", margin: "40px auto 32px auto",
                                }}>
                                    <Sparkles size={24} strokeWidth={1.5} />
                                </div>
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: 'var(--color-text-primary)', marginBottom: 12, lineHeight: 1.1 }}>
                                    Voice AI Setup
                                </h2>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6, maxWidth: 360, margin: "0 auto" }}>
                                    Configure how EverFern listens and talks to you, using local or cloud-hosted voice APIs.
                                </p>
                            </div>

                            {/* Toggle Cards */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, width: "100%", marginBottom: 32 }}>
                                {[
                                    { id: "none", name: "Disabled", logo: () => <X size={20} />, desc: "Disable Voice Mode features." },
                                    { id: "local", name: "Local ASR", logo: () => <OllamaLogo size={20} />, desc: "Auto-managed local STT." },
                                    { id: "deepgram", name: "Deepgram", logo: () => <DeepgramLogo size={20} />, desc: "Online speech-to-text API." },
                                    { id: "elevenlabs", name: "ElevenLabs", logo: () => <ElevenLabsLogo size={20} />, desc: "Online speech & voice API." }
                                ].map(opt => {
                                    const isSel = (opt.id === "none" && voiceProvider === null) || voiceProvider === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            onClick={() => setVoiceProvider(opt.id === "none" ? null : opt.id as any)}
                                            style={{
                                                background: isSel ? "rgba(32,30,36,0.06)" : "rgba(255,255,255,0.02)",
                                                border: `1px solid ${isSel ? 'var(--color-text-tertiary)' : 'var(--color-border)'}`,
                                                borderRadius: 16,
                                                padding: "20px 16px",
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 12,
                                                cursor: "pointer",
                                                transition: "all 0.18s ease",
                                                opacity: 1,
                                                position: "relative"
                                            }}
                                            onMouseEnter={e => {
                                                if (isSel) return;
                                                (e.currentTarget as HTMLElement).style.background = "rgba(32,30,36,0.02)";
                                                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-text-tertiary)';
                                                (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                            }}
                                            onMouseLeave={e => {
                                                if (isSel) return;
                                                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                                                (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)';
                                                (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
                                            }}
                                        >
                                            <div style={{
                                                width: 44, height: 44, borderRadius: 12,
                                                background: "rgba(255,255,255,0.04)",
                                                border: "1px solid rgba(255,255,255,0.07)",
                                                display: "flex", alignItems: "center", justifyContent: "center",
                                                color: isSel ? "var(--color-text-primary)" : "#71717a",
                                            }}>
                                                <opt.logo />
                                            </div>
                                            <div style={{ textAlign: "center" }}>
                                                <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, color: 'var(--color-text-primary)' }}>
                                                    {opt.name}
                                                </div>
                                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.35 }}>
                                                    {opt.desc}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Inputs for keys */}
                            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16, marginBottom: 32 }}>
                                {voiceProvider === "deepgram" && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>Deepgram API Key</label>
                                        <div style={{ position: "relative" }}>
                                            <input type="password" placeholder="sk-..." value={voiceDeepgramKey} onChange={(e) => setVoiceDeepgramKey(e.target.value)}
                                                style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                            <Key size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: 'var(--color-text-tertiary)' }} />
                                        </div>
                                    </div>
                                )}
                                {voiceProvider === "elevenlabs" && (
                                    <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                        <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>ElevenLabs API Key</label>
                                        <div style={{ position: "relative" }}>
                                            <input type="password" placeholder="sk_..." value={voiceElevenlabsKey} onChange={(e) => setVoiceElevenlabsKey(e.target.value)}
                                                style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: 'var(--color-text-primary)', fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                            <Key size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: 'var(--color-text-tertiary)' }} />
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                onClick={() => setStep(5)}
                                disabled={(voiceProvider === "deepgram" && !voiceDeepgramKey.trim()) || (voiceProvider === "elevenlabs" && !voiceElevenlabsKey.trim())}
                                style={{
                                    width: "100%", height: 52,
                                    background: ((voiceProvider === "deepgram" && !voiceDeepgramKey.trim()) || (voiceProvider === "elevenlabs" && !voiceElevenlabsKey.trim())) ? "rgba(32,30,36,0.1)" : 'var(--color-text-primary)',
                                    color: ((voiceProvider === "deepgram" && !voiceDeepgramKey.trim()) || (voiceProvider === "elevenlabs" && !voiceElevenlabsKey.trim())) ? 'var(--color-text-tertiary)' : 'var(--color-bg-base)',
                                    borderRadius: 12, fontWeight: 600, fontSize: 14,
                                    display: "flex", alignItems: "center", justifyContent: "center",
                                    gap: 8, cursor: ((voiceProvider === "deepgram" && !voiceDeepgramKey.trim()) || (voiceProvider === "elevenlabs" && !voiceElevenlabsKey.trim())) ? "not-allowed" : "pointer", border: "none",
                                    transition: "all 0.2s", letterSpacing: "0.01em"
                                }}
                            >
                                Continue <ArrowRight size={16} strokeWidth={2.5} />
                            </button>
                        </motion.div>
                    )}

                    {/* ── Step 5: Linux VM Setup ── */}
                    {step === 5 && (
                        <motion.div
                            key="step5"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 600, display: "flex", flexDirection: "column", alignItems: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(11)} />
                            </div>
                            <LinuxVMSetupStep
                                onComplete={() => setStep(6)}
                                onSkip={() => setStep(6)}
                            />
                        </motion.div>
                    )}

                    {/* ── Step 6: Browser Extension (Navis) ── */}
                    {step === 6 && (
                        <motion.div
                            key="step6"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 540, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(5)} />
                            </div>

                            <div style={{ marginBottom: 16 }}>
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: 'var(--color-text-primary)', marginBottom: 12, lineHeight: 1.1 }}>
                                    Install Navis Extension
                                </h2>
                                <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', lineHeight: 1.6, maxWidth: 380, margin: "0 auto" }}>
                                    Navis browses the web for you — booking flights, filling forms, and more. Install the extension to get started.
                                </p>
                            </div>

                            {/* Browser UI Mockup */}
                            <style>{`
                                @keyframes pulseDot {
                                    0% { opacity: 0.5; transform: scale(0.9); }
                                    50% { opacity: 1; transform: scale(1.15); }
                                    100% { opacity: 0.5; transform: scale(0.9); }
                                }
                            `}</style>
                            <div style={{
                                width: "100%",
                                maxWidth: 520,
                                background: 'var(--color-bg-surface)',
                                border: "1px solid rgba(32, 30, 36, 0.1)",
                                borderRadius: 16,
                                overflow: "hidden",
                                margin: "20px auto 28px",
                                boxShadow: "0 8px 32px rgba(32,30,36,0.08), 0 1px 2px rgba(0,0,0,0.04)",
                            }}>
                                {/* Browser Tab Bar */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "10px 14px 0",
                                    background: theme === 'dark' ? "#201e24" : "#f7f7f6",
                                    borderBottom: theme === 'dark' ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(32,30,36,0.06)",
                                }}>
                                    {/* Window dots */}
                                    <div style={{ display: "flex", gap: 6, marginRight: 14 }}>
                                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f56" }} />
                                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#ffbd2e" }} />
                                        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#27c93f" }} />
                                    </div>
                                    {/* Tabs */}
                                    <div style={{
                                        display: "flex", gap: 2, flex: 1,
                                    }}>
                                        <div style={{
                                            padding: "7px 14px",
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: 'var(--color-text-primary)',
                                            background: 'var(--color-bg-surface)',
                                            borderRadius: "8px 8px 0 0",
                                            border: "1px solid rgba(32,30,36,0.08)",
                                            borderBottom: "1px solid #ffffff",
                                            position: "relative",
                                            bottom: -1,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                        }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke='var(--color-text-tertiary)' strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                                            SkyBooker.com
                                        </div>
                                        <div style={{
                                            padding: "7px 14px",
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color: theme === 'dark' ? "#71717a" : "#a09f9c",
                                            background: theme === 'dark' ? "#27272a" : "#f0efed",
                                            borderRadius: "8px 8px 0 0",
                                            position: "relative",
                                            bottom: -1,
                                        }}>
                                            Hotels
                                        </div>
                                    </div>
                                </div>

                                {/* URL Bar */}
                                <div style={{
                                    display: "flex",
                                    alignItems: "center",
                                    padding: "8px 14px",
                                    gap: 8,
                                    background: 'var(--color-bg-surface)',
                                    borderBottom: theme === 'dark' ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(32,30,36,0.06)",
                                }}>
                                    {/* Nav buttons */}
                                    <div style={{ display: "flex", gap: 10, color: 'var(--color-text-tertiary)', alignItems: "center" }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
                                        {/* Reload icon */}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" /></svg>
                                        {/* Home icon */}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></svg>
                                    </div>
                                    <div style={{
                                        flex: 1,
                                        background: theme === 'dark' ? "#27272a" : "#f5f4f2",
                                        borderRadius: 8,
                                        padding: "6px 12px",
                                        fontSize: 11,
                                        color: 'var(--color-text-tertiary)',
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke='var(--color-success)' strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                                            <span style={{ color: 'var(--color-success)', fontWeight: 500 }}>Secure |</span>
                                            <span>skybooker.com/flights/NYC-to-LAX</span>
                                        </div>
                                        {/* Bookmark Star Icon */}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a09f9c" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>
                                    </div>
                                    {/* Extension Icon & Navis icon in toolbar */}
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        {/* Puzzle icon */}
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke='var(--color-text-tertiary)' strokeWidth="2.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" /><path d="M12 6v12M6 12h12" /></svg>
                                        {/* Navis extension icon */}
                                        <div style={{
                                            width: 22, height: 22, borderRadius: 6,
                                            background: 'var(--color-text-primary)',
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            boxShadow: "0 0 8px rgba(32,30,36,0.25)"
                                        }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke='var(--color-bg-base)' strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* Main Browser Body */}
                                <div style={{
                                    display: "flex",
                                    background: theme === 'dark' ? "#18181b" : "#fdfdfc",
                                    height: 290,
                                    position: "relative",
                                    overflow: "hidden"
                                }}>
                                    {/* Webpage Area (Left) */}
                                    <div style={{
                                        flex: 1,
                                        padding: "12px 14px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 8,
                                        background: theme === 'dark' ? "#1f1f22" : "#faf9f6",
                                        height: "100%",
                                        position: "relative",
                                        overflow: "hidden",
                                        transition: "all 0.3s ease",
                                    }}>
                                        {/* Webpage Header/Toolbar */}
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            borderBottom: theme === 'dark' ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(32,30,36,0.06)",
                                            paddingBottom: 6,
                                            marginBottom: 2,
                                        }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: "uppercase", letterSpacing: "0.05em" }}>
                                                SkyBooker
                                            </span>
                                            {/* Page control buttons */}
                                            <div style={{ display: "flex", gap: 6 }}>
                                                {/* Aa Text Size Button */}
                                                <div style={{
                                                    position: "relative",
                                                    padding: "3px 6px",
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    borderRadius: 4,
                                                    background: mockStep >= 2 ? 'var(--color-text-primary)' : "rgba(32,30,36,0.05)",
                                                    color: mockStep >= 2 ? 'var(--color-bg-surface)' : 'var(--color-text-tertiary)',
                                                    border: "1px solid rgba(32,30,36,0.08)",
                                                    transition: "all 0.2s ease",
                                                    transform: mockStep === 2 ? "scale(0.9)" : "scale(1)",
                                                    boxShadow: mockStep === 2 ? "0 0 8px rgba(32,30,36,0.2)" : "none",
                                                }}>
                                                    Aa
                                                    {mockStep === 2 && (
                                                        <motion.div
                                                            style={{
                                                                position: "absolute",
                                                                width: 30,
                                                                height: 30,
                                                                borderRadius: "50%",
                                                                background: "rgba(32,30,36,0.15)",
                                                                border: "2px solid #201e24",
                                                                pointerEvents: "none",
                                                                left: "50%",
                                                                top: "50%",
                                                                marginLeft: -15,
                                                                marginTop: -15,
                                                            }}
                                                            initial={{ scale: 0.3, opacity: 0.8 }}
                                                            animate={{ scale: 1.5, opacity: 0 }}
                                                            transition={{ duration: 0.6, repeat: Infinity }}
                                                        />
                                                    )}
                                                </div>
                                                {/* Layout Contrast Button */}
                                                <div style={{
                                                    position: "relative",
                                                    padding: "3px 6px",
                                                    fontSize: 10,
                                                    fontWeight: 600,
                                                    borderRadius: 4,
                                                    background: mockStep >= 4 ? "#16a34a" : "rgba(32,30,36,0.05)",
                                                    color: mockStep >= 4 ? 'var(--color-bg-surface)' : 'var(--color-text-tertiary)',
                                                    border: "1px solid rgba(32,30,36,0.08)",
                                                    transition: "all 0.2s ease",
                                                    transform: mockStep === 4 ? "scale(0.9)" : "scale(1)",
                                                    boxShadow: mockStep === 4 ? "0 0 8px rgba(22,163,74,0.3)" : "none",
                                                }}>
                                                    ◐
                                                    {mockStep === 4 && (
                                                        <motion.div
                                                            style={{
                                                                position: "absolute",
                                                                width: 30,
                                                                height: 30,
                                                                borderRadius: "50%",
                                                                background: "rgba(22,163,74,0.15)",
                                                                border: "2px solid #16a34a",
                                                                pointerEvents: "none",
                                                                left: "50%",
                                                                top: "50%",
                                                                marginLeft: -15,
                                                                marginTop: -15,
                                                            }}
                                                            initial={{ scale: 0.3, opacity: 0.8 }}
                                                            animate={{ scale: 1.5, opacity: 0 }}
                                                            transition={{ duration: 0.6, repeat: Infinity }}
                                                        />
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Flight Search Params (Full UI look) */}
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            background: "rgba(32,30,36,0.03)",
                                            borderRadius: 8,
                                            padding: "4px 8px",
                                            fontSize: 8.5,
                                            color: "#6b7280",
                                            marginBottom: 2,
                                        }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{ fontWeight: 600, color: "#374151" }}>JFK</span>
                                                <span style={{ color: 'var(--color-text-tertiary)' }}>⇄</span>
                                                <span style={{ fontWeight: 600, color: "#374151" }}>LAX</span>
                                            </div>
                                            <div>June 15 • 1 Adult • Economy</div>
                                        </div>

                                        {/* Filters row */}
                                        <div style={{
                                            display: "flex",
                                            gap: 4,
                                            marginBottom: 2,
                                        }}>
                                            {["Stops", "Price", "Times", "Airlines"].map((filter, i) => (
                                                <div key={i} style={{
                                                    fontSize: 7.5,
                                                    padding: "2px 6px",
                                                    background: 'var(--color-bg-surface)',
                                                    border: "1px solid #e5e7eb",
                                                    borderRadius: 4,
                                                    color: 'var(--color-text-secondary)',
                                                }}>
                                                    {filter}
                                                </div>
                                            ))}
                                        </div>

                                        {/* Card 1 (Targeted & Dynamic) */}
                                        <div style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: mockStep >= 3 ? 10 : 6,
                                            padding: mockStep >= 3 ? "12px 14px" : "8px 10px",
                                            background: mockStep >= 4 ? 'var(--color-bg-surface)' : "#fafaf9",
                                            borderRadius: 10,
                                            border: mockStep >= 4 ? "1.5px solid #201e24" : "1px solid rgba(32,30,36,0.06)",
                                            boxShadow: mockStep >= 4 ? "0 4px 12px rgba(32,30,36,0.06)" : "none",
                                            transition: "all 0.3s ease",
                                        }}>
                                            {/* Flight header */}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <span style={{
                                                    fontSize: mockStep >= 3 ? 13 : 10,
                                                    fontWeight: 700,
                                                    color: 'var(--color-text-primary)',
                                                    transition: "font-size 0.3s ease"
                                                }}>
                                                    JFK → LAX (JetStream)
                                                </span>
                                                <span style={{
                                                    fontSize: mockStep >= 3 ? 9 : 7.5,
                                                    fontWeight: 600,
                                                    color: mockStep >= 4 ? "#15803d" : "#16a34a",
                                                    background: mockStep >= 4 ? "#dcfce7" : "#f0fdf4",
                                                    padding: "1px 5px",
                                                    borderRadius: 4,
                                                    transition: "all 0.3s ease"
                                                }}>
                                                    Best Price
                                                </span>
                                            </div>

                                            {/* Flight details row */}
                                            <div style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr auto 1fr",
                                                gap: 6,
                                                alignItems: "center",
                                            }}>
                                                <div>
                                                    <div style={{
                                                        fontSize: mockStep >= 3 ? 17 : 13,
                                                        fontWeight: 800,
                                                        color: 'var(--color-text-primary)',
                                                        transition: "font-size 0.3s ease"
                                                    }}>06:30 AM</div>
                                                    <div style={{ fontSize: mockStep >= 3 ? 9.5 : 8, color: 'var(--color-text-tertiary)' }}>JFK</div>
                                                </div>
                                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                                    <div style={{ fontSize: 7.5, color: "#a09f9c" }}>5h 20m</div>
                                                    <div style={{ width: 35, height: 1.5, background: "#e2e1de", position: "relative" }}>
                                                        <motion.div
                                                            style={{
                                                                position: "absolute", top: -2.5, left: 0,
                                                                width: 6, height: 6, borderRadius: "50%",
                                                                background: 'var(--color-text-primary)',
                                                            }}
                                                            animate={{ left: ["0%", "90%"] }}
                                                            transition={{ repeat: Infinity, duration: 2.5, ease: "easeInOut" }}
                                                        />
                                                    </div>
                                                    <div style={{ fontSize: 7, color: "#16a34a", fontWeight: 500 }}>Non-stop</div>
                                                </div>
                                                <div style={{ textAlign: "right" }}>
                                                    <div style={{
                                                        fontSize: mockStep >= 3 ? 17 : 13,
                                                        fontWeight: 800,
                                                        color: 'var(--color-text-primary)',
                                                        transition: "font-size 0.3s ease"
                                                    }}>11:50 AM</div>
                                                    <div style={{ fontSize: mockStep >= 3 ? 9.5 : 8, color: 'var(--color-text-tertiary)' }}>LAX</div>
                                                </div>
                                            </div>

                                            {/* Price and Book button */}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                                                <div style={{
                                                    fontSize: mockStep >= 3 ? 16 : 12,
                                                    fontWeight: 800,
                                                    color: 'var(--color-text-primary)',
                                                    transition: "font-size 0.3s ease"
                                                }}>$127</div>
                                                <div style={{
                                                    padding: mockStep >= 3 ? "5px 10px" : "3px 6px",
                                                    background: mockStep >= 4 ? "#16a34a" : 'var(--color-text-primary)',
                                                    color: 'var(--color-bg-base)',
                                                    borderRadius: 5,
                                                    fontSize: mockStep >= 3 ? 9.5 : 8,
                                                    fontWeight: 600,
                                                    transition: "all 0.3s ease"
                                                }}>
                                                    Book Now
                                                </div>
                                            </div>
                                        </div>

                                        {/* Card 2 (Alternative Option, Static) */}
                                        <div style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: 5,
                                            padding: "8px 10px",
                                            background: "#fafaf9",
                                            borderRadius: 10,
                                            border: "1px solid rgba(32,30,36,0.04)",
                                            opacity: 0.5,
                                            transition: "all 0.3s ease",
                                        }}>
                                            {/* Flight header */}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                                <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                                                    JFK → LAX (United Airlines)
                                                </span>
                                            </div>

                                            {/* Flight details row */}
                                            <div style={{
                                                display: "grid",
                                                gridTemplateColumns: "1fr auto 1fr",
                                                gap: 6,
                                                alignItems: "center",
                                            }}>
                                                <div>
                                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)' }}>08:15 AM</div>
                                                    <div style={{ fontSize: 7.5, color: 'var(--color-text-tertiary)' }}>JFK</div>
                                                </div>
                                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                                    <div style={{ fontSize: 7, color: 'var(--color-text-tertiary)' }}>6h 40m</div>
                                                    <div style={{ width: 35, height: 1, background: 'var(--color-border)' }} />
                                                    <div style={{ fontSize: 6.5, color: 'var(--color-text-tertiary)' }}>1 stop (ORD)</div>
                                                </div>
                                                <div style={{ textAlign: "right" }}>
                                                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)' }}>02:55 PM</div>
                                                    <div style={{ fontSize: 7.5, color: 'var(--color-text-tertiary)' }}>LAX</div>
                                                </div>
                                            </div>

                                            {/* Price */}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 1 }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-secondary)' }}>$154</div>
                                            </div>
                                        </div>

                                        {/* Scanner Overlay during scanning step */}
                                        {mockStep === 1 && (
                                            <motion.div
                                                style={{
                                                    position: "absolute",
                                                    left: 0,
                                                    right: 0,
                                                    height: 3,
                                                    background: "linear-gradient(90deg, rgba(32,30,36,0) 0%, rgba(32,30,36,0.3) 50%, rgba(32,30,36,0) 100%)",
                                                }}
                                                animate={{ top: ["0%", "100%"] }}
                                                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                                            />
                                        )}

                                        {/* Mouse Cursor */}
                                        <motion.div
                                            style={{
                                                position: "absolute",
                                                pointerEvents: "none",
                                                zIndex: 50,
                                            }}
                                            animate={{
                                                x: mockStep === 0 ? 300 : mockStep === 1 ? 170 : mockStep === 2 ? 285 : mockStep === 3 ? 220 : mockStep === 4 ? 313 : 300,
                                                y: mockStep === 0 ? 180 : mockStep === 1 ? 130 : mockStep === 2 ? 24 : mockStep === 3 ? 80 : mockStep === 4 ? 24 : 180,
                                                opacity: (mockStep === 0 || mockStep === 5) ? 0 : 1,
                                            }}
                                            transition={{ duration: 0.8, ease: "easeInOut" }}
                                        >
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                                <path d="M4 4l7.67 18.25 2.55-7.7 7.7-2.55L4 4z" fill='var(--color-text-primary)' stroke='var(--color-bg-surface)' strokeWidth="2.5" />
                                            </svg>
                                        </motion.div>
                                    </div>

                                    {/* Navis AI Panel Sidebar (Right) */}
                                    <div style={{
                                        width: 180,
                                        background: 'var(--color-text-primary)',
                                        color: 'var(--color-bg-base)',
                                        borderLeft: "1px solid rgba(255,255,255,0.08)",
                                        padding: "12px 10px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: 10,
                                        height: "100%",
                                        textAlign: "left",
                                    }}>
                                        {/* AI Header */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <span style={{
                                                width: 6, height: 6, borderRadius: "50%",
                                                background: mockStep === 5 ? 'var(--color-success)' : "#a78bfa",
                                                boxShadow: mockStep === 5 ? "0 0 6px #10b981" : "0 0 6px #a78bfa",
                                                animation: "pulseDot 1.5s infinite"
                                            }} />
                                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#a1a1aa", textTransform: "uppercase" }}>
                                                Navis AI Panel
                                            </span>
                                        </div>

                                        {/* User prompt box */}
                                        <div style={{
                                            background: "rgba(255,255,255,0.05)",
                                            border: "1px solid rgba(255,255,255,0.08)",
                                            borderRadius: 6,
                                            padding: "6px 8px",
                                        }}>
                                            <div style={{ fontSize: 7, color: 'var(--color-text-tertiary)', textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 2 }}>
                                                User Request
                                            </div>
                                            <div style={{ fontSize: 9.5, color: 'var(--color-bg-surface)', fontWeight: 500, lineHeight: 1.3 }}>
                                                &quot;make booking page better, increase size&quot;
                                            </div>
                                        </div>

                                        {/* Steps list */}
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, marginTop: 4 }}>
                                            {[
                                                { text: "Scanning page structure...", doneText: "Scanned page structure" },
                                                { text: "Increasing text size...", doneText: "Clicked 'Increase Size'" },
                                                { text: "Optimizing contrast...", doneText: "Optimized contrast & layout" },
                                                { text: "Completing changes...", doneText: "Done! Page optimized" }
                                            ].map((item, idx) => {
                                                const stepNum = idx + 1;
                                                const isActive = mockStep === stepNum;
                                                const isDone = mockStep > stepNum;
                                                const isPending = mockStep < stepNum;

                                                if (isPending) return null;

                                                return (
                                                    <div key={idx} style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: 6,
                                                        fontSize: 9,
                                                        fontWeight: isActive ? 600 : 400,
                                                        color: isDone ? "#a1a1aa" : isActive ? 'var(--color-bg-surface)' : 'var(--color-text-tertiary)',
                                                        transition: "all 0.3s ease",
                                                    }}>
                                                        {isDone ? (
                                                            <span style={{ color: 'var(--color-success)', fontWeight: "bold" }}>✓</span>
                                                        ) : (
                                                            <span style={{
                                                                display: "inline-block",
                                                                width: 5, height: 5, borderRadius: "50%",
                                                                background: "#a78bfa",
                                                            }} />
                                                        )}
                                                        <span>{isDone ? item.doneText : item.text}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Store Buttons */}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, width: "100%", maxWidth: 420, marginBottom: 18 }}>
                                <button
                                    onClick={async () => {
                                        const url = "https://chromewebstore.google.com/detail/everfern-navis/pipkiglicdhcacieghoinohgfibhkmgf?hl=en&authuser=0";
                                        if ((window as any).electronAPI?.shell?.openExternal) {
                                            await (window as any).electronAPI.shell.openExternal(url);
                                        } else {
                                            window.open(url, "_blank");
                                        }
                                    }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 10,
                                        padding: "14px 18px",
                                        borderRadius: 14,
                                        background: 'var(--color-bg-surface)',
                                        border: "1px solid rgba(32,30,36,0.1)",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 13,
                                        color: 'var(--color-text-primary)',
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                        transition: "all 0.15s ease",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = "rgba(32,30,36,0.02)";
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.2)";
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = 'var(--color-bg-surface)';
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.1)";
                                    }}
                                >
                                    {/* Chrome Grey SVG */}
                                    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                        <circle cx="24" cy="24" r="22" fill="#d4d4d4" />
                                        <circle cx="24" cy="24" r="9" fill='var(--color-bg-surface)' />
                                        <circle cx="24" cy="24" r="5.5" fill="#a3a3a3" />
                                        <path d="M24 2C14 2 5.7 8.4 3 17l12.5.5L24 15a9 9 0 0 1 8.5 5H46A22 22 0 0 0 24 2z" fill="#b0b0b0" />
                                        <path d="M32.5 20A9 9 0 0 1 28 32.5L34 44A22 22 0 0 0 46 20H32.5z" fill="#c0c0c0" />
                                        <path d="M20 32.5A9 9 0 0 1 15.5 17L3 17a22 22 0 0 0 31 27l-6-11.5z" fill="#9a9a9a" />
                                    </svg>
                                    Add to Chrome
                                </button>
                                <button
                                    onClick={async () => {
                                        const url = "https://addons.mozilla.org/en-US/firefox/addon/everfern-navis/";
                                        if ((window as any).electronAPI?.shell?.openExternal) {
                                            await (window as any).electronAPI.shell.openExternal(url);
                                        } else {
                                            window.open(url, "_blank");
                                        }
                                    }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 10,
                                        padding: "14px 18px",
                                        borderRadius: 14,
                                        background: 'var(--color-bg-surface)',
                                        border: "1px solid rgba(32,30,36,0.1)",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 13,
                                        color: 'var(--color-text-primary)',
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                        transition: "all 0.15s ease",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = "rgba(32,30,36,0.02)";
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.2)";
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = 'var(--color-bg-surface)';
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.1)";
                                    }}
                                >
                                    {/* Firefox Grey SVG */}
                                    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                        <circle cx="24" cy="24" r="22" fill="#c8c8c8" />
                                        <path d="M42 16c.5-3-1-6.5-4-8-2 4-4.5 6.5-5.5 11.5-2 7-7 11-11 12-6 1.5-12-3-12-9 0-6 6-10 10-10 3 0 5 2 5 3s-2 2-3 0c-1-1.5-3-1-4 1s0 4 2 4c5 0 8-3 9-7C30 5 22 2 22 2s9-2 17 3c4 3 5 7 3 11z" fill="#a0a0a0" />
                                        <path d="M14 24c0 6 4 11 10 11s10-5 10-11-4-11-10-11-10 5-10 11z" fill="#b8b8b8" fillOpacity="0.4" />
                                    </svg>
                                    Add to Firefox
                                </button>
                            </div>

                            {/* GitHub Link */}
                            <button
                                onClick={async () => {
                                    const url = "https://github.com/Everfern-AI/Navis-Extension";
                                    if ((window as any).electronAPI?.shell?.openExternal) {
                                        await (window as any).electronAPI.shell.openExternal(url);
                                    } else {
                                        window.open(url, "_blank");
                                    }
                                }}
                                style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 12,
                                    color: 'var(--color-text-tertiary)',
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    textDecoration: "none",
                                    marginBottom: 24,
                                    fontWeight: 500,
                                    transition: "color 0.15s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-primary)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>
                                View source code on GitHub
                            </button>

                            {/* Continue button */}
                            <button
                                onClick={() => setStep(7)}
                                style={{
                                    width: "100%",
                                    maxWidth: 420,
                                    height: 52,
                                    background: 'var(--color-text-primary)',
                                    color: 'var(--color-bg-base)',
                                    borderRadius: 12,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    cursor: "pointer",
                                    border: "none",
                                    transition: "background 0.15s",
                                    letterSpacing: "0.01em",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                            >
                                Continue <ArrowRight size={16} strokeWidth={2.5} />
                            </button>
                        </motion.div>
                    )}

                    {/* ── Step 7: Choose Theme ── */}
                    {step === 7 && (
                        <motion.div
                            key="step7"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", alignItems: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(6)} />
                            </div>

                            <div style={{ textAlign: "center", marginBottom: 40 }}>
                                <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em", color: "var(--color-text-primary)", marginBottom: 10, lineHeight: 1.1 }}>
                                    Choose your theme
                                </h1>
                                <p style={{ fontSize: 14, color: "var(--color-text-tertiary)", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
                                    Pick the look that feels right. You can always change this later in Settings.
                                </p>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, width: "100%", maxWidth: 480, marginBottom: 36 }}>
                                {/* Light Theme Card */}
                                <button
                                    onClick={() => {
                                        setSelectedTheme('light');
                                        setTheme('light');
                                    }}
                                    style={{
                                        background: selectedTheme === 'light' ? "var(--color-bg-surface)" : "var(--color-bg-subtle)",
                                        border: selectedTheme === 'light' ? "2px solid #10b981" : "2px solid var(--color-border)",
                                        borderRadius: 20,
                                        padding: 0,
                                        cursor: "pointer",
                                        transition: "all 0.2s ease",
                                        overflow: "hidden",
                                        boxShadow: selectedTheme === 'light' ? "0 0 0 4px rgba(16,185,129,0.15)" : "none",
                                    }}
                                >
                                    {/* Light mode preview */}
                                    <div style={{ background: "#f5f4f1", padding: "14px 14px 10px", borderBottom: '1px solid var(--color-border)' }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24" }} />
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
                                        </div>
                                        <div style={{ display: "flex", gap: 6, height: 70 }}>
                                            {/* Sidebar strip */}
                                            <div style={{ width: 28, background: "#eceae6", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 6 }}>
                                                {[1, 2, 3].map(i => <div key={i} style={{ width: 12, height: 3, borderRadius: 2, background: "#c4c2bc" }} />)}
                                            </div>
                                            {/* Content area */}
                                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                <div style={{ height: 10, background: "#e2e0dc", borderRadius: 4, width: "70%" }} />
                                                <div style={{ height: 8, background: "#e9e7e3", borderRadius: 4, width: "90%" }} />
                                                <div style={{ height: 8, background: "#e9e7e3", borderRadius: 4, width: "80%" }} />
                                                <div style={{ marginTop: 4, height: 20, background: 'var(--color-text-primary)', borderRadius: 6, width: "60%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                    <div style={{ width: 24, height: 2, borderRadius: 1, background: "rgba(255,255,255,0.6)" }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", textAlign: "left" }}>Light</div>
                                            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "left" }}>Clean & bright</div>
                                        </div>
                                        {selectedTheme === 'light' && (
                                            <div style={{ width: 20, height: 20, borderRadius: "50%", background: 'var(--color-success)', display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                <Check size={11} strokeWidth={3} color="white" />
                                            </div>
                                        )}
                                    </div>
                                </button>

                                {/* Dark Theme Card */}
                                <button
                                    onClick={() => {
                                        setSelectedTheme('dark');
                                        setTheme('dark');
                                    }}
                                    style={{
                                        background: selectedTheme === 'dark' ? "var(--color-bg-surface)" : "var(--color-bg-subtle)",
                                        border: selectedTheme === 'dark' ? "2px solid #10b981" : "2px solid var(--color-border)",
                                        borderRadius: 20,
                                        padding: 0,
                                        cursor: "pointer",
                                        transition: "all 0.2s ease",
                                        overflow: "hidden",
                                        boxShadow: selectedTheme === 'dark' ? "0 0 0 4px rgba(16,185,129,0.15)" : "none",
                                    }}
                                >
                                    {/* Dark mode preview */}
                                    <div style={{ background: "#1a1917", padding: "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#f87171" }} />
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fbbf24" }} />
                                            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
                                        </div>
                                        <div style={{ display: "flex", gap: 6, height: 70 }}>
                                            {/* Sidebar strip */}
                                            <div style={{ width: 28, background: "#201e1c", borderRadius: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, paddingTop: 6 }}>
                                                {[1, 2, 3].map(i => <div key={i} style={{ width: 12, height: 3, borderRadius: 2, background: "#3a3835" }} />)}
                                            </div>
                                            {/* Content area */}
                                            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                                                <div style={{ height: 10, background: "#2e2c29", borderRadius: 4, width: "70%" }} />
                                                <div style={{ height: 8, background: "#252320", borderRadius: 4, width: "90%" }} />
                                                <div style={{ height: 8, background: "#252320", borderRadius: 4, width: "80%" }} />
                                                <div style={{ marginTop: 4, height: 20, background: 'var(--color-success)', borderRadius: 6, width: "60%", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                    <div style={{ width: 24, height: 2, borderRadius: 1, background: "rgba(255,255,255,0.6)" }} />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", textAlign: "left" }}>Dark</div>
                                            <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "left" }}>Easy on the eyes</div>
                                        </div>
                                        {selectedTheme === 'dark' && (
                                            <div style={{ width: 20, height: 20, borderRadius: "50%", background: 'var(--color-success)', display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                <Check size={11} strokeWidth={3} color="white" />
                                            </div>
                                        )}
                                    </div>
                                </button>
                            </div>

                            <button
                                onClick={() => setStep(8)}
                                style={{
                                    width: "100%",
                                    maxWidth: 420,
                                    height: 52,
                                    background: 'var(--color-text-primary)',
                                    color: 'var(--color-bg-base)',
                                    borderRadius: 12,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    cursor: "pointer",
                                    border: "none",
                                    transition: "background 0.15s",
                                    letterSpacing: "0.01em",
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                            >
                                Continue <ArrowRight size={16} strokeWidth={2.5} />
                            </button>
                        </motion.div>
                    )}

                    {/* ── Step 8: Referral Survey ── */}
                    {step === 8 && (
                        <motion.div
                            key="step8"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 540, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(7)} />
                            </div>

                            <div style={{ width: 64, height: 64, borderRadius: 24, margin: "0 auto 24px", background: "rgba(32,30,36,0.03)", border: "1px solid rgba(32,30,36,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <Sparkles size={28} color="var(--color-text-primary)" />
                            </div>

                            <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em", color: "var(--color-text-primary)", marginBottom: 12, lineHeight: 1.1 }}>
                                Where did you find us?
                            </h1>
                            <p style={{ fontSize: 14, color: "var(--color-text-tertiary)", lineHeight: 1.6, maxWidth: 360, margin: "0 auto 32px" }}>
                                Help us understand how you discovered EverFern.
                            </p>

                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24, width: "100%" }}>
                                {[
                                    { id: 'reddit', label: 'Reddit', icon: RedditIcon },
                                    { id: 'indiehacker', label: 'Indie Hackers', icon: IndieHackersIcon },
                                    { id: 'twitter', label: 'Twitter (X)', icon: TwitterIcon },
                                    { id: 'hacker news', label: 'Hacker News', icon: HackerNewsIcon },
                                    { id: 'github', label: 'GitHub', icon: GitHubIcon },
                                    { id: 'other', label: 'Other', icon: OtherIcon },
                                ].map((opt) => {
                                    const isSelected = referralSource === opt.id;
                                    const IconComp = opt.icon;
                                    return (
                                        <button key={opt.id} onClick={() => {
                                            setReferralSource(opt.id);
                                            if (opt.id !== 'other') setReferralOtherText('');
                                        }}
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 8,
                                                padding: "16px 8px",
                                                borderRadius: 16,
                                                background: isSelected ? "rgba(32,30,36,0.05)" : "transparent",
                                                border: isSelected ? "2px solid var(--color-text-primary)" : "1px solid rgba(32,30,36,0.1)",
                                                cursor: "pointer",
                                                transition: "all 0.2s",
                                                color: "var(--color-text-primary)",
                                                fontWeight: isSelected ? 600 : 500,
                                                outline: "none"
                                            }}
                                            onMouseEnter={e => {
                                                if (!isSelected) e.currentTarget.style.borderColor = "rgba(32,30,36,0.2)";
                                            }}
                                            onMouseLeave={e => {
                                                if (!isSelected) e.currentTarget.style.borderColor = "rgba(32,30,36,0.1)";
                                            }}
                                        >
                                            <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                <IconComp size={opt.id === 'twitter' || opt.id === 'github' ? 28 : 24} />
                                            </div>
                                            <span style={{ fontSize: 13, color: isSelected ? "var(--color-text-primary)" : "var(--color-text-secondary)" }}>{opt.label}</span>
                                        </button>
                                    );
                                })}
                            </div>

                            {referralSource === 'other' && (
                                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} style={{ marginBottom: 24, width: "100%" }}>
                                    <input type="text" placeholder="Please specify where you found us..." value={referralOtherText} onChange={(e) => setReferralOtherText(e.target.value)}
                                        style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32,30,36,0.03)", border: "1px solid rgba(32,30,36,0.1)", borderRadius: 14, color: "var(--color-text-primary)", fontSize: 14, outline: "none", boxSizing: "border-box" }}
                                        onFocus={e => e.target.style.borderColor = "rgba(32,30,36,0.2)"}
                                        onBlur={e => e.target.style.borderColor = "rgba(32,30,36,0.1)"}
                                    />
                                </motion.div>
                            )}

                            <div style={{ display: "flex", gap: 12, width: "100%", alignItems: "center", justifyContent: "center" }}>
                                <button onClick={handleNextFromReferral} disabled={submittingReferral || !referralSource || (referralSource === 'other' && !referralOtherText.trim())}
                                    style={{ flex: 1, padding: "16px", backgroundColor: "var(--color-text-primary)", color: 'var(--color-bg-surface)', borderRadius: 16, fontWeight: 600, fontSize: 15, border: "none", cursor: (submittingReferral || !referralSource || (referralSource === 'other' && !referralOtherText.trim())) ? "not-allowed" : "pointer", opacity: (submittingReferral || !referralSource || (referralSource === 'other' && !referralOtherText.trim())) ? 0.4 : 1, transition: "all 0.2s" }}
                                >
                                    {submittingReferral ? "Saving..." : "Continue"}
                                </button>
                                <button onClick={() => setStep(9)} style={{ background: "none", border: "none", color: "var(--color-text-tertiary)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }} onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}>
                                    Skip
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── Step 9: Star GitHub Repo ── */}
                    {step === 9 && (
                        <motion.div
                            key="step9"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 500, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(8)} />
                            </div>

                            {/* Glowing Star Badge */}
                            <motion.div
                                initial={{ scale: 0.8, rotate: -10 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ type: "spring", stiffness: 300, damping: 15 }}
                                style={{
                                    width: 72,
                                    height: 72,
                                    borderRadius: 28,
                                    margin: "0 auto 24px",
                                    background: "linear-gradient(135deg, rgba(234,179,8,0.15) 0%, rgba(245,158,11,0.05) 100%)",
                                    border: "1px solid rgba(234,179,8,0.3)",
                                    boxShadow: "0 12px 32px rgba(234,179,8,0.15)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                }}
                            >
                                <Star size={36} color="#eab308" fill="#eab308" />
                            </motion.div>

                            <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-0.03em", color: "var(--color-text-primary)", marginBottom: 12, lineHeight: 1.15 }}>
                                Star EverFern on GitHub ⭐
                            </h1>
                            
                            <div style={{
                                backgroundColor: "rgba(32,30,36,0.03)",
                                border: "1px solid rgba(32,30,36,0.08)",
                                borderRadius: 20,
                                padding: "20px 24px",
                                marginBottom: 28,
                                textAlign: "left",
                                width: "100%",
                                boxSizing: "border-box"
                            }}>
                                <p style={{ fontSize: 13.5, color: "var(--color-text-secondary)", lineHeight: 1.65, margin: 0 }}>
                                    Building & maintaining EverFern full-time as an independent project takes <strong>countless sleepless nights, endless coffee, and 100% of our energy</strong> — completely free & open source.
                                </p>
                                <div style={{ height: 1, backgroundColor: "rgba(32,30,36,0.08)", margin: "14px 0" }} />
                                <p style={{ fontSize: 13, color: "#e11d48", fontWeight: 500, lineHeight: 1.6, margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
                                    <Heart size={15} color="#e11d48" fill="#e11d48" style={{ flexShrink: 0 }} />
                                    <span>If you skip starring the repo, a developer&apos;s open-source soul dies a little inside 💔. A single click takes 2 seconds and keeps this project alive!</span>
                                </p>
                            </div>

                            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", alignItems: "center", justifyContent: "center" }}>
                                <a
                                    href="https://github.com/Everfern-AI/Everfern"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => {
                                        setHasStarredRepo(true);
                                        try {
                                            localStorage.setItem('everfern_github_starred', 'true');
                                            localStorage.setItem('everfern_star_dismissed', 'true');
                                        } catch (err) {}
                                        setTimeout(() => setStep(10), 1200);
                                    }}
                                    style={{
                                        width: "100%",
                                        padding: "16px",
                                        backgroundColor: "var(--color-text-primary)",
                                        color: "var(--color-bg-surface)",
                                        borderRadius: 16,
                                        fontWeight: 600,
                                        fontSize: 15,
                                        border: "none",
                                        cursor: "pointer",
                                        textDecoration: "none",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                        transition: "all 0.2s",
                                        boxShadow: "0 4px 16px rgba(0,0,0,0.1)"
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = "0.9"}
                                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                                >
                                    <Star size={18} fill="currentColor" />
                                    {hasStarredRepo ? "Thank you! You're an absolute legend! ❤️" : "⭐ Star on GitHub (Save the dev's soul!)"}
                                    <ExternalLink size={15} style={{ opacity: 0.7 }} />
                                </a>

                                <button
                                    onClick={() => {
                                        try {
                                            localStorage.setItem('everfern_star_dismissed', 'true');
                                        } catch (err) {}
                                        setStep(10);
                                    }}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        color: "var(--color-text-tertiary)",
                                        fontSize: 13,
                                        cursor: "pointer",
                                        textDecoration: "underline",
                                        marginTop: 4,
                                        transition: "color 0.2s"
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.color = '#ef4444'}
                                    onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
                                >
                                    Skip (and break a developer&apos;s heart 💔)
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── Step 10: Join Discord ── */}
                    {step === 10 && (
                        <motion.div
                            key="step10"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(9)} />
                            </div>

                            {/* Discord Logo */}
                            <div style={{ width: 64, height: 64, borderRadius: 24, margin: "0 auto 24px", background: "rgba(32,30,36,0.05)", border: "1px solid rgba(32,30,36,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <DiscordIcon size={32} />
                            </div>

                            <h1 style={{ fontSize: 32, fontWeight: 500, letterSpacing: "-0.03em", color: "var(--color-text-primary)", marginBottom: 12, lineHeight: 1.1 }}>
                                Join our Discord
                            </h1>
                            <p style={{ fontSize: 14, color: "var(--color-text-tertiary)", lineHeight: 1.7, maxWidth: 360, marginBottom: 32 }}>
                                Connect with the EverFern community. Get help, share feedback, and stay updated on new features.
                            </p>

                            <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", alignItems: "center", justifyContent: "center" }}>
                                <a
                                    href="https://discord.gg/4zR2jk799a"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        width: "100%",
                                        padding: "16px",
                                        backgroundColor: "var(--color-text-primary)",
                                        color: "var(--color-bg-surface)",
                                        borderRadius: 16,
                                        fontWeight: 600,
                                        fontSize: 15,
                                        border: "none",
                                        cursor: "pointer",
                                        textDecoration: "none",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        gap: 8,
                                        transition: "all 0.2s"
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                                    onMouseLeave={e => e.currentTarget.style.opacity = "1"}
                                >
                                    <DiscordIcon size={18} />
                                    Join Discord
                                </a>
                                <button onClick={() => setStep(12)} style={{ background: "none", border: "none", color: "var(--color-text-tertiary)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }} onMouseEnter={e => e.currentTarget.style.color = 'var(--color-text-primary)'} onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}>
                                    Skip
                                </button>
                            </div>
                        </motion.div>
                    )}

                    {/* ── Step 12: Privacy & Security ── */}
                    {step === 12 && (
                        <motion.div
                            key="step12"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(10)} />
                            </div>

                            {/* Static Padlock SVG */}
                            <div style={{ marginBottom: 36, width: 120, height: 130 }}>
                                <svg width="120" height="130" viewBox="0 0 120 130" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    {/* Shackle */}
                                    <path
                                        d="M44 66 L44 50 Q44 36 60 36 Q76 36 76 50 L76 66"
                                        stroke='var(--color-text-primary)' strokeWidth="6" strokeLinecap="round"
                                        fill="none"
                                    />
                                    {/* Lock body */}
                                    <rect x="38" y="64" width="44" height="32" rx="6" fill='var(--color-text-primary)' />
                                    {/* Keyhole circle */}
                                    <circle cx="60" cy="76" r="4" fill='var(--color-bg-base)' />
                                    {/* Keyhole slot */}
                                    <rect x="58" y="76" width="4" height="8" rx="2" fill='var(--color-bg-base)' />
                                </svg>
                            </div>

                            {/* Title */}
                            <h1 style={{
                                fontSize: 32,
                                fontWeight: 500,
                                letterSpacing: "-0.03em",
                                color: 'var(--color-text-primary)',
                                marginBottom: 12,
                                lineHeight: 1.1,
                            }}>
                                Your privacy is protected
                            </h1>

                            {/* Subtitle */}
                            <p style={{
                                fontSize: 14,
                                color: 'var(--color-text-tertiary)',
                                lineHeight: 1.7,
                                maxWidth: 360,
                                marginBottom: 32,
                            }}>
                                {engine === "everfern" ? (
                                    <>EverFern Cloud runs on our own self-hosted infrastructure. We <strong style={{ color: 'var(--color-text-primary)' }}>never send your data to third parties</strong>, host all models ourselves, and <strong style={{ color: 'var(--color-text-primary)' }}>don&apos;t store any of your conversations or code</strong>.  Your work stays yours.</>
                                ) : (
                                    <>All your API keys and credentials are stored <strong style={{ color: 'var(--color-text-primary)' }}>locally on your device</strong> and never leave your machine. EverFern doesn&apos;t collect, track, or transmit any of your data.</>
                                )}
                            </p>

                            {/* Privacy feature pills */}
                            <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", marginBottom: 36 }}>
                                {(engine === "everfern" ? [
                                    { icon: "🏠", title: "Self-Hosted Models", desc: "All AI models run on our own infrastructure — no third-party APIs." },
                                    { icon: "🚫", title: "Zero Data Sharing", desc: "We never send your data, code, or prompts to anyone." },
                                    { icon: "🗑️", title: "No Data Storage", desc: "Conversations and code are processed in-memory and never saved on our servers." },
                                ] : [
                                    { icon: "🔑", title: "Local Key Storage", desc: "API keys are saved in ~/.everfern/config.json on your device only." },
                                    { icon: "🛡️", title: "No Telemetry", desc: "EverFern doesn't collect analytics, usage data, or error reports." },
                                    { icon: "💻", title: "Your Device, Your Data", desc: "All processing happens locally or directly with your chosen provider." },
                                ]).map((feature, i) => (
                                    <motion.div
                                        key={i}
                                        initial={{ opacity: 0, x: -12 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ delay: 0.8 + i * 0.15, duration: 0.35, ease: "easeOut" }}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 14,
                                            padding: "14px 18px",
                                            borderRadius: 14,
                                            background: "rgba(32,30,36,0.03)",
                                            border: "1px solid rgba(32,30,36,0.08)",
                                            textAlign: "left",
                                        }}
                                    >
                                        <span style={{ fontSize: 20, flexShrink: 0 }}>{feature.icon}</span>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>{feature.title}</div>
                                            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>{feature.desc}</div>
                                        </div>
                                    </motion.div>
                                ))}
                            </div>

                            {/* Continue button */}
                            <motion.button
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 1.3, duration: 0.35 }}
                                onClick={handleSave}
                                disabled={isSaving}
                                style={{
                                    width: "100%",
                                    height: 52,
                                    background: 'var(--color-text-primary)',
                                    color: 'var(--color-bg-base)',
                                    borderRadius: 12,
                                    fontWeight: 600,
                                    fontSize: 14,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 8,
                                    cursor: isSaving ? "wait" : "pointer",
                                    border: "none",
                                    transition: "background 0.15s",
                                    letterSpacing: "0.01em",
                                    opacity: isSaving ? 0.7 : 1,
                                }}
                                onMouseEnter={e => !isSaving && (e.currentTarget.style.background = 'var(--color-text-primary)')}
                                onMouseLeave={e => (e.currentTarget.style.background = 'var(--color-text-primary)')}
                            >
                                {isSaving ? "Finishing setup..." : (<>Get Started <ArrowRight size={16} strokeWidth={2.5} /></>)}
                            </motion.button>

                            <p style={{ fontSize: 11, color: "#a1a19e", marginTop: 18, lineHeight: 1.5 }}>
                                By continuing you agree to the EverFern{" "}
                                <span style={{ textDecoration: "underline", cursor: "pointer" }}>Terms of Service</span>{" "}
                                and{" "}
                                <span style={{ textDecoration: "underline", cursor: "pointer" }}>Privacy Policy</span>.
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
            </main>

            {/* ── More Providers Modal ── */}
            <AnimatePresence>
                {showMoreModal && (
                    <div style={{ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", padding: "0 16px" }}>
                        <motion.div
                            initial={{ opacity: 0, scale: 0.96 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.18 }}
                            style={{ width: "100%", maxWidth: 460, background: "#1c1b19", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 18, overflow: "hidden", boxShadow: "0 24px 48px rgba(0,0,0,0.6)" }}
                        >
                            <div style={{ padding: "18px 22px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <h3 style={{ fontSize: 16, fontWeight: 500, color: "#e5e5e5", margin: 0, letterSpacing: "-0.01em" }}>Coming Soon</h3>
                                <button
                                    onClick={() => setShowMoreModal(false)}
                                    style={{ color: "#52525b", background: "none", border: "none", cursor: "pointer", display: "flex", transition: "color 0.15s", padding: 4 }}
                                    onMouseEnter={e => (e.currentTarget.style.color = "#e5e5e5")}
                                    onMouseLeave={e => (e.currentTarget.style.color = "#52525b")}
                                >
                                    <Plus size={18} style={{ transform: "rotate(45deg)" }} />
                                </button>
                            </div>
                            <div style={{ maxHeight: 300, overflowY: "auto", padding: 20, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                            </div>
                            <div style={{ padding: "14px 22px", background: "rgba(255,255,255,0.01)", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                                <p style={{ fontSize: 11, color: "#3f3f46", textAlign: "center", margin: 0, lineHeight: 1.5 }}>We are working on bringing these integrations to EverFern Desktop very soon.</p>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Reusable provider row ──
function ProviderRow({ p, onClick }: { p: { id: string; name: string; logo: any }; onClick: () => void }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 18px", borderRadius: 13,
                background: "rgba(32,30,36,0.025)",
                border: "1px solid rgba(32,30,36,0.1)",
                cursor: "pointer", transition: "all 0.15s ease", textAlign: "left",
            }}
            onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(32,30,36,0.055)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(32,30,36,0.15)";
            }}
            onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.background = "rgba(32,30,36,0.025)";
                (e.currentTarget as HTMLElement).style.borderColor = "rgba(32,30,36,0.1)";
            }}
        >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(32,30,36,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <p.logo size={18} />
                </div>
                <span style={{ fontWeight: 500, fontSize: 14, color: 'var(--color-text-primary)', letterSpacing: "-0.01em" }}>{p.name}</span>
            </div>
            <ChevronRight size={15} style={{ color: 'var(--color-text-tertiary)' }} />
        </button>
    );
}
const getVisionDefaultModel = (provider: string) => {
    if (provider === "openrouter") return "qwen/qwen3-vl-235b-a22b-instruct";
    if (provider === "minimax") return "MiniMax-M3";
    if (provider === "ollama") return "qwen3-vl:235b-cloud";
    if (provider === "openai") return "gpt-5.5";
    if (provider === "anthropic") return "claude-opus-4.6";
    if (provider === "everfern") return "fern-1";
    return "qwen3-vl:235b-cloud";
};

const getVisionDefaultBaseUrl = (provider: string) => {
    if (provider === "minimax") return "https://api.minimax.io/v1";
    if (provider === "ollama") return "https://ollama.com";
    if (provider === "openai") return "https://api.openai.com/v1";
    if (provider === "anthropic") return "https://api.anthropic.com";
    if (provider === "nvidia") return "https://integrate.api.nvidia.com/v1";
    return "";
};
