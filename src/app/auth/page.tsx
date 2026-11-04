"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { ChevronLeft, Loader2, ArrowRight, Cloud, Check } from "lucide-react";
import { GlassShell, GlassTitle, GlassPill, stagger, rise, EASE } from "../components/onboarding/GlassShell";

const containerVariants: Variants = {
    hidden: {},
    visible: {
        transition: { staggerChildren: 0.1, delayChildren: 0.15 },
    },
};

const itemVariants: Variants = {
    hidden: { opacity: 0, y: 18 },
    visible: {
        opacity: 1,
        y: 0,
        transition: { type: "spring", bounce: 0.2, duration: 0.6 },
    },
};

// Landing site base URL for the web app UI
const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "https://everfern.app";
// API base URL for authentication endpoints
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://api.everfern.app";

// Key used to persist the access token and user between reloads
const STORAGE_KEY = "everfern_cloud_session";

interface CloudUser {
    id: string;
    email: string;
    fullName: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    plan: string;
    onboardingDone: boolean;
}

interface StoredSession {
    accessToken: string;
    refreshToken: string;
    user: CloudUser;
}

export default function AuthPage() {
    const router = useRouter();
    const [isGuestLoading, setIsGuestLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleWaiting, setGoogleWaiting] = useState(false);
    const [signedInUser, setSignedInUser] = useState<CloudUser | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const desktopCodeRef = useRef<string | null>(null);

    // ── On mount: restore session from storage ─────────────────
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const session: StoredSession = JSON.parse(stored);
                setSignedInUser(session.user);
            }
        } catch {
            // ignore parse errors
        }
    }, []);

    // ── Poll the landing API while waiting for Google auth ─────
    useEffect(() => {
        if (googleWaiting && desktopCodeRef.current) {
            pollRef.current = setInterval(() => pollForAuth(desktopCodeRef.current!), 2500);
        } else {
            if (pollRef.current) clearInterval(pollRef.current);
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
    }, [googleWaiting]);

    // ── Listen for protocol deep-link (everfern-app://auth-success) ──
    useEffect(() => {
        const api = (window as any).electronAPI;
        if (!api?.on) return;
        const handler = (url: string) => {
            console.log('[Auth] Protocol link received:', url);
            if (desktopCodeRef.current) {
                pollForAuth(desktopCodeRef.current);
            }
        };
        api.on('acp:protocol-link', handler);
        return () => { api.off('acp:protocol-link', handler); };
    }, []);

    async function pollForAuth(code: string) {
        try {
            const res = await fetch(`${API_URL}/api/auth/desktop-poll?code=${code}`);
            if (res.status === 202) return; // still pending

            if (res.ok) {
                const data = await res.json();
                if (data.status === "complete") {
                    // Persist session
                    const session: StoredSession = {
                        accessToken: data.accessToken,
                        refreshToken: data.refreshToken,
                        user: data.user,
                    };
                    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
                    setSignedInUser(data.user);
                    setGoogleWaiting(false);
                    if (pollRef.current) clearInterval(pollRef.current);
                }
            }
        } catch {
            // Network error — keep polling
        }
    }

    const handleGuestLogin = () => {
        setIsGuestLoading(true);
        setTimeout(() => router.push("/setup"), 600);
    };

    const handleGoogleLogin = async () => {
        setIsGoogleLoading(true);
        try {
            // Generate a one-time nonce for this auth attempt
            const desktopCode = crypto.randomUUID();
            desktopCodeRef.current = desktopCode;

            const oauthUrl = `${LANDING_URL}/login?source=desktop&desktop_code=${desktopCode}`;

            if ((window as any).electronAPI?.shell?.openExternal) {
                await (window as any).electronAPI.shell.openExternal(oauthUrl);
            } else {
                window.open(oauthUrl, "_blank");
            }
            setGoogleWaiting(true);
        } catch (err) {
            console.error("Google auth error:", err);
        } finally {
            setIsGoogleLoading(false);
        }
    };

    const handleSignOut = () => {
        localStorage.removeItem(STORAGE_KEY);
        setSignedInUser(null);
        if ((window as any).electronAPI?.saveConfig) {
            (window as any).electronAPI.saveConfig({});
        }
    };

    const handleContinueAsUser = async () => {
        if (signedInUser?.onboardingDone) {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                try {
                    const session = JSON.parse(stored);
                    const token = session?.accessToken;
                    if (token && (window as any).electronAPI?.saveConfig) {
                        const config = {
                            provider: 'everfern',
                            apiKey: token,
                            model: 'everfern-1',
                            timestamp: new Date().toISOString(),
                            vlm: {
                                engine: "everfern",
                                provider: "everfern",
                                model: "everfern-1",
                                apiKey: token
                            }
                        };
                        await (window as any).electronAPI.saveConfig(config);
                    }
                } catch (err) {
                    console.error("Failed to auto-save config:", err);
                }
            }
            router.push("/chat");
        } else {
            router.push("/setup");
        }
    };

    const displayName = signedInUser?.displayName ?? signedInUser?.fullName ?? signedInUser?.email ?? "";

    const busy = isGoogleLoading || isGuestLoading;
    const swap = {
        initial: { opacity: 0, y: 12, filter: "blur(8px)" },
        animate: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.6, ease: EASE } },
        exit: { opacity: 0, y: -8, filter: "blur(6px)", transition: { duration: 0.3, ease: EASE } },
    };

    return (
        <GlassShell
            photo="lake"
            progress={[2, 3]}
            bottomLeft={
                !signedInUser && !googleWaiting ? (
                    <button className="ef-chip-btn" onClick={() => router.push("/")}>
                        <ChevronLeft size={14} /> Back
                    </button>
                ) : null
            }
        >
            <AnimatePresence mode="wait">
                {signedInUser ? (
                    <motion.div key="signed-in" {...swap} style={{ width: "100%", maxWidth: 420, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <GlassTitle title="Welcome back" subtitle={displayName || undefined} />
                        <div className="ef-card is-selected" style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, cursor: "default" }}>
                            {signedInUser.avatarUrl ? (
                                <img src={signedInUser.avatarUrl} alt="" width={40} height={40} style={{ borderRadius: 999 }} />
                            ) : (
                                <span className="ef-icon-tile" style={{ width: 40, height: 40, borderRadius: 999, fontWeight: 600 }}>
                                    {(displayName || "?").charAt(0).toUpperCase()}
                                </span>
                            )}
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <div className="ef-card-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{signedInUser.email}</div>
                                <div className="ef-card-meta" style={{ textTransform: "capitalize" }}>EverFern Cloud · {signedInUser.plan} plan</div>
                            </div>
                        </div>
                        <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
                            <GlassPill variant="ghost" onClick={handleSignOut}>Use another account</GlassPill>
                            <GlassPill onClick={handleContinueAsUser}>Continue <ArrowRight size={15} /></GlassPill>
                        </div>
                    </motion.div>
                ) : googleWaiting ? (
                    <motion.div key="waiting" {...swap} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <Loader2 size={28} className="animate-spin" style={{ color: "#fff", marginBottom: 20 }} />
                        <GlassTitle title="Finish signing in" subtitle="We opened EverFern Cloud in your browser. Come back here once you are signed in." />
                        <GlassPill
                            variant="ghost"
                            onClick={() => { setGoogleWaiting(false); if (pollRef.current) clearInterval(pollRef.current); }}
                        >
                            Cancel
                        </GlassPill>
                    </motion.div>
                ) : (
                    <motion.div key="choose" variants={stagger} initial="hidden" animate="show" exit="exit" style={{ width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <GlassTitle title="Sign in to EverFern Cloud" subtitle="Your workers run on models tuned for computer use. Fastest, most reliable, nothing to configure." />

                        <motion.div variants={rise} className="ef-card is-selected" style={{ width: "100%", cursor: "default" }}>
                            {[
                                "Best accuracy on clicks, forms and long tasks",
                                "Works the moment you sign in, no API keys",
                                "Free plan included",
                            ].map((t) => (
                                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", fontSize: 13.5, color: "rgba(255,255,255,0.88)" }}>
                                    <Check size={15} strokeWidth={2.2} style={{ flexShrink: 0 }} /> {t}
                                </div>
                            ))}
                        </motion.div>

                        <motion.div variants={rise} style={{ marginTop: 22, width: "100%" }}>
                            <button type="button" className="ef-pill ef-pill-light" style={{ width: "100%", height: 46, fontSize: 14.5 }} onClick={handleGoogleLogin} disabled={busy}>
                                {isGoogleLoading ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />}
                                Sign in with EverFern Cloud
                            </button>
                        </motion.div>

                        <motion.div variants={rise} style={{ marginTop: 26, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                            <button type="button" className="ef-skip" onClick={handleGuestLogin} disabled={busy}>
                                {isGuestLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                                Skip, and lose performance
                            </button>
                            <span className="ef-note" style={{ fontSize: 11.5, opacity: 0.8 }}>
                                Bring your own API key or local model. Workers are only as good as the model you pick.
                            </span>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </GlassShell>
    );
}
