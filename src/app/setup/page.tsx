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
} from "lucide-react";

import WindowControls from "../components/WindowControls";
import LinuxVMSetupStep from "./LinuxVMSetupStep";

// ── Provider Logos ────────────────

const OpenAILogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/openai.svg" alt="OpenAI Logo" width={size} height={size} />
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
    <Image src="/images/ai-providers/ollama.svg" alt="Ollama Logo" width={size} height={size} />
);

const LMStudioLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/ai-providers/lm-studio.png" alt="LM Studio Logo" width={size} height={size} className="grayscale opacity-80" />
);

const EverFernBglessLogo = ({ size = 20 }: { size?: number }) => (
    <Image src="/images/logos/black-logo-withoutbg.png" alt="EverFern Cloud" width={size} height={size} />
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
        case "fail": return "#ef4444";   // red — fatal
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
            color: "#8a8886",
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
        onMouseEnter={e => (e.currentTarget.style.color = "#201e24")}
        onMouseLeave={e => (e.currentTarget.style.color = "#8a8886")}
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
                    <path d="M17 12 Q19 7 17 2" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"
                        style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0s", opacity: 0.7 }} />
                    <path d="M23 12 Q25 6 23 1" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"
                        style={{ animation: "steam 2s ease-in-out infinite", animationDelay: "0.4s", opacity: 0.7 }} />
                    <path d="M29 12 Q31 7 29 2" stroke="#3b82f6" strokeWidth="1.5" strokeLinecap="round"
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
                    <span style={{ fontSize: 14, fontWeight: 600, color: "#201e24" }}>Take a coffee break</span>
                    <span style={{
                        fontSize: 9, fontWeight: 700, textTransform: "uppercase" as const,
                        letterSpacing: "0.12em", background: "rgba(59,130,246,0.15)",
                        color: "#3b82f6", padding: "2px 7px", borderRadius: 999,
                    }}>Installing</span>
                </div>
                <p style={{ fontSize: 12, color: "#8a8886", lineHeight: 1.6, margin: "0 0 10px" }}>
                    This might take a few minutes. Dependencies are being downloaded automatically.
                </p>

                {/* Overall progress */}
                <div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ fontSize: 10, color: "#8a8886", textTransform: "uppercase" as const, letterSpacing: "0.1em", fontWeight: 600 }}>
                            Overall Progress
                        </span>
                        <span style={{ fontSize: 10, color: "#201e24", fontFamily: "monospace" }}>
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
                <span style={{ color: "#3b82f6" }}>Downloading</span>
                <span style={{ color: "#201e24", fontWeight: 700 }}>{pkg}</span>
                {speed && <span style={{ color: "#8a8886", marginLeft: "auto" }}>{speed}</span>}
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
                        background: "#2563eb",
                        borderRadius: 3,
                        transition: "width 0.2s linear",
                    }} />
                </div>
                <span style={{
                    fontSize: 10, fontFamily: "monospace",
                    color: pct === 100 ? "#16a34a" : "#8a8886",
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
                            color: isDone ? "#16a34a" : isActive ? "#2563eb" : "#8a8886",
                            textTransform: "uppercase" as const, letterSpacing: "0.1em",
                        }}>{s.title}</div>
                        <div style={{ fontSize: 10, color: "#8a8886" }}>{s.desc}</div>
                    </div>
                );
            })}
        </div>
    );
}

