                  "use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    XMarkIcon,
    ExclamationTriangleIcon,
    WifiIcon,
    NoSymbolIcon,
    CheckCircleIcon,
    XCircleIcon
} from "@heroicons/react/24/outline";
import TelegramConfig from "./TelegramConfig";
import DiscordConfig from "./DiscordConfig";

interface IntegrationSettingsProps {
    isOpen: boolean;
    onClose: () => void;
}

interface IntegrationConfig {
    telegram: {
        enabled: boolean;
        botToken: string;
        webhookUrl?: string;
        connected: boolean;
        provider?: string;
        model?: string;
        requireApproval?: boolean;
        approvalCode?: string;
        approvedUsers?: string[];
    };
    discord: {
        enabled: boolean;
        botToken: string;
        applicationId: string;
        connected: boolean;
        provider?: string;
        model?: string;
        allowedGuilds?: string[];
        allowedUsers?: string[];
    };
}

interface IntegrationCardProps {
    name: string;
    description: string;
    logoPath: string;
    enabled: boolean;
    connected: boolean;
    onToggle: (enabled: boolean) => void;
    onConfigure: () => void;
    testResult?: { success: boolean; message: string; timestamp: number } | null;
    testing?: boolean;
}

// Toggle Switch Component
const ToggleSwitch: React.FC<{
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    disabled?: boolean;
}> = ({ enabled, onChange, disabled = false }) => {
    return (
        <button
            onClick={() => !disabled && onChange(!enabled)}
            disabled={disabled}
            style={{
                width: 44,
                height: 24,
                borderRadius: 12,
                border: "none",
                backgroundColor: enabled ? "#111111" : "#e5e5e0",
                position: "relative",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "all 0.2s ease",
                opacity: disabled ? 0.5 : 1,
            }}
        >
            <motion.div
                animate={{
                    x: enabled ? 20 : 0,
                }}
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                style={{
                    width: 20,
                    height: 20,
                    borderRadius: 10,
                    backgroundColor: "#ffffff",
                    position: "absolute",
                    top: 2,
                    left: 2,
                    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
                }}
            />
        </button>
    );
};

