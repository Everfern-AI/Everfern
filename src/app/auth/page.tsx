"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { ChevronLeft, Loader2, ArrowRight } from "lucide-react";
import WindowControls from "../components/WindowControls";

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

function getInitials(name: string): string {
    const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

const AVATAR_FALLBACK_COLORS = ["#14b8a6", "#6366f1", "#0ea5e9", "#f59e0b", "#ec4899", "#10b981"];

function UserAvatar({ user, displayName }: { user: CloudUser; displayName: string }) {
    const [imgFailed, setImgFailed] = useState(false);
    const showImg = !!user.avatarUrl && !imgFailed;
    const initials = getInitials(displayName || user.email);
    const color = AVATAR_FALLBACK_COLORS[[...(user.id || displayName)].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_FALLBACK_COLORS.length];

    if (!showImg) {
        return (
            <div
                aria-label={displayName}
                style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    marginBottom: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: color,
                    color: "#ffffff",
                    fontSize: 22,
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                    userSelect: "none",
                }}
            >
                {initials}
            </div>
        );
    }
    return (
        <img
            src={user.avatarUrl!}
            alt={displayName}
            referrerPolicy="no-referrer"
            onError={() => setImgFailed(true)}
            style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                marginBottom: 16,
                objectFit: "cover",
            }}
        />
    );
}

