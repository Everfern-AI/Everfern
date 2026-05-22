"use client";

import React, { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence, Variants } from "framer-motion";
import { ChevronLeft, Loader2, CheckCircle, ArrowRight, Cloud } from "lucide-react";
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

// Landing site base URL — no SDK, no credentials
const LANDING_URL = process.env.NEXT_PUBLIC_LANDING_URL || "http://localhost:3002";

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

    async function pollForAuth(code: string) {
        try {
            const res = await fetch(`${LANDING_URL}/api/auth/desktop-poll?code=${code}`);
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

            const oauthUrl = `${LANDING_URL}/api/auth/desktop-init?desktop_code=${desktopCode}`;

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
    };

    const handleContinueAsUser = () => {
        if (signedInUser?.onboardingDone) {
            router.push("/chat");
        } else {
            router.push("/setup");
        }
    };

    const displayName = signedInUser?.displayName ?? signedInUser?.fullName ?? signedInUser?.email ?? "";

    return (
        <div className="flex min-h-screen bg-[#f5f4f0]" style={{ fontFamily: "var(--font-sans)" }}>
            {/* Window Controls */}
            <div style={{ position: "fixed", top: 16, right: 20, zIndex: 100 }}>
                <WindowControls />
            </div>

            <div className="flex-1 flex flex-col items-center justify-center relative px-8 bg-[#f5f4f0]">

                {/* Back Button */}
                {!signedInUser && (
                    <button
                        onClick={() => router.push("/")}
                        className="absolute top-12 left-8 flex items-center gap-2 text-[#8a8886] hover:text-[#4a4846] transition-colors text-sm font-medium z-50 focus:outline-none"
                    >
                        <ChevronLeft size={16} /> Back
                    </button>
                )}

                {/* Logo */}
                <motion.div
                    initial={{ opacity: 0, y: -12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.6, delay: 0.05 }}
                    className="absolute top-12 flex items-center gap-2"
                >
                    <Image
                        src="/images/logos/black-logo-withoutbg.png"
                        alt="EverFern"
                        width={28}
                        height={28}
                        className="opacity-90"
                    />
                    <span className="text-[22px] font-normal text-[#201e24] tracking-[-0.04em]" style={{ fontFamily: "var(--font-branding)" }}>
                        everfern
                    </span>
                    <span style={{
                        padding: "4px 10px",
                        backgroundColor: "rgba(32, 30, 36, 0.08)",
                        border: "1px solid rgba(32, 30, 36, 0.1)",
                        borderRadius: "6px",
                        fontSize: "9px",
                        fontWeight: 600,
                        color: "#8a8886",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        marginLeft: 6,
                    }}>
                        Desktop
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
                            style={{
                                width: "100%",
                                maxWidth: 420,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                textAlign: "center",
                            }}
                        >
                            {/* Avatar or check icon */}
                            {signedInUser.avatarUrl ? (
                                <img
                                    src={signedInUser.avatarUrl}
                                    alt={displayName}
                                    style={{
                                        width: 64,
                                        height: 64,
                                        borderRadius: "50%",
                                        marginBottom: 16,
                                        border: "2px solid rgba(0,104,95,0.25)",
                                    }}
                                />
                            ) : (
                                <div style={{
                                    width: 64,
                                    height: 64,
                                    borderRadius: "50%",
                                    background: "rgba(0,104,95,0.08)",
                                    border: "1px solid rgba(0,104,95,0.2)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    marginBottom: 16,
                                }}>
                                    <CheckCircle size={26} color="#00685f" strokeWidth={1.5} />
                                </div>
                            )}

                            <h2 style={{
                                fontSize: 28,
                                fontWeight: 500,
                                letterSpacing: "-0.03em",
                                color: "#201e24",
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
                                background: "rgba(0,104,95,0.06)",
                                border: "1px solid rgba(0,104,95,0.15)",
                                borderRadius: 999,
                                padding: "5px 14px",
                                marginBottom: 28,
                            }}>
                                <span style={{ fontSize: 12, color: "#00685f", fontWeight: 500 }}>
                                    {signedInUser.email}
                                </span>
                                <span style={{ fontSize: 10, color: "#bcc9c6" }}>·</span>
                                <span style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    letterSpacing: "0.06em",
                                    color: signedInUser.plan === "free" ? "#8a8886" : "#00685f",
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
                                    backgroundColor: "#111111",
                                    color: "#ffffff",
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
                                    color: "#8a8886",
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
                            className="w-full max-w-[420px] flex flex-col items-center text-center"
                        >
                            <motion.h2
                                variants={itemVariants}
                                style={{
                                    fontSize: 32,
                                    fontWeight: 500,
                                    letterSpacing: "-0.03em",
                                    color: "#201e24",
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
                                    color: "#8a8886",
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
                                            <span style={{ fontSize: 14, color: "#4a4846", fontWeight: 500 }}>
                                                Waiting for Everfern Cloud sign-in…
                                            </span>
                                            <button
                                                onClick={() => { setGoogleWaiting(false); if (pollRef.current) clearInterval(pollRef.current); }}
                                                style={{
                                                    marginLeft: "auto",
                                                    fontSize: 11,
                                                    color: "#8a8886",
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
                                                backgroundColor: "#ffffff",
                                                border: "1px solid #e8e6d9",
                                                color: "#201e24",
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
                                                (e.currentTarget as HTMLElement).style.borderColor = "#8a8886";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)";
                                            }}
                                            onMouseLeave={(e) => {
                                                (e.currentTarget as HTMLElement).style.borderColor = "#e8e6d9";
                                                (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
                                            }}
                                        >
                                            {isGoogleLoading ? (
                                                <Loader2 size={18} className="animate-spin" style={{ opacity: 0.6 }} />
                                            ) : (
                                                <Image src="/images/logos/black-logo-withoutbg.png" alt="Everfern" width={18} height={18} style={{ opacity: 0.85 }} />
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
                                            backgroundColor: "#111111",
                                            color: "#ffffff",
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
                                                        className="w-1.5 h-1.5 bg-[#ffffff] rounded-full"
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
