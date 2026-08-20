"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ExclamationTriangleIcon,
    CheckCircleIcon,
    XCircleIcon,
    InformationCircleIcon,
    ArrowTopRightOnSquareIcon,
    ClipboardDocumentIcon,
    CheckIcon,
    ShieldCheckIcon,
    SparklesIcon
} from "@heroicons/react/24/outline";
import ProviderDropdown from "../common/ProviderDropdown";
import CustomTooltip from "../common/CustomTooltip";

interface TelegramConfigProps {
    config: {
        enabled: boolean;
        botToken: string;
        connected: boolean;
        provider?: string;
        model?: string;
        requireApproval?: boolean;
        approvalCode?: string;
        approvedUsers?: string[];
        botUsername?: string;
    };
    onSave: (config: TelegramConfigData, closeAfterSave?: boolean) => Promise<void>;
    onTest: () => Promise<boolean>;
    testing: boolean;
}

interface TelegramConfigData {
    botToken: string;
    provider: string;
    model: string;
    requireApproval: boolean;
    approvalCode: string;
    approvedUsers: string[];
    botUsername?: string;
}

interface ValidationResult {
    isValid: boolean;
    message?: string;
}

const TelegramConfig: React.FC<TelegramConfigProps> = ({
    config,
    onSave,
    onTest,
    testing
}) => {
    const [formData, setFormData] = useState<TelegramConfigData>({
        botToken: config.botToken || '',
        provider: config.provider || '',
        model: config.model || '',
        requireApproval: config.requireApproval !== false,
        approvalCode: config.approvalCode || '',
        approvedUsers: config.approvedUsers || [],
        botUsername: config.botUsername || ''
    });

    const [validation, setValidation] = useState<{
        botToken: ValidationResult;
    }>({
        botToken: { isValid: true }
    });

    const [hasChanges, setHasChanges] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [copiedCode, setCopiedCode] = useState(false);

    // Provider and model state
    const [providers, setProviders] = useState<Array<{ type: string; name: string; image?: string; enabled?: boolean }>>([]);
    const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

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
        telegramBlue: "#229ED9",
        inputBg: 'var(--color-bg-surface)',
        buttonBg: 'var(--color-bg-surface)',
        buttonHover: 'var(--color-bg-hover)',
        primaryButton: 'var(--color-text-primary)',
        primaryButtonText: 'var(--color-bg-surface)',
        primaryButtonHover: "var(--color-bg-subtle)",
        successBg: "var(--color-success-dim, rgba(34, 197, 94, 0.1))",
        errorBg: "var(--color-error-dim, rgba(239, 68, 68, 0.1))",
        warningBg: "rgba(245, 158, 11, 0.1)",
        infoBg: "rgba(34, 158, 217, 0.08)"
    };

    // Validate Telegram bot token format
    const validateBotToken = (token: string): ValidationResult => {
        if (!token.trim()) {
            return { isValid: false, message: "Bot token is required" };
        }

        // Telegram bot token format: {bot_id}:{bot_token}
        const telegramTokenRegex = /^\d{8,12}:[A-Za-z0-9_-]{30,}$/;

        if (!telegramTokenRegex.test(token.trim())) {
            return {
                isValid: false,
                message: "Invalid format. Expected: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
            };
        }

        return { isValid: true };
    };

    // Handle input changes
    const handleInputChange = (field: keyof TelegramConfigData, value: string | boolean | string[]) => {
        const newFormData = { ...formData, [field]: value };
        setFormData(newFormData);

        let fieldValidation: ValidationResult;
        if (field === 'botToken') {
            fieldValidation = validateBotToken(String(value));
            setValidation(prev => ({ ...prev, botToken: fieldValidation }));
        }

        const hasFormChanges = newFormData.botToken !== config.botToken ||
                              newFormData.provider !== (config.provider || '') ||
                              newFormData.model !== (config.model || '') ||
                              newFormData.requireApproval !== (config.requireApproval !== false) ||
                              newFormData.approvalCode !== (config.approvalCode || '') ||
                              JSON.stringify(newFormData.approvedUsers) !== JSON.stringify(config.approvedUsers || []);
        setHasChanges(hasFormChanges);

        if (saveStatus === 'saved') {
            setSaveStatus('idle');
        }
    };

    // Handle form submission
    const handleSave = async (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const botTokenValidation = validateBotToken(formData.botToken);
        setValidation({ botToken: botTokenValidation });

        if (!botTokenValidation.isValid) return;

        setSaveStatus('saving');
        try {
            await onSave(formData, false);
            setSaveStatus('saved');
            setHasChanges(false);
            setTimeout(() => setSaveStatus('idle'), 2500);
        } catch (error) {
            console.error('Failed to save Telegram configuration:', error);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3500);
        }
    };

    const generateApprovalCode = async () => {
        const code = `fern-${Math.random().toString(36).slice(2, 6)}-${Math.random().toString(36).slice(2, 6)}`;
        const nextFormData = { ...formData, approvalCode: code, requireApproval: true };
        setFormData(nextFormData);
        setHasChanges(true);

        setSaveStatus('saving');
        try {
            await onSave(nextFormData, false);
            setSaveStatus('saved');
            setHasChanges(false);
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (error) {
            console.error('Failed to save Telegram approval code:', error);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    const copyPairingCommand = () => {
        const cmd = `fern approve ${formData.approvalCode || ''}`;
        navigator.clipboard.writeText(cmd);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
    };

    const handleTest = async () => {
        const botTokenValidation = validateBotToken(formData.botToken);
        if (!botTokenValidation.isValid) {
            setValidation(prev => ({ ...prev, botToken: botTokenValidation }));
            return;
        }

        setTestResult(null);

        try {
            await onSave(formData, false);
            setHasChanges(false);
            const result = await onTest();
            setTestResult({
                success: result,
                message: result
                    ? "Telegram bot connected successfully! It is active and ready to receive messages."
                    : "Could not connect to Telegram. Please verify your Bot Token with @BotFather."
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

    useEffect(() => {
        setFormData({
            botToken: config.botToken || '',
            provider: config.provider || '',
            model: config.model || '',
            requireApproval: config.requireApproval !== false,
            approvalCode: config.approvalCode || '',
            approvedUsers: config.approvedUsers || [],
            botUsername: config.botUsername || ''
        });
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

    const canTest = validation.botToken.isValid && formData.botToken.trim().length > 0 && !testing;
    const canSave = validation.botToken.isValid && formData.botToken.trim().length > 0 && hasChanges;

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
                        backgroundColor: 'rgba(34, 158, 217, 0.12)',
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src="/images/integrations/telegram.svg"
                            alt="Telegram logo"
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
                            Telegram Bot Integration
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
                            Chat with EverFern directly from your Telegram app
                        </p>
                    </div>
                </div>

                {/* Direct Link to Bot */}
                {config.botUsername && (
                    <a
                        href={`https://t.me/${config.botUsername}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 12px",
                            borderRadius: 8,
                            backgroundColor: "rgba(34, 158, 217, 0.1)",
                            color: colors.telegramBlue,
                            fontSize: 12,
                            fontWeight: 500,
                            textDecoration: "none",
                            border: `1px solid rgba(34, 158, 217, 0.3)`
                        }}
                    >
                        <span>@{config.botUsername}</span>
                        <ArrowTopRightOnSquareIcon width={14} height={14} />
                    </a>
                )}
            </div>

            {/* Form & Guides */}
            <form onSubmit={handleSave} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
                {/* 1. Quick Setup Guide Banner */}
                <div style={{
                    padding: "14px 16px",
                    borderRadius: 10,
                    backgroundColor: colors.infoBg,
                    border: `1px solid rgba(34, 158, 217, 0.25)`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <SparklesIcon width={18} height={18} style={{ color: colors.telegramBlue }} />
                            <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                                How to get your Telegram Bot Token
                            </span>
                        </div>
                        <a
                            href="https://t.me/BotFather"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 12,
                                color: colors.telegramBlue,
                                fontWeight: 500,
                                textDecoration: "none"
                            }}
                        >
                            Open @BotFather
                            <ArrowTopRightOnSquareIcon width={13} height={13} />
                        </a>
                    </div>
                    <ol style={{
                        margin: 0,
                        paddingLeft: 18,
                        fontSize: 12,
                        color: colors.textSecondary,
                        lineHeight: 1.6
                    }}>
                        <li>Open <strong>@BotFather</strong> on Telegram and send <code>/newbot</code></li>
                        <li>Follow the prompt to choose a display name and a unique username ending in <code>bot</code></li>
                        <li>Copy the HTTP API token given by BotFather and paste it in the field below</li>
                    </ol>
                </div>

                {/* 2. Bot Token Field */}
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
                        <CustomTooltip content="The API token issued by @BotFather on Telegram">
                            <InformationCircleIcon width={15} height={15} style={{ color: colors.textMuted, cursor: "help" }} />
                        </CustomTooltip>
                    </label>
                    <input
                        type="password"
                        placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
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
                            fontFamily: "monospace",
                            transition: "border-color 0.2s"
                        }}
                    />
                    {!validation.botToken.isValid && (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.textError }}>
                            <XCircleIcon width={15} height={15} />
                            {validation.botToken.message}
                        </div>
                    )}
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

                {/* 4. Security & Approval Gate */}
                <div style={{
                    padding: "16px",
                    borderRadius: 10,
                    backgroundColor: colors.cardBg,
                    border: `1px solid ${colors.border}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 12
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <ShieldCheckIcon width={18} height={18} style={{ color: colors.textPrimary }} />
                            <div>
                                <span style={{ fontSize: 13, fontWeight: 600, color: colors.textPrimary }}>
                                    Require User Pairing Code
                                </span>
                                <p style={{ fontSize: 12, color: colors.textSecondary, margin: "2px 0 0 0" }}>
                                    Prevents unauthorized Telegram users from sending queries to your bot
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => handleInputChange('requireApproval', !formData.requireApproval)}
                            style={{
                                padding: "6px 12px",
                                borderRadius: 6,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: formData.requireApproval ? colors.primaryButton : "transparent",
                                color: formData.requireApproval ? colors.primaryButtonText : colors.textPrimary,
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: "pointer"
                            }}
                        >
                            {formData.requireApproval ? "Enforced" : "Disabled"}
                        </button>
                    </div>

                    {formData.requireApproval && (
                        <div style={{
                            padding: "12px",
                            borderRadius: 8,
                            backgroundColor: colors.inputBg,
                            border: `1px solid ${colors.border}`,
                            display: "flex",
                            flexDirection: "column",
                            gap: 8
                        }}>
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <span style={{ fontSize: 12, color: colors.textSecondary }}>
                                    Active Pairing Command (send from Telegram to unlock):
                                </span>
                                <button
                                    type="button"
                                    onClick={generateApprovalCode}
                                    style={{
                                        fontSize: 11,
                                        color: colors.telegramBlue,
                                        background: "none",
                                        border: "none",
                                        cursor: "pointer",
                                        padding: 0,
                                        fontWeight: 500
                                    }}
                                >
                                    Rotate Code
                                </button>
                            </div>

                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <code style={{
                                    flex: 1,
                                    padding: "8px 12px",
                                    borderRadius: 6,
                                    backgroundColor: colors.cardBg,
                                    fontSize: 12,
                                    fontFamily: "monospace",
                                    color: colors.textPrimary,
                                    border: `1px solid ${colors.border}`
                                }}>
                                    {formData.approvalCode ? `fern approve ${formData.approvalCode}` : "Click Rotate Code to generate"}
                                </code>
                                {formData.approvalCode && (
                                    <button
                                        type="button"
                                        onClick={copyPairingCommand}
                                        style={{
                                            padding: "8px 12px",
                                            borderRadius: 6,
                                            border: `1px solid ${colors.border}`,
                                            backgroundColor: colors.buttonBg,
                                            color: colors.textPrimary,
                                            fontSize: 12,
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 4,
                                            cursor: "pointer"
                                        }}
                                    >
                                        {copiedCode ? <CheckIcon width={14} height={14} /> : <ClipboardDocumentIcon width={14} height={14} />}
                                        {copiedCode ? "Copied" : "Copy"}
                                    </button>
                                )}
                            </div>

                            <span style={{ fontSize: 11, color: colors.textMuted }}>
                                Approved Telegram Accounts: {formData.approvedUsers?.length || 0}
                            </span>
                        </div>
                    )}
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

export default TelegramConfig;