export default function AuthPage() {
    const router = useRouter();
    const [isGuestLoading, setIsGuestLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [googleWaiting, setGoogleWaiting] = useState(false);
    const [signedInUser, setSignedInUser] = useState<CloudUser | null>(null);
    const pollRef = useRef<NodeJS.Timeout | null>(null);
    const guestTimerRef = useRef<NodeJS.Timeout | null>(null);
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
        return () => {
            if (guestTimerRef.current) { clearTimeout(guestTimerRef.current); guestTimerRef.current = null; }
        };
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
        guestTimerRef.current = setTimeout(() => router.push("/setup"), 600);
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
        if (guestTimerRef.current) { clearTimeout(guestTimerRef.current); guestTimerRef.current = null; }
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

    return (
        <div className="flex min-h-screen" style={{ fontFamily: "var(--font-sans)", background: "var(--color-bg-base, #f5f4f0)" }}>
            {/* Window Controls */}
            <div style={{ position: "fixed", top: 16, right: 20, zIndex: 100 }}>
                <WindowControls />
            </div>

            <div className="flex-1 flex flex-col items-center justify-center relative px-8" style={{ background: "var(--color-bg-base, #f5f4f0)" }}>

                {/* Back Button */}
                {!signedInUser && (
                    <button
                        onClick={() => router.push("/")}
                        className="absolute top-12 left-8 flex items-center gap-2 transition-colors text-sm font-medium z-50 focus:outline-none"
                        style={{ color: "var(--color-text-tertiary, #8a8886)" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-secondary, #4a4846)"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--color-text-tertiary, #8a8886)"; }}
                    >
                        <ChevronLeft size={16} /> Back
                    </button>
                )}

                {/* Logo */}
                <motion.div
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.6, delay: 0.05 }}
                    className="absolute top-10 flex items-center gap-3"
                >
                    <Image
                        src="/images/logos/black-logo-withoutbg.png"
                        alt="EverFern"
                        width={52}
                        height={52}
                        className="opacity-95"
                        priority
                    />
                    <span className="text-[32px] font-normal tracking-[-0.04em]" style={{ fontFamily: "var(--font-branding)", color: "var(--color-text-primary, #201e24)" }}>
                        everfern
                    </span>
                </motion.div>

                <AnimatePresence mode="wait">

                    {/* ── Signed-in view ── */}
                    {signedInUser ? (
                        <motion.div
                            key="signed-in"
                            initial={{ opacity: 0, scale: 0.96, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ type: "spring", bounce: 0.18, duration: 0.5 }}
                            className="glossy"
                            style={{
                                width: "100%",
                                maxWidth: 420,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                textAlign: "center",
                                background: 'var(--color-bg-surface, #fff)',
                                borderRadius: 24,
                                padding: 40,
                            }}
                        >
                            {/* Avatar or initials fallback */}
                            <UserAvatar user={signedInUser} displayName={displayName} />

                            <h2 style={{
                                fontSize: 28,
                                fontWeight: 500,
                                letterSpacing: "-0.03em",
                                color: "var(--color-text-primary, #201e24)",
                                marginBottom: 6,
                                lineHeight: 1.2,
                            }}>
                                Welcome back, {displayName.split(" ")[0]}!
                            </h2>

                            {/* Email + plan pill */}
                            <div style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                background: "var(--color-bg-hover, rgba(0,0,0,0.04))",
                                border: `1px solid var(--color-border-subtle, rgba(0,0,0,0.1))`,
                                borderRadius: 999,
                                padding: "5px 14px",
                                marginBottom: 28,
                            }}>
                                <span style={{ fontSize: 12, color: "var(--color-text-primary, #111111)", fontWeight: 500 }}>
                                    {signedInUser.email}
                                </span>
                                <span style={{ fontSize: 10, color: "var(--color-text-tertiary, #8a8886)" }}>·</span>
                                <span style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: signedInUser.plan === "free" ? "var(--color-text-tertiary, #8a8886)" : "var(--color-text-primary, #111111)",
                                }}>
                                    {signedInUser.plan}
                                </span>
                            </div>

                            {/* Continue */}
                            <motion.button
                                onClick={handleContinueAsUser}
                                whileTap={{ scale: 0.98 }}
                                style={{
                                    width: "100%",
                                    padding: "15px 24px",
                                    backgroundColor: "var(--color-text-primary, #111111)",
                                    color: "var(--color-text-inverse, #ffffff)",
                                    borderRadius: "12px",
                                    fontWeight: 600,
                                    fontSize: "15px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 10,
                                    border: "none",
                                    cursor: "pointer",
                                    fontFamily: "var(--font-sans)",
                                    boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
                                }}
                            >
                                Continue to EverFern <ArrowRight size={16} />
                            </motion.button>

                            <button
                                onClick={handleSignOut}
                                style={{
                                    marginTop: 16,
                                    background: "none",
                                    border: "none",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    color: "var(--color-text-tertiary, #8a8886)",
                                    textDecoration: "underline",
                                    fontFamily: "var(--font-sans)",
                                }}
                            >
                                Sign out
                            </button>
                        </motion.div>

                    ) : (

                        /* ── Auth options ── */
                        <motion.div
                            key="auth-options"
                            variants={containerVariants}
                            initial="hidden"
                            animate="visible"
                            exit={{ opacity: 0 }}
                            className="w-full max-w-[420px] flex flex-col items-center text-center glossy"
                            style={{ background: 'var(--color-bg-surface, #fff)', borderRadius: 24, padding: 40 }}
                        >
                            <motion.h2
                                variants={itemVariants}
                                style={{
                                    fontSize: 32,
                                    fontWeight: 500,
                                    letterSpacing: "-0.03em",
                                    color: "var(--color-text-primary, #201e24)",
                                    lineHeight: 1.2,
                                    margin: "0 0 12px 0",
                                }}
                            >
                                Welcome Back
                            </motion.h2>

                            <motion.p
                                variants={itemVariants}
                                style={{
                                    fontSize: 14,
                                    color: "var(--color-text-tertiary, #8a8886)",
                                    fontWeight: 400,
                                    lineHeight: 1.6,
                                    margin: "0 0 36px 0",
                                    maxWidth: 340,
                                }}
                            >
                                Sign in to continue, or jump straight in as a guest.
                            </motion.p>

                            <motion.div variants={itemVariants} className="w-full" style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                                {/* Google — via landing API, no SDK */}
                                <div className="w-full">
                                    {googleWaiting ? (
                                        <div style={{
                                            width: "100%",
                                            padding: "14px 24px",
                                            backgroundColor: "rgba(0,104,95,0.05)",
                                            border: "1px solid rgba(0,104,95,0.25)",
                                            borderRadius: "12px",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 10,
                                            fontFamily: "var(--font-sans)",
                                        }}>
                                            <Loader2 size={16} className="animate-spin" style={{ color: "#00685f", flexShrink: 0 }} />
                                            <span style={{ fontSize: 14, color: "var(--color-text-secondary, #4a4846)", fontWeight: 500 }}>
                                                Waiting for Everfern Cloud sign-in…
                                            </span>
                                            <button
                                                onClick={() => { setGoogleWaiting(false); if (pollRef.current) clearInterval(pollRef.current); }}
                                                style={{
                                                    marginLeft: "auto",
                                                    fontSize: 11,
                                                    color: "var(--color-text-tertiary, #8a8886)",
                                                    background: "none",
                                                    border: "none",
                                                    cursor: "pointer",
                                                    textDecoration: "underline",
                                                    padding: 0,
                                                    flexShrink: 0,
                                                }}
                                            >
                                                Cancel
                                            </button>
                                        </div>
                                    ) : (
                                        <motion.button
                                            onClick={handleGoogleLogin}
                                            disabled={isGoogleLoading || isGuestLoading}
                                            whileTap={{ scale: 0.985 }}
                                            style={{
                                                width: "100%",
                                                padding: "15px 24px",
                                                backgroundColor: "var(--color-bg-elevated, #ffffff)",
                                                border: `1px solid var(--color-border, #e8e6d9)`,
                                                color: "var(--color-text-primary, #201e24)",
                                                borderRadius: "12px",
                                                fontWeight: 500,
                                                fontSize: "15px",
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 12,
                                                cursor: isGoogleLoading ? "wait" : "pointer",
                                                fontFamily: "var(--font-sans)",
                                                boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
                                                transition: "border-color 0.15s, box-shadow 0.15s",
                                            }}
                                            onMouseEnter={(e) => {
                                                (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border-strong, #8a8886)";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                                            }}
                                            onMouseLeave={(e) => {
                                                (e.currentTarget as HTMLElement).style.borderColor = "var(--color-border, #e8e6d9)";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
                                            }}
                                        >
                                            {isGoogleLoading ? (
                                                <Loader2 size={18} className="animate-spin" style={{ opacity: 0.6 }} />
                                            ) : (
                                                <Image src="/images/logos/black-logo-withoutbg.png" alt="Everfern" width={38} height={38} style={{ opacity: 0.85 }} />
                                            )}
                                            Continue with Everfern Cloud
                                        </motion.button>
                                    )}
                                </div>

                                {/* Guest */}
                                <motion.div className="w-full" whileTap={{ scale: 0.98 }}>
                                    <button
                                        onClick={handleGuestLogin}
                                        disabled={isGuestLoading}
                                        style={{
                                            width: "100%",
                                            padding: "15px 24px",
                                            backgroundColor: "var(--color-text-primary, #111111)",
                                            color: "var(--color-text-inverse, #ffffff)",
                                            borderRadius: "12px",
                                            fontWeight: 600,
                                            fontSize: "15px",
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            gap: 12,
                                            border: "none",
                                            cursor: isGuestLoading ? "wait" : "pointer",
                                            fontFamily: "var(--font-sans)",
                                            boxShadow: "0 4px 14px rgba(0,0,0,0.1)",
                                            transition: "background-color 0.2s ease, box-shadow 0.2s ease",
                                        }}
                                    >
                                        {isGuestLoading ? (
                                            <div className="flex items-center gap-1.5 h-5">
                                                {[0, 1, 2].map((i) => (
                                                    <motion.span
                                                        key={i}
                                                        className="w-1.5 h-1.5 rounded-full"
                                                        animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
                                                        transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.18 }}
                                                    />
                                                ))}
                                            </div>
                                        ) : (
                                            <>
                                                Continue as Guest
                                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-1 opacity-80">
                                                    <path d="M5 12h14" />
                                                    <path d="M12 5l7 7-7 7" />
                                                </svg>
                                            </>
                                        )}
                                    </button>
                                </motion.div>

                            </motion.div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}
