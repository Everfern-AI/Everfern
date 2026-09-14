"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ExclamationTriangleIcon,
    CheckCircleIcon,
    XCircleIcon,
    InformationCircleIcon,
    ArrowTopRightOnSquareIcon,
    SparklesIcon,
    ServerStackIcon,
    UserGroupIcon,
    ShieldCheckIcon
} from "@heroicons/react/24/outline";
import ProviderDropdown from "../common/ProviderDropdown";
import CustomTooltip from "../common/CustomTooltip";

interface DiscordConfigProps {
    config: {
        enabled: boolean;
        botToken: string;
        applicationId: string;
        connected: boolean;
        provider?: string;
        model?: string;
        allowedGuilds?: string[];
        allowedUsers?: string[];
    };
    onSave: (config: DiscordConfigData, closeAfterSave?: boolean) => Promise<void>;
    onTest: () => Promise<boolean>;
    testing: boolean;
}

interface DiscordConfigData {
    botToken: string;
    applicationId: string;
    provider: string;
    model: string;
    allowedGuilds: string[];
    allowedUsers: string[];
}

interface ValidationResult {
    isValid: boolean;
    message?: string;
}

const DiscordConfig: React.FC<DiscordConfigProps> = ({
    config,
    onSave,
    onTest,
    testing
}) => {
    const [formData, setFormData] = useState<DiscordConfigData>({
        botToken: config.botToken || '',
        applicationId: config.applicationId || '',
        provider: config.provider || '',
        model: config.model || '',
        allowedGuilds: config.allowedGuilds || [],
        allowedUsers: config.allowedUsers || []
    });

    const [validation, setValidation] = useState<{
        botToken: ValidationResult;
        applicationId: ValidationResult;
    }>({
        botToken: { isValid: true },
        applicationId: { isValid: true }
    });

    const [hasChanges, setHasChanges] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Provider and model state
    const [providers, setProviders] = useState<Array<{ type: string; name: string; image?: string; enabled?: boolean }>>([]);
    const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

    // Comma-separated ID inputs
    const [guildIdsText, setGuildIdsText] = useState<string>('');
    const [userIdsText, setUserIdsText] = useState<string>('');

    const colors = {
        background: 'var(--color-bg-surface)',
        cardBg: 'var(--color-bg-subtle)',
        border: 'var(--color-border)',
        borderFocus: "var(--color-border-strong)",
        borderError: 'var(--color-error)',
        borderSuccess: 'var(--color-success)',
        textPrimary: 'var(--color-text-primary)',
        textSecondary: 'var(--color-text-secondary)',
        textMuted: 'var(--color-text-tertiary)',
        textError: 'var(--color-error)',
        textSuccess: 'var(--color-success)',
        textWarning: "#f59e0b",
        discordBlurple: "#5865F2",
        inputBg: 'var(--color-bg-surface)',
        buttonBg: 'var(--color-bg-surface)',
        buttonHover: 'var(--color-bg-hover)',
        primaryButton: 'var(--color-text-primary)',
        primaryButtonText: 'var(--color-bg-surface)',
        primaryButtonHover: "var(--color-bg-subtle)",
        successBg: "var(--color-success-dim, rgba(34, 197, 94, 0.1))",
        errorBg: "var(--color-error-dim, rgba(239, 68, 68, 0.1))",
        warningBg: "rgba(245, 158, 11, 0.1)",
        infoBg: "rgba(88, 101, 242, 0.08)"
    };

    // Validate Discord bot token
    const validateBotToken = (token: string): ValidationResult => {
        if (!token.trim()) {
            return { isValid: false, message: "Bot token is required" };
        }
        if (token.trim().length < 50) {
            return {
                isValid: false,
                message: "Discord bot tokens are usually 59+ characters long."
            };
        }
        return { isValid: true };
    };

    // Validate Discord application ID
    const validateApplicationId = (appId: string): ValidationResult => {
        if (!appId.trim()) {
            return { isValid: false, message: "Application ID is required" };
        }
        const discordAppIdRegex = /^\d{17,20}$/;
        if (!discordAppIdRegex.test(appId.trim())) {
            return {
                isValid: false,
                message: "Application ID should be a 17-20 digit number."
            };
        }
        return { isValid: true };
    };

    // Handle input changes
    const handleInputChange = (field: keyof DiscordConfigData, value: string | string[]) => {
        const newFormData = { ...formData, [field]: value };
        setFormData(newFormData);

        let fieldValidation: ValidationResult = { isValid: true };
        if (field === 'botToken') {
            fieldValidation = validateBotToken(value as string);
            setValidation(prev => ({ ...prev, botToken: fieldValidation }));
        } else if (field === 'applicationId') {
            fieldValidation = validateApplicationId(value as string);
            setValidation(prev => ({ ...prev, applicationId: fieldValidation }));
        }

        const hasFormChanges = newFormData.botToken !== config.botToken ||
                              newFormData.applicationId !== config.applicationId ||
                              newFormData.provider !== (config.provider || '') ||
                              newFormData.model !== (config.model || '');
        setHasChanges(hasFormChanges);

        if (saveStatus === 'saved') {
            setSaveStatus('idle');
        }
    };

    // Handle form submission
    const handleSave = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const botTokenValidation = validateBotToken(formData.botToken);
        const applicationIdValidation = validateApplicationId(formData.applicationId);

        setValidation({
            botToken: botTokenValidation,
            applicationId: applicationIdValidation
        });

        if (!botTokenValidation.isValid || !applicationIdValidation.isValid) {
            return;
        }

        const allowedGuilds = guildIdsText
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0);

        const allowedUsers = userIdsText
            .split(',')
            .map(id => id.trim())
            .filter(id => id.length > 0);

        setSaveStatus('saving');
        try {
            const configToSave = {
                ...formData,
                allowedGuilds,
                allowedUsers
            };
            await onSave(configToSave, false);
            setSaveStatus('saved');
            setHasChanges(false);
            setTimeout(() => setSaveStatus('idle'), 2500);
        } catch (error) {
            console.error('Failed to save Discord configuration:', error);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3500);
        }
    };

    // Handle test connection
    const handleTest = async () => {
        const botTokenValidation = validateBotToken(formData.botToken);
        const applicationIdValidation = validateApplicationId(formData.applicationId);

        if (!botTokenValidation.isValid || !applicationIdValidation.isValid) {
            setValidation({
                botToken: botTokenValidation,
                applicationId: applicationIdValidation
            });
            return;
        }

        setTestResult(null);

        try {
            const allowedGuilds = guildIdsText.split(',').map(id => id.trim()).filter(id => id.length > 0);
            const allowedUsers = userIdsText.split(',').map(id => id.trim()).filter(id => id.length > 0);

            const configToSave = {
                ...formData,
                allowedGuilds,
                allowedUsers
            };
            await onSave(configToSave, false);
            setHasChanges(false);
            const result = await onTest();
            setTestResult({
                success: result,
                message: result
                    ? "Discord connection verified! Bot is authenticated and responsive."
                    : "Failed to connect to Discord. Verify Application ID, Bot Token, and Gateway Intents."
            });

            setTimeout(() => setTestResult(null), 6000);
        } catch (error) {
            setTestResult({
                success: false,
                message: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
            setTimeout(() => setTestResult(null), 6000);
        }
    };

    // OAuth2 Bot Invite Link Generator
    const botInviteUrl = formData.applicationId.trim().length >= 17
        ? `https://discord.com/api/oauth2/authorize?client_id=${formData.applicationId.trim()}&permissions=274878220352&scope=bot%20applications.commands`
        : null;

    useEffect(() => {
        setFormData({
            botToken: config.botToken || '',
            applicationId: config.applicationId || '',
            provider: config.provider || '',
            model: config.model || '',
            allowedGuilds: config.allowedGuilds || [],
            allowedUsers: config.allowedUsers || []
        });
        setGuildIdsText((config.allowedGuilds || []).join(', '));
        setUserIdsText((config.allowedUsers || []).join(', '));
        setHasChanges(false);
    }, [config]);

    useEffect(() => {
        const loadProviders = async () => {
            try {
                const providerList = await window.electronAPI.providers.getAll();
                setProviders(providerList.map(p => ({
                    type: p.type,
                    name: p.name,
                    image: p.image,
                    enabled: p.enabled
                })));
            } catch (error) {
                console.error('Failed to load providers:', error);
            }
        };
        loadProviders();
    }, []);

    useEffect(() => {
        const loadModels = async () => {
            if (formData.provider) {
                try {
                    const modelList = await window.electronAPI.providers.getModels(formData.provider);
                    setModels(modelList.map(m => ({ id: m.id, name: m.name })));
                } catch (error) {
                    console.error('Failed to load models:', error);
                    setModels([]);
                }
            } else {
                setModels([]);
            }
        };
        loadModels();
    }, [formData.provider]);

    const canTest = validation.botToken.isValid &&
                   validation.applicationId.isValid &&
                   formData.botToken.trim().length > 0 &&
                   formData.applicationId.trim().length > 0 &&
                   !testing;

    const canSave = validation.botToken.isValid &&
                   validation.applicationId.isValid &&
                   formData.botToken.trim().length > 0 &&
                   formData.applicationId.trim().length > 0 &&
                   hasChanges;

    return (
        <div style={{
            backgroundColor: colors.background,
            borderRadius: 14,
            border: `1px solid ${colors.border}`,
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{
                padding: "20px 24px",
                borderBottom: `1px solid ${colors.border}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: 'var(--color-bg-surface)'
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{
                        width: 38,
                        height: 38,
                        borderRadius: 10,
                        backgroundColor: 'rgba(88, 101, 242, 0.12)',
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/images/integrations/discord.svg"
                            alt="Discord logo"
                            style={{ width: 22, height: 22, objectFit: "contain" }}
                        />
                    </div>
                    <div>
                        <h3 style={{
                            fontSize: 16,
                            fontWeight: 600,
                            color: colors.textPrimary,
                            margin: 0,
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                        }}>
                            Discord Bot Integration
                            {config.connected && (
                                <span style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    padding: "2px 8px",
                                    borderRadius: 12,
                                    backgroundColor: colors.successBg,
                                    color: colors.textSuccess,
                                    border: `1px solid ${colors.borderSuccess}`
                                }}>
                                    Online
                                </span>
                            )}
                        </h3>
                        <p style={{
                            fontSize: 13,
                            color: colors.textSecondary,
                            margin: "2px 0 0 0"
                        }}>
                            Chat with EverFern across Discord servers and direct messages
                        </p>
                    </div>
                </div>

                {/* 1-Click Invite Link Button */}
                {botInviteUrl && (
                    <a
                        href={botInviteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 12px",
                            borderRadius: 8,
                            backgroundColor: "rgba(88, 101, 242, 0.12)",
                            color: colors.discordBlurple,
                            fontSize: 12,
                            fontWeight: 500,
                            textDecoration: "none",
                            border: `1px solid rgba(88, 101, 242, 0.3)`
                        }}
                    >
                        <span>Add Bot to Server</span>
                        <ArrowTopRightOnSquareIcon width={14} height={14} />
                    </a>
                )}
            </div>

            {/* Form & Setup */}
            <form onSubmit={handleSave} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
                {/* 1. Quick Setup & Intents Banner */}
                <div style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    backgroundColor: colors.infoBg,
                    border: `1px solid rgba(88, 101, 242, 0.25)`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <SparklesIcon width={18} height={18} style={{ color: colors.discordBlurple }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                                Discord Bot Setup & Privileged Gateway Intents
                            </span>
                        </div>
                        <a
                            href="https://discord.com/developers/applications"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                color: colors.discordBlurple,
                                fontWeight: 500,
                                textDecoration: "none"
                            }}
                        >
                            Developer Portal
                            <ArrowTopRightOnSquareIcon width={13} height={13} />
                        </a>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: colors.textSecondary, lineHeight: 1.5 }}>
                        In the Discord Developer Portal under <strong>Bot → Privileged Gateway Intents</strong>, make sure to enable:
                    </p>
                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: colors.textPrimary }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircleIcon width={16} height={16} style={{ color: colors.discordBlurple }} />
                            <span><strong>Message Content Intent</strong> (Read chat prompts)</span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <CheckCircleIcon width={16} height={16} style={{ color: colors.discordBlurple }} />
                            <span><strong>Server Members Intent</strong> (Guild member info)</span>
                        </div>
                    </div>
                </div>

                {/* 2. Credentials Grid */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            Application ID *
                            <CustomTooltip content="Found in General Information under your Application in the Discord Developer Portal">
                                <InformationCircleIcon width={15} height={15} style={{ color: colors.textMuted, cursor: "help" }} />
                            </CustomTooltip>
                        </label>
                        <input
                            type="text"
                            placeholder="123456789012345678"
                            value={formData.applicationId}
                            onChange={(e) => handleInputChange('applicationId', e.target.value)}
                            required
                            style={{
                                padding: "11px 14px",
                                borderRadius: 8,
                                border: `1px solid ${validation.applicationId.isValid ? colors.border : colors.borderError}`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 13,
                                outline: "none",
                                fontFamily: "monospace"
                            }}
                        />
                        {!validation.applicationId.isValid && (
                            <span style={{ fontSize: 12, color: colors.textError }}>
                                {validation.applicationId.message}
                            </span>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 13,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            Bot Token *
                            <CustomTooltip content="Found under Bot settings in the Discord Developer Portal">
                                <InformationCircleIcon width={15} height={15} style={{ color: colors.textMuted, cursor: "help" }} />
                            </CustomTooltip>
                        </label>
                        <input
                            type="password"
                            placeholder="MTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ..."
                            value={formData.botToken}
                            onChange={(e) => handleInputChange('botToken', e.target.value)}
                            required
                            style={{
                                padding: "11px 14px",
                                borderRadius: 8,
                                border: `1px solid ${validation.botToken.isValid ? colors.border : colors.borderError}`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 13,
                                outline: "none",
                                fontFamily: "monospace"
                            }}
                        />
                        {!validation.botToken.isValid && (
                            <span style={{ fontSize: 12, color: colors.textError }}>
                                {validation.botToken.message}
                            </span>
                        )}
                    </div>
                </div>

                {/* 3. AI Model & Provider Options (Smart Defaults) */}
                <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 14,
                    padding: "16px",
                    borderRadius: 10,
                    backgroundColor: colors.cardBg,
                    border: `1px solid ${colors.border}`
                }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: colors.textPrimary }}>
                            AI Provider (Optional)
                        </label>
                        <ProviderDropdown
                            providers={providers}
                            selectedProvider={formData.provider}
                            onSelect={(providerType: string) => handleInputChange('provider', providerType)}
                            placeholder="Default (Desktop App Provider)"
                            colors={colors}
                        />
                        <span style={{ fontSize: 11, color: colors.textMuted }}>
                            Leave empty to inherit desktop app AI provider
                        </span>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <label style={{ fontSize: 12, fontWeight: 500, color: colors.textPrimary }}>
                            AI Model (Optional)
                        </label>
                        <select
                            value={formData.model}
                            onChange={(e) => handleInputChange('model', e.target.value)}
                            style={{
                                padding: "10px 12px",
                                borderRadius: 8,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 13,
                                outline: "none",
                                cursor: "pointer"
                            }}
                        >
                            <option value="">Default (Desktop App Model)</option>
                            {models.map((m) => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                        <span style={{ fontSize: 11, color: colors.textMuted }}>
                            Leave empty to inherit default desktop AI model
                        </span>
                    </div>
                </div>

                {/* 4. Access Control Whitelist Filters */}
                <div style={{
                    padding: "16px",
                    borderRadius: 10,
                    backgroundColor: colors.cardBg,
                    border: `1px solid ${colors.border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <ShieldCheckIcon width={18} height={18} style={{ color: colors.textPrimary }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                            Access Whitelist Filters (Optional)
                        </span>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <label style={{
                                fontSize: 12,
                                fontWeight: 500,
                                color: colors.textPrimary,
                                display: "flex",
                                alignItems: "center",
                                gap: 6
                            }}>
                                <ServerStackIcon width={14} height={14} /> Allowed Server IDs
                            </label>
                            <input
                                type="text"
                                placeholder="123456789, 987654321 (empty = all)"
                                value={guildIdsText}
                                onChange={(e) => {
                                    setGuildIdsText(e.target.value);
                                    setHasChanges(true);
                                }}
                                style={{
                                    padding: "9px 12px",
                                    borderRadius: 8,
                                    border: `1px solid ${colors.border}`,
                                    backgroundColor: colors.inputBg,
                                    color: colors.textPrimary,
                                    fontSize: 12,
                                    outline: "none",
                                    fontFamily: "monospace"
                                }}
                            />
                            <span style={{ fontSize: 11, color: colors.textMuted }}>
                                Comma-separated server (guild) IDs
                            </span>
                        </div>

                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <label style={{
                                fontSize: 12,
                                fontWeight: 500,
                                color: colors.textPrimary,
                                display: "flex",
                                alignItems: "center",
                                gap: 6
                            }}>
                                <UserGroupIcon width={14} height={14} /> Allowed User IDs
                            </label>
                            <input
                                type="text"
                                placeholder="123456789, 987654321 (empty = all)"
                                value={userIdsText}
                                onChange={(e) => {
                                    setUserIdsText(e.target.value);
                                    setHasChanges(true);
                                }}
                                style={{
                                    padding: "9px 12px",
                                    borderRadius: 8,
                                    border: `1px solid ${colors.border}`,
                                    backgroundColor: colors.inputBg,
                                    color: colors.textPrimary,
                                    fontSize: 12,
                                    outline: "none",
                                    fontFamily: "monospace"
                                }}
                            />
                            <span style={{ fontSize: 11, color: colors.textMuted }}>
                                Comma-separated Discord user IDs
                            </span>
                        </div>
                    </div>
                </div>

                {/* 5. Action Buttons & Test Status */}
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    paddingTop: 12,
                    borderTop: `1px solid ${colors.border}`
                }}>
                    <button
                        type="button"
                        onClick={handleTest}
                        disabled={!canTest}
                        style={{
                            padding: "9px 18px",
                            borderRadius: 8,
                            border: `1px solid ${colors.border}`,
                            backgroundColor: "transparent",
                            color: canTest ? colors.textPrimary : colors.textMuted,
                            fontSize: 13,
                            fontWeight: 500,
                            cursor: canTest ? "pointer" : "not-allowed",
                            opacity: canTest ? 1 : 0.5,
                            display: "flex",
                            alignItems: "center",
                            gap: 8
                        }}
                    >
                        {testing && (
                            <motion.div
                                animate={{ rotate: 360 }}
                                transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                            >
                                <div style={{
                                    width: 12,
                                    height: 12,
                                    border: `2px solid ${colors.textMuted}`,
                                    borderTop: `2px solid ${colors.textPrimary}`,
                                    borderRadius: "50%"
                                }} />
                            </motion.div>
                        )}
                        {testing ? "Testing..." : "Test Connection"}
                    </button>

                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        {saveStatus === 'saved' && (
                            <span style={{ fontSize: 12, color: colors.textSuccess, display: "flex", alignItems: "center", gap: 4 }}>
                                <CheckCircleIcon width={15} height={15} /> Saved
                            </span>
                        )}
                        {saveStatus === 'error' && (
                            <span style={{ fontSize: 12, color: colors.textError, display: "flex", alignItems: "center", gap: 4 }}>
                                <XCircleIcon width={15} height={15} /> Failed
                            </span>
                        )}
                        <button
                            type="submit"
                            disabled={!canSave || saveStatus === 'saving'}
                            style={{
                                padding: "9px 20px",
                                borderRadius: 8,
                                border: "none",
                                backgroundColor: canSave ? colors.primaryButton : colors.border,
                                color: canSave ? colors.primaryButtonText : colors.textMuted,
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: canSave ? "pointer" : "not-allowed"
                            }}
                        >
                            {saveStatus === 'saving' ? "Saving..." : "Save Settings"}
                        </button>
                    </div>
                </div>

                {/* Connection Test Result Feedback Banner */}
                <AnimatePresence>
                    {testResult && (
                        <motion.div
                            initial={{ opacity: 0, y: -8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                backgroundColor: testResult.success ? colors.successBg : colors.errorBg,
                                border: `1px solid ${testResult.success ? colors.borderSuccess : colors.borderError}`,
                                display: "flex",
                                alignItems: "center",
                                gap: 10
                            }}
                        >
                            {testResult.success ? (
                                <CheckCircleIcon width={18} height={18} style={{ color: colors.textSuccess, flexShrink: 0 }} />
                            ) : (
                                <XCircleIcon width={18} height={18} style={{ color: colors.textError, flexShrink: 0 }} />
                            )}
                            <span style={{
                                fontSize: 13,
                                color: testResult.success ? colors.textSuccess : colors.textError,
                                fontWeight: 500
                            }}>
                                {testResult.message}
                            </span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </form>
        </div>
    );
};

export default DiscordConfig;
