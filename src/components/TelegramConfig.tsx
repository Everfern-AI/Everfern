"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    ExclamationTriangleIcon,
    CheckCircleIcon,
    XCircleIcon,
    InformationCircleIcon
} from "@heroicons/react/24/outline";
import ProviderDropdown from "./ProviderDropdown";
import CustomTooltip from "./CustomTooltip";

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
        approvedUsers: config.approvedUsers || []
    });

    const [validation, setValidation] = useState<{
        botToken: ValidationResult;
    }>({
        botToken: { isValid: true }
    });

    const [hasChanges, setHasChanges] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    // Provider and model state
    const [providers, setProviders] = useState<Array<{ type: string; name: string; image?: string; enabled?: boolean }>>([]);
    const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

    const colors = {
        background: "#ffffff",
        border: "#e5e5e0",
        borderFocus: "#cccccc",
        borderError: "#ef4444",
        borderSuccess: "#10b981",
        textPrimary: "#111111",
        textSecondary: "#666666",
        textMuted: "#999999",
        textError: "#ef4444",
        textSuccess: "#10b981",
        textWarning: "#f59e0b",
        inputBg: "#ffffff",
        buttonBg: "#ffffff",
        buttonHover: "#f0f0f0",
        primaryButton: "#111111",
        primaryButtonText: "#ffffff",
        primaryButtonHover: "#333333",
        successBg: "#f0fdf4",
        errorBg: "#fef2f2",
        warningBg: "#fffbeb",
        infoBg: "#f0f9ff"
    };

    // Validate Telegram bot token format
    const validateBotToken = (token: string): ValidationResult => {
        if (!token.trim()) {
            return { isValid: false, message: "Bot token is required" };
        }

        // Telegram bot token format: {bot_id}:{bot_token}
        // Example: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
        const telegramTokenRegex = /^\d{8,10}:[A-Za-z0-9_-]{33,}$/;

        if (!telegramTokenRegex.test(token.trim())) {
            return {
                isValid: false,
                message: "Invalid token format. Expected format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
            };
        }

        return { isValid: true };
    };

    // Handle input changes with validation
    const handleInputChange = (field: keyof TelegramConfigData, value: string | boolean | string[]) => {
        const newFormData = { ...formData, [field]: value };
        setFormData(newFormData);

        // Validate the changed field
        let fieldValidation: ValidationResult;
        if (field === 'botToken') {
            fieldValidation = validateBotToken(String(value));
        } else {
            fieldValidation = { isValid: true };
        }

        if (field === 'botToken') {
            setValidation(prev => ({
                ...prev,
                [field]: fieldValidation
            }));
        }

        // Check if there are changes
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
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate all fields
        const botTokenValidation = validateBotToken(formData.botToken);

        setValidation({
            botToken: botTokenValidation
        });

        // Check if all validations pass
        if (!botTokenValidation.isValid) {
            return;
        }

        setSaveStatus('saving');
        try {
            await onSave(formData, false);
            setSaveStatus('saved');
            setHasChanges(false);

            // Reset to idle after 2 seconds
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (error) {
            console.error('Failed to save Telegram configuration:', error);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
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

    // Handle test connection
    const handleTest = async () => {
        // Validate bot token before testing
        const botTokenValidation = validateBotToken(formData.botToken);
        if (!botTokenValidation.isValid) {
            setValidation(prev => ({ ...prev, botToken: botTokenValidation }));
            return;
        }

        setTestResult(null); // Clear previous result

        try {
            await onSave(formData, true);
            setHasChanges(false);
            const result = await onTest();
            setTestResult({
                success: result,
                message: result
                    ? "Telegram connection successful! Bot is responding correctly."
                    : "Failed to connect to Telegram. Please check your bot token."
            });

            // Clear test result after 5 seconds
            setTimeout(() => {
                setTestResult(null);
            }, 5000);
        } catch (error) {
            setTestResult({
                success: false,
                message: `Connection test failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });

            // Clear test result after 5 seconds
            setTimeout(() => {
                setTestResult(null);
            }, 5000);
        }
    };

    // Update form data when config changes
    useEffect(() => {
        setFormData({
            botToken: config.botToken || '',
            provider: config.provider || '',
            model: config.model || '',
            requireApproval: config.requireApproval !== false,
            approvalCode: config.approvalCode || '',
            approvedUsers: config.approvedUsers || []
        });
        setHasChanges(false);
    }, [config]);

    // Load providers on mount
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

    // Load models when provider changes
    useEffect(() => {
        const loadModels = async () => {
            if (formData.provider) {
                try {
                    const modelList = await window.electronAPI.providers.getModels(formData.provider);
                    setModels(modelList.map(m => ({ id: m.id, name: m.name })));

                    // Keep a valid model selected when the provider changes.
                    if (modelList.length > 0 && (!formData.model || !modelList.some(m => m.id === formData.model))) {
                        setFormData(prev => ({ ...prev, model: modelList[0].id }));
                        setHasChanges(true);
                    }
                } catch (error) {
                    console.error('Failed to load models:', error);
                    setModels([]);
                }
            } else {
                setModels([]);
                // Clear model selection when provider is cleared
                if (formData.model) {
                    setFormData(prev => ({ ...prev, model: '' }));
                    setHasChanges(true);
                }
            }
        };
        loadModels();
    }, [formData.provider]);

    const isFormValid = validation.botToken.isValid &&
                       formData.provider.trim() !== '' &&
                       formData.model.trim() !== '';
    const canSave = isFormValid && hasChanges && formData.botToken.trim();
    const canTest = isFormValid && formData.botToken.trim() && !testing;

    return (
        <div style={{
            backgroundColor: colors.background,
            borderRadius: 12,
            border: `1px solid ${colors.border}`,
            overflow: 'hidden'
        }}>
            {/* Header */}
            <div style={{
                padding: "20px 24px",
                borderBottom: `1px solid ${colors.border}`,
                display: "flex",
                alignItems: "center",
                gap: 12
            }}>
                <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    backgroundColor: "#f5f5f5",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                        src="/images/integrations/telegram.svg"
                        alt="Telegram logo"
                        style={{ width: 20, height: 20, objectFit: "contain" }}
                    />
                </div>
                <div>
                    <h3 style={{
                        fontSize: 16,
                        fontWeight: 600,
                        color: colors.textPrimary,
                        margin: 0
                    }}>
                        Telegram Bot Configuration
                    </h3>
                    <p style={{
                        fontSize: 13,
                        color: colors.textSecondary,
                        margin: "2px 0 0 0"
                    }}>
                        Configure your Telegram bot integration settings
                    </p>
                </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} style={{ padding: 24 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Bot Token Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            Bot Token *
                            <CustomTooltip content="Get your bot token from @BotFather on Telegram. Format: bot_id:bot_token">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <input
                            type="password"
                            placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz"
                            value={formData.botToken}
                            onChange={(e) => handleInputChange('botToken', e.target.value)}
                            required
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                border: `1px solid ${
                                    validation.botToken.isValid ? colors.border : colors.borderError
                                }`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 14,
                                outline: "none",
                                transition: "border-color 0.2s",
                                fontFamily: "monospace"
                            }}
                            onFocus={(e) => {
                                if (validation.botToken.isValid) {
                                    e.target.style.borderColor = colors.borderFocus;
                                }
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = validation.botToken.isValid
                                    ? colors.border
                                    : colors.borderError;
                            }}
                        />
                        {!validation.botToken.isValid && (
                            <motion.div
                                initial={{ opacity: 0, y: -5 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: 13,
                                    color: colors.textError
                                }}
                            >
                                <XCircleIcon width={16} height={16} />
                                {validation.botToken.message}
                            </motion.div>
                        )}
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Get your bot token from @BotFather on Telegram. Format: bot_id:bot_token
                        </p>
                    </div>

                    {/* Provider Selection Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            AI Provider *
                            <CustomTooltip content="Select the AI provider for your Telegram bot. Only configured providers with API keys are available.">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <ProviderDropdown
                            providers={providers}
                            selectedProvider={formData.provider}
                            onSelect={(providerType) => handleInputChange('provider', providerType)}
                            placeholder="Select a provider..."
                            colors={colors}
                        />
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Choose which AI provider your Telegram bot should use to generate responses.
                        </p>
                    </div>

                    {/* Model Selection Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            AI Model *
                            <CustomTooltip content="Select the specific AI model for your Telegram bot. Available models depend on the selected provider.">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <select
                            value={formData.model}
                            onChange={(e) => handleInputChange('model', e.target.value)}
                            disabled={!formData.provider || models.length === 0}
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 14,
                                outline: "none",
                                transition: "border-color 0.2s",
                                cursor: formData.provider && models.length > 0 ? "pointer" : "not-allowed",
                                opacity: formData.provider && models.length > 0 ? 1 : 0.6
                            }}
                            onFocus={(e) => {
                                if (formData.provider && models.length > 0) {
                                    e.target.style.borderColor = colors.borderFocus;
                                }
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = colors.border;
                            }}
                        >
                            <option value="">
                                {!formData.provider
                                    ? "Select a provider first..."
                                    : models.length === 0
                                    ? "Loading models..."
                                    : "Select a model..."}
                            </option>
                            {models.map((model) => (
                                <option key={model.id} value={model.id}>
                                    {model.name}
                                </option>
                            ))}
                        </select>
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Choose which AI model your Telegram bot should use to generate responses.
                        </p>
                    </div>

                    {/* Approval Settings */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            User Approval
                            <CustomTooltip content="Require Telegram users to approve themselves before chatting. The code is generated here and must be sent from Telegram as: fern approve &lt;code&gt;">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <button
                                type="button"
                                onClick={() => setFormData(prev => ({ ...prev, requireApproval: !prev.requireApproval }))}
                                style={{
                                    padding: "10px 14px",
                                    borderRadius: 8,
                                    border: `1px solid ${colors.border}`,
                                    backgroundColor: formData.requireApproval ? colors.primaryButton : colors.buttonBg,
                                    color: formData.requireApproval ? colors.primaryButtonText : colors.textPrimary,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    cursor: "pointer"
                                }}
                            >
                                {formData.requireApproval ? "Approval required" : "Approval off"}
                            </button>
                            <button
                                type="button"
                                onClick={generateApprovalCode}
                                style={{
                                    padding: "10px 14px",
                                    borderRadius: 8,
                                    border: `1px solid ${colors.border}`,
                                    backgroundColor: colors.buttonBg,
                                    color: colors.textPrimary,
                                    fontSize: 13,
                                    fontWeight: 500,
                                    cursor: "pointer"
                                }}
                            >
                                Generate / Rotate Code
                            </button>
                        </div>
                        <input
                            type="text"
                            readOnly
                            value={formData.approvalCode}
                            placeholder="Generate an approval code"
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: "#fafafa",
                                color: colors.textPrimary,
                                fontSize: 14,
                                outline: "none",
                                fontFamily: "monospace"
                            }}
                        />
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Approved users: {formData.approvedUsers.length}
                        </p>
                    </div>

                    {/* Validation Message for Provider and Model */}
                    {!isFormValid && hasChanges && (formData.provider.trim() === '' || formData.model.trim() === '') && (
                        <motion.div
                            initial={{ opacity: 0, y: -5 }}
                            animate={{ opacity: 1, y: 0 }}
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                backgroundColor: colors.warningBg,
                                border: `1px solid ${colors.textWarning}`,
                                display: "flex",
                                alignItems: "center",
                                gap: 10
                            }}
                        >
                            <ExclamationTriangleIcon
                                width={18}
                                height={18}
                                style={{ color: colors.textWarning, flexShrink: 0 }}
                            />
                            <span style={{
                                fontSize: 13,
                                color: colors.textPrimary,
                                lineHeight: 1.4
                            }}>
                                Please select both an AI provider and model to enable bot responses.
                            </span>
                        </motion.div>
                    )}

                    {/* Action Buttons */}
                    <div style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: 8,
                        paddingTop: 16,
                        borderTop: `1px solid ${colors.border}`
                    }}>
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={!canTest}
                            style={{
                                padding: "10px 20px",
                                borderRadius: 8,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: "transparent",
                                color: canTest ? colors.textPrimary : colors.textMuted,
                                fontSize: 14,
                                fontWeight: 500,
                                cursor: canTest ? "pointer" : "not-allowed",
                                opacity: canTest ? 1 : 0.5,
                                transition: "all 0.2s",
                                display: "flex",
                                alignItems: "center",
                                gap: 8
                            }}
                            onMouseEnter={(e) => {
                                if (canTest) {
                                    e.currentTarget.style.backgroundColor = colors.buttonHover;
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "transparent";
                            }}
                        >
                            {testing && (
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                >
                                    <div
                                        style={{
                                            width: 14,
                                            height: 14,
                                            border: `2px solid ${colors.textMuted}`,
                                            borderTop: `2px solid ${colors.textPrimary}`,
                                            borderRadius: "50%",
                                        }}
                                    />
                                </motion.div>
                            )}
                            {testing ? "Testing..." : "Test Connection"}
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                            {/* Save Status Indicator */}
                            {saveStatus === 'saved' && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 13,
                                        color: colors.textSuccess
                                    }}
                                >
                                    <CheckCircleIcon width={16} height={16} />
                                    Saved
                                </motion.div>
                            )}

                            {saveStatus === 'error' && (
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.8 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 6,
                                        fontSize: 13,
                                        color: colors.textError
                                    }}
                                >
                                    <XCircleIcon width={16} height={16} />
                                    Save failed
                                </motion.div>
                            )}

                            <button
                                type="submit"
                                disabled={!canSave || saveStatus === 'saving'}
                                style={{
                                    padding: "10px 20px",
                                    borderRadius: 8,
                                    border: "none",
                                    backgroundColor: canSave ? colors.primaryButton : colors.border,
                                    color: canSave ? colors.primaryButtonText : colors.textMuted,
                                    fontSize: 14,
                                    fontWeight: 500,
                                    cursor: canSave ? "pointer" : "not-allowed",
                                    transition: "all 0.2s",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8
                                }}
                                onMouseEnter={(e) => {
                                    if (canSave) {
                                        e.currentTarget.style.backgroundColor = colors.primaryButtonHover;
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (canSave) {
                                        e.currentTarget.style.backgroundColor = colors.primaryButton;
                                    }
                                }}
                            >
                                {saveStatus === 'saving' ? "Saving..." : "Save Configuration"}
                            </button>
                        </div>
                    </div>

                    {/* Test Result Message */}
                    {testResult && (
                        <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            style={{
                                marginTop: 16,
                                padding: "12px 16px",
                                borderRadius: 8,
                                backgroundColor: testResult.success ? colors.successBg : colors.errorBg,
                                border: `1px solid ${testResult.success ? colors.textSuccess : colors.textError}`,
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
                                fontSize: 14,
                                color: testResult.success ? colors.textSuccess : colors.textError,
                                fontWeight: 500,
                                lineHeight: 1.4
                            }}>
                                {testResult.message}
                            </span>
                        </motion.div>
                    )}
                </div>
            </form>
        </div>
    );
};

export default TelegramConfig;