export default function SetupPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [engine, setEngine] = useState<"local" | "online" | "everfern" | null>(null);
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
                setStep(5);
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
        // Add specialized VLM engine if Ollama is available OR cloud mode is selected
        if (vlmMode === "cloud" && vlmCloudModel.trim()) {
            let finalCloudKey = vlmCloudKey.trim() || undefined;
            if (vlmCloudProvider === 'everfern' && !finalCloudKey) {
                try {
                    const stored = localStorage.getItem("everfern_cloud_session");
                    if (stored) {
                        finalCloudKey = JSON.parse(stored).accessToken;
                    }
                } catch {}
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
            } catch {}
            
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
                    config.apiKey = session.accessToken;
                }
            } catch {}
        }

        if ((window as any).electronAPI?.saveConfig) {
            await (window as any).electronAPI.saveConfig(config);
        }

        // Mark onboarding complete via landing API (fire-and-forget — best effort)
        try {
            const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "http://localhost:3002";
            const stored = localStorage.getItem("everfern_cloud_session");
            if (stored) {
                const { accessToken } = JSON.parse(stored);
                await fetch(`${LANDING_URL}/api/user/onboarding-done`, {
                    method: "POST",
                    headers: { "Authorization": `Bearer ${accessToken}` },
                });
                // Update local session cache too
                const session = JSON.parse(stored);
                session.user.onboardingDone = true;
                localStorage.setItem("everfern_cloud_session", JSON.stringify(session));
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
                setTimeout(() => setStep(5), 1500);
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
            className="flex flex-col min-h-screen bg-[#f5f4f0] text-[#201e24] overflow-y-auto"
            style={{ fontFamily: "var(--font-sans)" }}
        >
            {/* ── Header ── */}
            <header
                className="flex items-center justify-between px-5 py-3 flex-shrink-0"
                style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8, WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                    <Image unoptimized src="/images/logos/black-logo-withoutbg.png" alt="" width={18} height={18} />
                </div>
                <div style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                    <WindowControls />
                </div>
            </header>
            <div style={{ display: "flex", justifyContent: "center", paddingTop: 20, gap: 6 }}>
                {[1, 2, 3, 4, 5, 6, 7].map(s => (
                    <div
                        key={s}
                        style={{
                            width: s === step ? 20 : 6,
                            height: 4,
                            borderRadius: 999,
                            background: s === step ? "#201e24" : s < step ? "#4b5563" : "#d1d5db",
                            transition: "all 0.3s ease",
                        }}
                    />
                ))}
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
                                <h1 style={{ fontSize: 36, fontWeight: 500, letterSpacing: "-0.03em", color: "#201e24", marginBottom: 10, lineHeight: 1.1 }}>
                                    Choose your engine
                                </h1>
                                <p style={{ fontSize: 14, color: "#8a8886", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
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
                                                setProvider("everfern");
                                                setStep(4);
                                                return;
                                            }
                                            setStep(2); 
                                        }}
                                        disabled={false}
                                        style={{
                                            background: "rgba(255,255,255,0.02)",
                                            border: "1px solid #e2e2e2",
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
                                            (e.currentTarget as HTMLElement).style.borderColor = "#8a8886";
                                            (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)";
                                        }}
                                        onMouseLeave={e => {
                                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                                            (e.currentTarget as HTMLElement).style.borderColor = "#e2e2e2";
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
                                            <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 5, color: "#201e24" }}>
                                                {opt.name}
                                            </div>
                                            <div style={{ fontSize: 12, color: "#8a8886", lineHeight: 1.4 }}>
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
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.025em", color: "#201e24", marginBottom: 8, lineHeight: 1.2 }}>
                                    Select AI Provider
                                </h2>
                                <p style={{ fontSize: 13, color: "#8a8886", lineHeight: 1.5 }}>
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
                                        onClick={() => { setProvider("everfern"); setStep(4); }}
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
                                                <span style={{ fontWeight: 500, fontSize: 14, color: "#201e24", display: "block" }}>EverFern Cloud</span>
                                                <span style={{ fontSize: 11, color: "#8a8886" }}>Uses front tier models</span>
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
                                    marginBottom: 20, color: "#8a8886",
                                }}>
                                    <Key size={24} strokeWidth={1.5} />
                                </div>
                                <h2 style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", color: "#201e24", marginBottom: 8 }}>
                                    Authenticator
                                </h2>
                                <p style={{ fontSize: 13, color: "#8a8886", lineHeight: 1.6, maxWidth: 280 }}>
                                    {engine === "local"
                                        ? <>Enter your <span style={{ color: "#8a8886", fontWeight: 500 }}>{provider}</span> Server URL below, or leave blank for default.</>
                                        : <>Enter your <span style={{ color: "#8a8886", fontWeight: 500 }}>{provider}</span> API key below.</>
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
                                        color: "#201e24", fontSize: 14,
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
                                        background: "#201e24", color: "#f5f4f0",
                                        borderRadius: 12, fontWeight: 600, fontSize: 14,
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        gap: 8, cursor: "pointer", border: "none",
                                        transition: "background 0.15s", letterSpacing: "0.01em",
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = "#111111")}
                                    onMouseLeave={e => (e.currentTarget.style.background = "#201e24")}
                                >
                                    Continue <ArrowRight size={16} strokeWidth={2.5} />
                                </button>
                            </div>

                            <p style={{ fontSize: 11, color: "#8a8886", textAlign: "center", marginTop: 20, lineHeight: 1.6 }}>
                                Keys are stored locally at{" "}
                                <code style={{ fontFamily: "monospace", color: "#8a8886", fontSize: 10.5 }}>~/.everfern/config.json</code>{" "}
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
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: "#201e24", marginBottom: 12, lineHeight: 1.1 }}>
                                    Vision AI Setup
                                </h2>
                                <p style={{ fontSize: 13, color: "#8a8886", lineHeight: 1.6, maxWidth: 360, margin: "0 auto" }}>
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
                                        onClick={() => setVlmMode(opt.id as any)}
                                        style={{
                                            background: vlmMode === opt.id ? "rgba(32,30,36,0.06)" : "rgba(255,255,255,0.02)",
                                            border: `1px solid ${vlmMode === opt.id ? "#8a8886" : "#e2e2e2"}`,
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
                                            (e.currentTarget as HTMLElement).style.borderColor = "#8a8886";
                                        }}
                                        onMouseLeave={e => {
                                            if (vlmMode === opt.id) return;
                                            (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                                            (e.currentTarget as HTMLElement).style.borderColor = "#e2e2e2";
                                        }}
                                    >
                                        {vlmMode === opt.id && (
                                            <div style={{ position: "absolute", top: 12, right: 12, color: "#111111" }}>
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
                                            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 4, color: "#201e24" }}>
                                                {opt.name}
                                            </div>
                                            <div style={{ fontSize: 11, color: "#8a8886", lineHeight: 1.4 }}>
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
                                                        <div style={{ fontSize: 15, fontWeight: 600, color: "#201e24" }}>Install Ollama</div>
                                                        <div style={{ fontSize: 12, color: "#8a8886" }}>Required to run the local vision model</div>
                                                    </div>
                                                </div>
                                                <button onClick={handleInstallOllama} disabled={isInstallingOllama}
                                                    style={{ width: "100%", padding: "14px", backgroundColor: "#201e24", color: "#f5f4f0", borderRadius: 12, fontWeight: 600, fontSize: 14, border: "none", cursor: isInstallingOllama ? "wait" : "pointer", opacity: isInstallingOllama ? 0.7 : 1 }}>
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
                                                            <span style={{ fontSize: 12, color: "#8a8886", fontFamily: "monospace" }}>
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
                                                        <div style={{ fontSize: 15, fontWeight: 600, color: "#201e24" }}>Qwen3 VL (2B)</div>
                                                        <div style={{ fontSize: 12, color: "#8a8886" }}>~2.5 GB • Fast Local Inference</div>
                                                    </div>
                                                </div>
                                                <button onClick={handlePullModel} disabled={isPullingModel || isInstallingOllama}
                                                    style={{ width: "100%", padding: "14px", backgroundColor: "#3b82f6", color: "#ffffff", borderRadius: 12, fontWeight: 600, fontSize: 14, border: "none", cursor: (isPullingModel || isInstallingOllama) ? "wait" : "pointer", opacity: (isPullingModel || isInstallingOllama) ? 0.7 : 1 }}>
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
                                                        <p style={{ fontSize: 11, color: "#8a8886", marginTop: 8, textAlign: "center" }}>Downloading model weights... ~2.5 GB total</p>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Terminal Output for Ollama */}
                                        {(ollamaLogs.length > 0) && (
                                            <div style={{ width: "100%", height: 120, backgroundColor: "#f5f4f0", borderRadius: 12, padding: 12, border: "1px solid rgba(32,30,36,0.1)", overflowY: "auto", textAlign: "left" }}>
                                                <pre style={{ margin: 0, color: "#8a8886", fontSize: 11, fontFamily: "monospace", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                                                    {ollamaLogs.join('\n')}
                                                </pre>
                                            </div>
                                        )}
                                    </>
                                )}

                                {vlmMode === "cloud" && (
                                    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                            <label style={{ fontSize: 12, fontWeight: 600, color: "#8a8886", textTransform: "uppercase", letterSpacing: "0.05em" }}>Provider</label>
                                            <select value={vlmCloudProvider} onChange={(e) => {
                                                const provider = e.target.value;
                                                setVlmCloudProvider(provider);
                                                setVlmCloudModel(getVisionDefaultModel(provider));
                                                setVlmCloudUrl(getVisionDefaultBaseUrl(provider));
                                            }}
                                                style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: "#201e24", fontSize: 14, outline: "none", cursor: "pointer", transition: "all 0.2s" }}>
                                                <option value="ollama" style={{ background: "#f5f4f0" }}>Ollama Compatible Endpoint</option>
                                                <option value="everfern" style={{ background: "#f5f4f0" }}>EverFern Cloud</option>
                                                <option value="openrouter" style={{ background: "#f5f4f0" }}>OpenRouter</option>
                                                <option value="minimax" style={{ background: "#f5f4f0" }}>MiniMax API</option>
                                                <option value="openai" style={{ background: "#f5f4f0" }}>OpenAI</option>
                                                <option value="anthropic" style={{ background: "#f5f4f0" }}>Anthropic</option>
                                                <option value="nvidia" style={{ background: "#f5f4f0" }}>Nvidia NIM</option>
                                            </select>
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                            <label style={{ fontSize: 12, fontWeight: 600, color: "#8a8886", textTransform: "uppercase", letterSpacing: "0.05em" }}>Model Name</label>
                                            <div style={{ position: "relative" }}>
                                                {vlmCloudProvider === 'ollama' ? (
                                                    <select value={vlmCloudModel} onChange={(e) => setVlmCloudModel(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: "#201e24", fontSize: 14, outline: "none", cursor: "pointer", transition: "all 0.2s" }}>
                                                        <option value="qwen3-vl:235b-cloud">Qwen3 VL 235B (Default)</option>
                                                        <option value="kimi-k2.6:cloud">Kimi K2.6 Cloud</option>
                                                        <option value="glm-5.1:cloud">GLM 5.1 Cloud</option>
                                                    </select>
                                                ) : vlmCloudProvider === 'everfern' ? (
                                                    <select value={vlmCloudModel} onChange={(e) => setVlmCloudModel(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: "#201e24", fontSize: 14, outline: "none", cursor: "pointer", transition: "all 0.2s" }}>
                                                        <option value="everfern-vision-v1">EverFern Vision v1 (Default)</option>
                                                    </select>
                                                ) : (
                                                    <>
                                                        <input type="text" placeholder={getVisionDefaultModel(vlmCloudProvider)} value={vlmCloudModel} onChange={(e) => setVlmCloudModel(e.target.value)}
                                                            style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: "#201e24", fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                            onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                            onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                                        <Cpu size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#8a8886" }} />
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {vlmCloudProvider !== 'ollama' && vlmCloudProvider !== 'everfern' && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                                <label style={{ fontSize: 12, fontWeight: 600, color: "#8a8886", textTransform: "uppercase", letterSpacing: "0.05em" }}>Host URL (Optional)</label>
                                                <div style={{ position: "relative" }}>
                                                    <input type="text" placeholder="Optional custom base URL" value={vlmCloudUrl} onChange={(e) => setVlmCloudUrl(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: "#201e24", fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                        onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                        onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                                    <Globe size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#8a8886" }} />
                                                </div>
                                            </div>
                                        )}
                                        {vlmCloudProvider !== 'everfern' && (
                                            <div style={{ display: "flex", flexDirection: "column", gap: 6, textAlign: "left" }}>
                                                <label style={{ fontSize: 12, fontWeight: 600, color: "#8a8886", textTransform: "uppercase", letterSpacing: "0.05em" }}>API Key</label>
                                                <div style={{ position: "relative" }}>
                                                    <input type="password" placeholder="sk-..." value={vlmCloudKey} onChange={(e) => setVlmCloudKey(e.target.value)}
                                                        style={{ width: "100%", padding: "14px 18px 14px 46px", backgroundColor: "rgba(32, 30, 36,0.04)", border: "1px solid rgba(32, 30, 36,0.1)", borderRadius: 14, color: "#201e24", fontSize: 14, fontFamily: "monospace", outline: "none", transition: "all 0.2s", boxSizing: "border-box" }}
                                                        onFocus={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.2)"; e.target.style.backgroundColor = "rgba(32,30,36,0.06)"; }}
                                                        onBlur={e => { e.target.style.borderColor = "rgba(32, 30, 36,0.1)"; e.target.style.backgroundColor = "rgba(32,30,36,0.04)"; }} />
                                                    <Key size={16} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: "#8a8886" }} />
                                                </div>
                                            </div>
                                        )}
                                        <button onClick={() => setStep(5)} disabled={isSaving || !vlmCloudModel.trim()} style={{ marginTop: 12, width: "100%", padding: "16px", backgroundColor: vlmCloudModel.trim() ? "#201e24" : "rgba(32,30,36,0.1)", color: vlmCloudModel.trim() ? "#f5f4f0" : "#8a8886", borderRadius: 14, fontWeight: 600, fontSize: 14, border: "none", cursor: vlmCloudModel.trim() ? "pointer" : "not-allowed", transition: "all 0.2s" }}>
                                            {isSaving ? "Saving..." : "Save & Continue"}
                                        </button>
                                    </div>
                                )}

                                {vlmMode === "everfern" && (
                                    <button
                                        onClick={() => setStep(5)}
                                        style={{
                                            width: "100%", height: 52,
                                            background: "#201e24", color: "#f5f4f0",
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

                            <button onClick={() => setStep(5)} style={{ marginTop: 24, fontSize: 13, color: "#8a8886", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }} onMouseEnter={e => e.currentTarget.style.color = "#201e24"} onMouseLeave={e => e.currentTarget.style.color = "#8a8886"}>
                                Skip local AI setup & Continue
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
                                <BackButton onClick={() => setStep(4)} />
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
                                <h2 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", color: "#201e24", marginBottom: 12, lineHeight: 1.1 }}>
                                    Install Navis Extension
                                </h2>
                                <p style={{ fontSize: 13, color: "#8a8886", lineHeight: 1.6, maxWidth: 380, margin: "0 auto" }}>
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
                                background: "#ffffff",
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
                                    background: "#f7f7f6",
                                    borderBottom: "1px solid rgba(32,30,36,0.06)",
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
                                            color: "#201e24",
                                            background: "#ffffff",
                                            borderRadius: "8px 8px 0 0",
                                            border: "1px solid rgba(32,30,36,0.08)",
                                            borderBottom: "1px solid #ffffff",
                                            position: "relative",
                                            bottom: -1,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                        }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8a8886" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                            SkyBooker.com
                                        </div>
                                        <div style={{
                                            padding: "7px 14px",
                                            fontSize: 11,
                                            fontWeight: 500,
                                            color: "#a09f9c",
                                            background: "#f0efed",
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
                                    background: "#ffffff",
                                    borderBottom: "1px solid rgba(32,30,36,0.06)",
                                }}>
                                    {/* Nav buttons */}
                                    <div style={{ display: "flex", gap: 10, color: "#8a8886", alignItems: "center" }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
                                        {/* Reload icon */}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                                        {/* Home icon */}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                                    </div>
                                    <div style={{
                                        flex: 1,
                                        background: "#f5f4f2",
                                        borderRadius: 8,
                                        padding: "6px 12px",
                                        fontSize: 11,
                                        color: "#8a8886",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                    }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                                            <span style={{ color: "#10b981", fontWeight: 500 }}>Secure |</span>
                                            <span>skybooker.com/flights/NYC-to-LAX</span>
                                        </div>
                                        {/* Bookmark Star Icon */}
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a09f9c" strokeWidth="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                                    </div>
                                    {/* Extension Icon & Navis icon in toolbar */}
                                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                        {/* Puzzle icon */}
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a8886" strokeWidth="2.5"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="M12 6v12M6 12h12"/></svg>
                                        {/* Navis extension icon */}
                                        <div style={{
                                            width: 22, height: 22, borderRadius: 6,
                                            background: "#201e24",
                                            display: "flex", alignItems: "center", justifyContent: "center",
                                            boxShadow: "0 0 8px rgba(32,30,36,0.25)"
                                        }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#f5f4f0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* Main Browser Body */}
                                <div style={{
                                    display: "flex",
                                    background: "#fdfdfc",
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
                                        background: "#faf9f6",
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
                                            borderBottom: "1px solid rgba(32,30,36,0.06)",
                                            paddingBottom: 6,
                                            marginBottom: 2,
                                        }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: "#8a8886", textTransform: "uppercase", letterSpacing: "0.05em" }}>
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
                                                    background: mockStep >= 2 ? "#201e24" : "rgba(32,30,36,0.05)",
                                                    color: mockStep >= 2 ? "#ffffff" : "#8a8886",
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
                                                    color: mockStep >= 4 ? "#ffffff" : "#8a8886",
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
                                                <span style={{ color: "#9ca3af" }}>⇄</span>
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
                                                    background: "#ffffff",
                                                    border: "1px solid #e5e7eb",
                                                    borderRadius: 4,
                                                    color: "#4b5563",
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
                                            background: mockStep >= 4 ? "#ffffff" : "#fafaf9",
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
                                                    color: "#201e24",
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
                                                        color: "#201e24",
                                                        transition: "font-size 0.3s ease"
                                                    }}>06:30 AM</div>
                                                    <div style={{ fontSize: mockStep >= 3 ? 9.5 : 8, color: "#8a8886" }}>JFK</div>
                                                </div>
                                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                                    <div style={{ fontSize: 7.5, color: "#a09f9c" }}>5h 20m</div>
                                                    <div style={{ width: 35, height: 1.5, background: "#e2e1de", position: "relative" }}>
                                                        <motion.div
                                                            style={{
                                                                position: "absolute", top: -2.5, left: 0,
                                                                width: 6, height: 6, borderRadius: "50%",
                                                                background: "#201e24",
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
                                                        color: "#201e24",
                                                        transition: "font-size 0.3s ease"
                                                    }}>11:50 AM</div>
                                                    <div style={{ fontSize: mockStep >= 3 ? 9.5 : 8, color: "#8a8886" }}>LAX</div>
                                                </div>
                                            </div>

                                            {/* Price and Book button */}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                                                <div style={{
                                                    fontSize: mockStep >= 3 ? 16 : 12,
                                                    fontWeight: 800,
                                                    color: "#201e24",
                                                    transition: "font-size 0.3s ease"
                                                }}>$127</div>
                                                <div style={{
                                                    padding: mockStep >= 3 ? "5px 10px" : "3px 6px",
                                                    background: mockStep >= 4 ? "#16a34a" : "#201e24",
                                                    color: "#f5f4f0",
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
                                                <span style={{ fontSize: 9.5, fontWeight: 600, color: "#4b5563" }}>
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
                                                    <div style={{ fontSize: 11, fontWeight: 700, color: "#4b5563" }}>08:15 AM</div>
                                                    <div style={{ fontSize: 7.5, color: "#9ca3af" }}>JFK</div>
                                                </div>
                                                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
                                                    <div style={{ fontSize: 7, color: "#9ca3af" }}>6h 40m</div>
                                                    <div style={{ width: 35, height: 1, background: "#e5e7eb" }} />
                                                    <div style={{ fontSize: 6.5, color: "#9ca3af" }}>1 stop (ORD)</div>
                                                </div>
                                                <div style={{ textAlign: "right" }}>
                                                    <div style={{ fontSize: 11, fontWeight: 700, color: "#4b5563" }}>02:55 PM</div>
                                                    <div style={{ fontSize: 7.5, color: "#9ca3af" }}>LAX</div>
                                                </div>
                                            </div>

                                            {/* Price */}
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 1 }}>
                                                <div style={{ fontSize: 11, fontWeight: 700, color: "#4b5563" }}>$154</div>
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
                                                <path d="M4 4l7.67 18.25 2.55-7.7 7.7-2.55L4 4z" fill="#201e24" stroke="#ffffff" strokeWidth="2.5" />
                                            </svg>
                                        </motion.div>
                                    </div>

                                    {/* Navis AI Panel Sidebar (Right) */}
                                    <div style={{
                                        width: 180,
                                        background: "#201e24",
                                        color: "#f5f4f0",
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
                                                background: mockStep === 5 ? "#10b981" : "#a78bfa",
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
                                            <div style={{ fontSize: 7, color: "#8a8886", textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 2 }}>
                                                User Request
                                            </div>
                                            <div style={{ fontSize: 9.5, color: "#ffffff", fontWeight: 500, lineHeight: 1.3 }}>
                                                "make booking page better, increase size"
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
                                                        color: isDone ? "#a1a1aa" : isActive ? "#ffffff" : "#8a8886",
                                                        transition: "all 0.3s ease",
                                                    }}>
                                                        {isDone ? (
                                                            <span style={{ color: "#10b981", fontWeight: "bold" }}>✓</span>
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
                                        const url = "https://chromewebstore.google.com/search/Everfern%20Navis";
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
                                        background: "#ffffff",
                                        border: "1px solid rgba(32,30,36,0.1)",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 13,
                                        color: "#201e24",
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                        transition: "all 0.15s ease",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = "rgba(32,30,36,0.02)";
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.2)";
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = "#ffffff";
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.1)";
                                    }}
                                >
                                    {/* Chrome Grey SVG */}
                                    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                        <circle cx="24" cy="24" r="22" fill="#d4d4d4"/>
                                        <circle cx="24" cy="24" r="9" fill="#fff"/>
                                        <circle cx="24" cy="24" r="5.5" fill="#a3a3a3"/>
                                        <path d="M24 2C14 2 5.7 8.4 3 17l12.5.5L24 15a9 9 0 0 1 8.5 5H46A22 22 0 0 0 24 2z" fill="#b0b0b0"/>
                                        <path d="M32.5 20A9 9 0 0 1 28 32.5L34 44A22 22 0 0 0 46 20H32.5z" fill="#c0c0c0"/>
                                        <path d="M20 32.5A9 9 0 0 1 15.5 17L3 17a22 22 0 0 0 31 27l-6-11.5z" fill="#9a9a9a"/>
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
                                        background: "#ffffff",
                                        border: "1px solid rgba(32,30,36,0.1)",
                                        cursor: "pointer",
                                        fontWeight: 600,
                                        fontSize: 13,
                                        color: "#201e24",
                                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                                        transition: "all 0.15s ease",
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.background = "rgba(32,30,36,0.02)";
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.2)";
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.background = "#ffffff";
                                        e.currentTarget.style.borderColor = "rgba(32,30,36,0.1)";
                                    }}
                                >
                                    {/* Firefox Grey SVG */}
                                    <svg width="18" height="18" viewBox="0 0 48 48" fill="none">
                                        <circle cx="24" cy="24" r="22" fill="#c8c8c8"/>
                                        <path d="M42 16c.5-3-1-6.5-4-8-2 4-4.5 6.5-5.5 11.5-2 7-7 11-11 12-6 1.5-12-3-12-9 0-6 6-10 10-10 3 0 5 2 5 3s-2 2-3 0c-1-1.5-3-1-4 1s0 4 2 4c5 0 8-3 9-7C30 5 22 2 22 2s9-2 17 3c4 3 5 7 3 11z" fill="#a0a0a0"/>
                                        <path d="M14 24c0 6 4 11 10 11s10-5 10-11-4-11-10-11-10 5-10 11z" fill="#b8b8b8" fillOpacity="0.4"/>
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
                                    color: "#8a8886",
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    textDecoration: "none",
                                    marginBottom: 24,
                                    fontWeight: 500,
                                    transition: "color 0.15s",
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = "#201e24"}
                                onMouseLeave={e => e.currentTarget.style.color = "#8a8886"}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: "middle" }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                                View source code on GitHub
                            </button>

                            {/* Continue button */}
                            <button
                                onClick={() => setStep(7)}
                                style={{
                                    width: "100%",
                                    maxWidth: 420,
                                    height: 52,
                                    background: "#201e24",
                                    color: "#f5f4f0",
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
                                onMouseEnter={e => (e.currentTarget.style.background = "#111111")}
                                onMouseLeave={e => (e.currentTarget.style.background = "#201e24")}
                            >
                                Continue <ArrowRight size={16} strokeWidth={2.5} />
                            </button>
                        </motion.div>
                    )}

                    {/* ── Step 7: Privacy & Security ── */}
                    {step === 7 && (
                        <motion.div
                            key="step7"
                            variants={pageVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={pageTransition}
                            style={{ width: "100%", maxWidth: 480, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}
                        >
                            <div style={{ width: "100%", display: "flex", justifyContent: "flex-start", marginBottom: 32 }}>
                                <BackButton onClick={() => setStep(6)} />
                            </div>

                            {/* Static Padlock SVG */}
                            <div style={{ marginBottom: 36, width: 120, height: 130 }}>
                                <svg width="120" height="130" viewBox="0 0 120 130" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    {/* Shackle */}
                                    <path
                                        d="M44 66 L44 50 Q44 36 60 36 Q76 36 76 50 L76 66"
                                        stroke="#201e24" strokeWidth="6" strokeLinecap="round"
                                        fill="none"
                                    />
                                    {/* Lock body */}
                                    <rect x="38" y="64" width="44" height="32" rx="6" fill="#201e24" />
                                    {/* Keyhole circle */}
                                    <circle cx="60" cy="76" r="4" fill="#f5f4f0" />
                                    {/* Keyhole slot */}
                                    <rect x="58" y="76" width="4" height="8" rx="2" fill="#f5f4f0" />
                                </svg>
                            </div>

                            {/* Title */}
                            <h1 style={{
                                fontSize: 32,
                                fontWeight: 500,
                                letterSpacing: "-0.03em",
                                color: "#201e24",
                                marginBottom: 12,
                                lineHeight: 1.1,
                            }}>
                                Your privacy is protected
                            </h1>

                            {/* Subtitle */}
                            <p style={{
                                fontSize: 14,
                                color: "#8a8886",
                                lineHeight: 1.7,
                                maxWidth: 360,
                                marginBottom: 32,
                            }}>
                                {engine === "everfern" ? (
                                    <>EverFern Cloud runs on our own self-hosted infrastructure. We <strong style={{ color: "#201e24" }}>never send your data to third parties</strong>, host all models ourselves, and <strong style={{ color: "#201e24" }}>don't store any of your conversations or code</strong>.  Your work stays yours.</>
                                ) : (
                                    <>All your API keys and credentials are stored <strong style={{ color: "#201e24" }}>locally on your device</strong> and never leave your machine. EverFern doesn't collect, track, or transmit any of your data.</>
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
                                            <div style={{ fontSize: 13, fontWeight: 600, color: "#201e24", marginBottom: 2 }}>{feature.title}</div>
                                            <div style={{ fontSize: 12, color: "#8a8886", lineHeight: 1.5 }}>{feature.desc}</div>
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
                                    background: "#201e24",
                                    color: "#f5f4f0",
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
                                onMouseEnter={e => !isSaving && (e.currentTarget.style.background = "#111111")}
                                onMouseLeave={e => (e.currentTarget.style.background = "#201e24")}
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
                <span style={{ fontWeight: 500, fontSize: 14, color: "#201e24", letterSpacing: "-0.01em" }}>{p.name}</span>
            </div>
            <ChevronRight size={15} style={{ color: "#8a8886" }} />
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