// Integration Card Component
const IntegrationCard: React.FC<IntegrationCardProps> = ({
    name,
    description,
    logoPath,
    enabled,
    connected,
    onToggle,
    onConfigure,
    testResult,
    testing = false,
}) => {
    const colors = {
        cardBg: "#ffffff",
        cardHover: "#fbfbfb",
        border: "#e5e5e0",
        textPrimary: "#111111",
        textSecondary: "#666666",
        textMuted: "#999999",
        success: "#10b981",
        warning: "#f59e0b",
        error: "#ef4444",
        successBg: "#f0fdf4",
        errorBg: "#fef2f2",
        infoBg: "#f0f9ff",
    };

    const getStatusIcon = () => {
        if (!enabled) {
            return <NoSymbolIcon width={16} height={16} style={{ color: colors.textMuted }} />;
        }
        if (testing) {
            return (
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                    <div
                        style={{
                            width: 16,
                            height: 16,
                            border: `2px solid ${colors.textSecondary}`,
                            borderTop: `2px solid ${colors.textPrimary}`,
                            borderRadius: "50%",
                        }}
                    />
                </motion.div>
            );
        }
        if (connected) {
            return (
                <motion.div
                    initial={{ scale: 0.8 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                >
                    <WifiIcon width={16} height={16} style={{ color: colors.success }} />
                </motion.div>
            );
        }
        return (
            <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            >
                <ExclamationTriangleIcon width={16} height={16} style={{ color: colors.warning }} />
            </motion.div>
        );
    };

    const getStatusText = () => {
        if (!enabled) return "Disabled";
        if (testing) return "Testing...";
        if (connected) return "Connected";
        return "Not Connected";
    };

    const getStatusColor = () => {
        if (!enabled) return colors.textMuted;
        if (testing) return colors.textSecondary;
        if (connected) return colors.success;
        return colors.warning;
    };

    return (
        <div
            style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 12,
                padding: 20,
                backgroundColor: colors.cardBg,
                transition: "all 0.2s ease",
                cursor: "pointer",
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = colors.cardHover;
                e.currentTarget.style.borderColor = "#d0d0d0";
                e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.03)";
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = colors.cardBg;
                e.currentTarget.style.borderColor = colors.border;
                e.currentTarget.style.boxShadow = "none";
            }}
        >
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            backgroundColor: "#f5f5f5",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            overflow: "hidden",
                        }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={logoPath}
                            alt={`${name} logo`}
                            style={{ width: 24, height: 24, objectFit: "contain" }}
                            onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="%23999999"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>';
                            }}
                        />
                    </div>
                    <div>
                        <h3 style={{ fontSize: 16, fontWeight: 600, color: colors.textPrimary, margin: 0 }}>
                            {name}
                        </h3>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                            {getStatusIcon()}
                            <span style={{ fontSize: 13, color: getStatusColor(), fontWeight: 500 }}>
                                {getStatusText()}
                            </span>
                        </div>
                    </div>
                </div>
                <ToggleSwitch enabled={enabled} onChange={onToggle} />
            </div>

            {/* Description */}
            <p style={{ fontSize: 14, color: colors.textSecondary, lineHeight: 1.5, margin: "0 0 16px 0" }}>
                {description}
            </p>

            {/* Configure Button */}
            {enabled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onConfigure();
                        }}
                        style={{
                            width: "100%",
                            padding: "8px 16px",
                            borderRadius: 8,
                            border: `1px solid ${colors.border}`,
                            backgroundColor: "transparent",
                            color: colors.textPrimary,
                            fontSize: 14,
                            fontWeight: 500,
                            cursor: "pointer",
                            transition: "all 0.2s ease",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = "#f0f0f0";
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = "transparent";
                        }}
                    >
                        Configure Integration
                    </button>

                    {/* Connection Status Bar */}
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "6px 12px",
                        borderRadius: 6,
                        backgroundColor: testing
                            ? colors.infoBg
                            : connected
                                ? colors.successBg
                                : colors.errorBg,
                        border: `1px solid ${testing
                            ? colors.textSecondary
                            : connected
                                ? colors.success
                                : colors.error}`,
                        gap: 6
                    }}>
                        {testing ? (
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                                <div
                                    style={{
                                        width: 12,
                                        height: 12,
                                        border: `2px solid ${colors.textMuted}`,
                                        borderTop: `2px solid ${colors.textSecondary}`,
                                        borderRadius: "50%",
                                    }}
                                />
                            </motion.div>
                        ) : connected ? (
                            <CheckCircleIcon width={14} height={14} style={{ color: colors.success }} />
                        ) : (
                            <XCircleIcon width={14} height={14} style={{ color: colors.error }} />
                        )}
                        <span style={{
                            fontSize: 12,
                            fontWeight: 500,
                            color: testing
                                ? colors.textSecondary
                                : connected
                                    ? colors.success
                                    : colors.error
                        }}>
                            {testing ? "Testing Connection..." : connected ? "Connection Active" : "Connection Failed"}
                        </span>
                    </div>
                </div>
            )}

            {/* Test Result Message */}
            {testResult && (
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        borderRadius: 8,
                        backgroundColor: testResult.success ? colors.successBg : colors.errorBg,
                        border: `1px solid ${testResult.success ? colors.success : colors.error}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 8
                    }}
                >
                    {testResult.success ? (
                        <CheckCircleIcon width={16} height={16} style={{ color: colors.success, flexShrink: 0 }} />
                    ) : (
                        <XCircleIcon width={16} height={16} style={{ color: colors.error, flexShrink: 0 }} />
                    )}
                    <span style={{
                        fontSize: 13,
                        color: testResult.success ? colors.success : colors.error,
                        fontWeight: 500,
                        lineHeight: 1.4
                    }}>
                        {testResult.message}
                    </span>
                </motion.div>
            )}
        </div>
    );
};

export default function IntegrationSettings({ isOpen, onClose }: IntegrationSettingsProps) {
    const [config, setConfig] = useState<IntegrationConfig>({
        telegram: {
            enabled: false,
            botToken: "",
            webhookUrl: "",
            connected: false,
        },
        discord: {
            enabled: false,
            botToken: "",
            applicationId: "",
            connected: false,
        },
    });

    const [selectedIntegration, setSelectedIntegration] = useState<'telegram' | 'discord' | null>(null);
    const [testing, setTesting] = useState<Record<string, boolean>>({});
    const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; timestamp: number } | null>>({});

    // Load configuration on mount
    useEffect(() => {
        const loadConfig = async () => {
            try {
                const loadedConfig = await (window as unknown as { electronAPI?: { integration?: { getConfig?: () => Promise<IntegrationConfig> } } })?.electronAPI?.integration?.getConfig?.();
                if (loadedConfig) {
                    setConfig(loadedConfig);
                }
            } catch (error) {
                console.error("Failed to load integration config:", error);
            }
        };

        if (isOpen) {
            loadConfig();
        }
    }, [isOpen]);

    const colors = {
        overlay: "rgba(0, 0, 0, 0.2)",
        background: "#ffffff",
        sidebarBg: "#f9f9f8",
        border: "#e5e5e0",
        textPrimary: "#111111",
        textSecondary: "#666666",
        textMuted: "#999999",
        accent: "#000000",
        accentHover: "rgba(0,0,0,0.05)",
        cardBg: "#ffffff",
        cardHover: "#fbfbfb",
        inputBg: "#ffffff",
        buttonBg: "#ffffff",
        buttonHover: "#f0f0f0",
        primaryButton: "#111111",
        primaryButtonText: "#ffffff",
        primaryButtonHover: "#333333",
    };

    const handleToggleIntegration = async (platform: 'telegram' | 'discord', enabled: boolean) => {
        const newConfig = {
            ...config,
            [platform]: {
                ...config[platform],
                enabled,
                connected: enabled ? config[platform].connected : false,
            },
        };

        setConfig(newConfig);

        try {
            await (window as unknown as { electronAPI?: { integration?: { saveConfig?: (config: IntegrationConfig) => Promise<void> } } })?.electronAPI?.integration?.saveConfig?.(newConfig);
        } catch (error) {
            console.error(`Failed to save ${platform} config:`, error);
        }
    };

    const handleConfigureIntegration = (platform: 'telegram' | 'discord') => {
        setSelectedIntegration(platform);
    };

    const handleTestConnection = async (platform: 'telegram' | 'discord'): Promise<boolean> => {
        setTesting(prev => ({ ...prev, [platform]: true }));
        setTestResults(prev => ({ ...prev, [platform]: null })); // Clear previous results

        try {
            const result = await (window as unknown as { electronAPI?: { integration?: { testConnection?: (platform: string) => Promise<boolean> } } })?.electronAPI?.integration?.testConnection?.(platform);
            const latestConfig = await (window as unknown as { electronAPI?: { integration?: { getConfig?: () => Promise<IntegrationConfig> } } })?.electronAPI?.integration?.getConfig?.();
            const baseConfig = latestConfig || config;

            const newConfig = {
                ...baseConfig,
                [platform]: {
                    ...baseConfig[platform],
                    connected: result || false,
                },
            };

            setConfig(newConfig);
            await (window as unknown as { electronAPI?: { integration?: { saveConfig?: (config: IntegrationConfig) => Promise<void> } } })?.electronAPI?.integration?.saveConfig?.(newConfig);

            // Set test result message
            setTestResults(prev => ({
                ...prev,
                [platform]: {
                    success: result || false,
                    message: result
                        ? `${platform.charAt(0).toUpperCase() + platform.slice(1)} connection successful!`
                        : `Failed to connect to ${platform.charAt(0).toUpperCase() + platform.slice(1)}. Please check your credentials.`,
                    timestamp: Date.now()
                }
            }));

            // Clear test result after 5 seconds
            setTimeout(() => {
                setTestResults(prev => ({ ...prev, [platform]: null }));
            }, 5000);

            return result || false;
        } catch (error) {
            console.error(`Failed to test ${platform} connection:`, error);

            // Set error result message
            setTestResults(prev => ({
                ...prev,
                [platform]: {
                    success: false,
                    message: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    timestamp: Date.now()
                }
            }));

            // Clear test result after 5 seconds
            setTimeout(() => {
                setTestResults(prev => ({ ...prev, [platform]: null }));
            }, 5000);

            return false;
        } finally {
            setTesting(prev => ({ ...prev, [platform]: false }));
        }
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                        style={{ position: "absolute", inset: 0, backgroundColor: colors.overlay, backdropFilter: "blur(2px)" }}
                    />

                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        style={{
                            position: "relative",
                            width: "700px",
                            maxHeight: "80vh",
                            backgroundColor: colors.background,
                            borderRadius: "16px",
                            boxShadow: "0 20px 40px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
                            display: "flex",
                            flexDirection: "column",
                            overflow: "hidden",
                        }}
                    >
                        {/* Header */}
                        <div style={{ padding: "24px 32px", borderBottom: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <div>
                                <h2 style={{ fontSize: 20, fontWeight: 600, color: colors.textPrimary, margin: 0, fontFamily: 'var(--font-serif, Georgia, serif)' }}>
                                    Integration Settings
                                </h2>
                                <p style={{ fontSize: 14, color: colors.textSecondary, margin: "4px 0 0 0" }}>
                                    Configure external platform integrations for EverFern
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                style={{
                                    width: 32,
                                    height: 32,
                                    borderRadius: 8,
                                    border: "none",
                                    backgroundColor: "transparent",
                                    color: colors.textSecondary,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    cursor: "pointer",
                                    transition: "all 0.2s",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = colors.accentHover;
                                    e.currentTarget.style.color = colors.textPrimary;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                    e.currentTarget.style.color = colors.textSecondary;
                                }}
                            >
                                <XMarkIcon width={20} height={20} />
                            </button>
                        </div>

                        {/* Content */}
                        <div style={{ flex: 1, overflowY: "auto", padding: "32px" }}>
                            <div style={{ display: "grid", gap: 24 }}>
                                <IntegrationCard
                                    name="Telegram"
                                    description="Connect your Telegram bot to interact with EverFern through Telegram messages. Users can send messages directly to your bot and receive AI responses."
                                    logoPath="/images/integrations/telegram.svg"
                                    enabled={config.telegram.enabled}
                                    connected={config.telegram.connected}
                                    onToggle={(enabled) => handleToggleIntegration('telegram', enabled)}
                                    onConfigure={() => handleConfigureIntegration('telegram')}
                                    testResult={testResults.telegram}
                                    testing={testing.telegram}
                                />

                                <IntegrationCard
                                    name="Discord"
                                    description="Connect your Discord bot to interact with EverFern through Discord servers and direct messages. Support for mentions, channels, and DMs."
                                    logoPath="/images/integrations/discord.svg"
                                    enabled={config.discord.enabled}
                                    connected={config.discord.connected}
                                    onToggle={(enabled) => handleToggleIntegration('discord', enabled)}
                                    onConfigure={() => handleConfigureIntegration('discord')}
                                    testResult={testResults.discord}
                                    testing={testing.discord}
                                />
                            </div>
                        </div>

                        {/* Configuration Modal Overlay */}
                        <AnimatePresence>
                            {selectedIntegration && (
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    style={{
                                        position: "absolute",
                                        inset: 0,
                                        backgroundColor: "rgba(255, 255, 255, 0.8)",
                                        backdropFilter: "blur(4px)",
                                        zIndex: 1100,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        padding: 32
                                    }}
                                >
                                    <motion.div
                                        initial={{ scale: 0.95, y: 20 }}
                                        animate={{ scale: 1, y: 0 }}
                                        exit={{ scale: 0.95, y: 20 }}
                                        style={{
                                            width: "100%",
                                            maxWidth: "600px",
                                            maxHeight: "80vh",
                                            overflowY: "auto",
                                            backgroundColor: "#ffffff",
                                            borderRadius: "16px",
                                            boxShadow: "0 24px 48px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)",
                                            position: "relative"
                                        }}
                                    >
                                        {/* Close Button */}
                                        <button
                                            onClick={() => setSelectedIntegration(null)}
                                            style={{
                                                position: "absolute",
                                                top: 16,
                                                right: 16,
                                                width: 32,
                                                height: 32,
                                                borderRadius: 8,
                                                border: "none",
                                                backgroundColor: "transparent",
                                                color: colors.textSecondary,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                cursor: "pointer",
                                                transition: "all 0.2s",
                                                zIndex: 10
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = colors.buttonHover;
                                                e.currentTarget.style.color = colors.textPrimary;
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = "transparent";
                                                e.currentTarget.style.color = colors.textSecondary;
                                            }}
                                        >
                                            <XMarkIcon width={20} height={20} />
                                        </button>

                                        {/* Configuration Component */}
                                        <div style={{ padding: 24 }}>
                                            {selectedIntegration === 'telegram' && (
                                                <TelegramConfig
                                                    config={config.telegram}
                                                    onSave={async (telegramConfig, closeAfterSave = true) => {
                                                        const newConfig = {
                                                            ...config,
                                                            telegram: {
                                                                ...config.telegram,
                                                                ...telegramConfig,
                                                            }
                                                        };
                                                        setConfig(newConfig);
                                                        await (window as unknown as { electronAPI?: { integration?: { saveConfig?: (config: IntegrationConfig) => Promise<void> } } })?.electronAPI?.integration?.saveConfig?.(newConfig);
                                                        if (closeAfterSave) setSelectedIntegration(null);
                                                    }}
                                                    onTest={async () => {
                                                        return handleTestConnection('telegram');
                                                    }}
                                                    testing={testing.telegram || false}
                                                />
                                            )}

                                            {selectedIntegration === 'discord' && (
                                                <DiscordConfig
                                                    config={config.discord}
                                                    onSave={async (discordConfig, closeAfterSave = true) => {
                                                        const newConfig = {
                                                            ...config,
                                                            discord: {
                                                                ...config.discord,
                                                                ...discordConfig
                                                            }
                                                        };
                                                        setConfig(newConfig);
                                                        await (window as unknown as { electronAPI?: { integration?: { saveConfig?: (config: IntegrationConfig) => Promise<void> } } })?.electronAPI?.integration?.saveConfig?.(newConfig);
                                                        if (closeAfterSave) setSelectedIntegration(null);
                                                    }}
                                                    onTest={async () => {
                                                        return handleTestConnection('discord');
                                                    }}
                                                    testing={testing.discord || false}
                                                />
                                            )}
                                        </div>
                                    </motion.div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
}
