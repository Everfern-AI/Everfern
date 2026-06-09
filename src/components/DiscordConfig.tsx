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

    // Server and user ID filtering state (comma-separated text inputs)
    const [guildIdsText, setGuildIdsText] = useState<string>('');
    const [userIdsText, setUserIdsText] = useState<string>('');

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

    // Validate Discord bot token format
    const validateBotToken = (token: string): ValidationResult => {
        if (!token.trim()) {
            return { isValid: false, message: "Bot token is required" };
        }

        // Discord bot token format: Base64 encoded string, typically 59+ characters
        // Example: MTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ.ZnCjm1XVW7vRze4b7Cq4se7kKWs
        const discordTokenRegex = /^[A-Za-z0-9+/=.]{59,}$/;

        if (!discordTokenRegex.test(token.trim())) {
            return {
                isValid: false,
                message: "Invalid token format. Discord bot tokens are typically 59+ characters long."
            };
        }

        return { isValid: true };
    };

    // Validate Discord application ID format
    const validateApplicationId = (appId: string): ValidationResult => {
        if (!appId.trim()) {
            return { isValid: false, message: "Application ID is required" };
        }

        // Discord application ID format: 17-19 digit snowflake ID
        const discordAppIdRegex = /^\d{17,19}$/;

        if (!discordAppIdRegex.test(appId.trim())) {
            return {
                isValid: false,
                message: "Invalid Application ID format. Should be a 17-19 digit number."
            };
        }

        return { isValid: true };
    };



    // Handle input changes with validation
    const handleInputChange = (field: keyof DiscordConfigData, value: string | string[]) => {
        const newFormData = { ...formData, [field]: value };
        setFormData(newFormData);

        // Validate the changed field
        let fieldValidation: ValidationResult;
        if (field === 'botToken') {
            fieldValidation = validateBotToken(value as string);
        } else if (field === 'applicationId') {
            fieldValidation = validateApplicationId(value as string);
        } else {
            fieldValidation = { isValid: true };
        }

        setValidation(prev => ({
            ...prev,
            [field]: fieldValidation
        }));

        // Check if there are changes
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
    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate all fields
        const botTokenValidation = validateBotToken(formData.botToken);
        const applicationIdValidation = validateApplicationId(formData.applicationId);

        setValidation({
            botToken: botTokenValidation,
            applicationId: applicationIdValidation
        });

        // Check if all validations pass
        if (!botTokenValidation.isValid || !applicationIdValidation.isValid) {
            return;
        }

        // Parse comma-separated IDs into arrays
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
            await onSave(configToSave, true);
            setSaveStatus('saved');
            setHasChanges(false);

            // Reset to idle after 2 seconds
            setTimeout(() => setSaveStatus('idle'), 2000);
        } catch (error) {
            console.error('Failed to save Discord configuration:', error);
            setSaveStatus('error');
            setTimeout(() => setSaveStatus('idle'), 3000);
        }
    };

    // Handle test connection
    const handleTest = async () => {
        // Validate required fields before testing
        const botTokenValidation = validateBotToken(formData.botToken);
        const applicationIdValidation = validateApplicationId(formData.applicationId);

        if (!botTokenValidation.isValid || !applicationIdValidation.isValid) {
            setValidation(prev => ({
                ...prev,
                botToken: botTokenValidation,
                applicationId: applicationIdValidation
            }));
            return;
        }

        setTestResult(null); // Clear previous result

        try {
            const allowedGuilds = guildIdsText
                .split(',')
                .map(id => id.trim())
                .filter(id => id.length > 0);
            const allowedUsers = userIdsText
                .split(',')
                .map(id => id.trim())
                .filter(id => id.length > 0);

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
                    ? "Discord connection successful! Bot is responding correctly."
                    : "Failed to connect to Discord. Please check your bot token and application ID."
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
                       validation.applicationId.isValid &&
                       formData.provider.trim() !== '' &&
                       formData.model.trim() !== '';
    const canSave = isFormValid && hasChanges && formData.botToken.trim() && formData.applicationId.trim();
    const canTest = isFormValid && formData.botToken.trim() && formData.applicationId.trim() && !testing;

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
                        src="/images/integrations/discord.svg"
                        alt="Discord logo"
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
                        Discord Bot Configuration
                    </h3>
                    <p style={{
                        fontSize: 13,
                        color: colors.textSecondary,
                        margin: "2px 0 0 0"
                    }}>
                        Configure your Discord bot integration settings
                    </p>
                </div>
            </div>

            {/* Form */}
            <form onSubmit={handleSave} style={{ padding: 24 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Important: Discord Intents Warning */}
                    <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            padding: "14px 16px",
                            borderRadius: 8,
                            backgroundColor: colors.warningBg,
                            border: `1px solid ${colors.textWarning}`,
                            display: "flex",
                            gap: 12
                        }}
                    >
                        <ExclamationTriangleIcon
                            width={20}
                            height={20}
                            style={{ color: colors.textWarning, flexShrink: 0, marginTop: 2 }}
                        />
                        <div style={{ flex: 1 }}>
                            <h4 style={{
                                fontSize: 14,
                                fontWeight: 600,
                                color: colors.textPrimary,
                                margin: "0 0 6px 0"
                            }}>
                                Required: Enable Privileged Gateway Intents
                            </h4>
                            <p style={{
                                fontSize: 13,
                                color: colors.textSecondary,
                                margin: "0 0 8px 0",
                                lineHeight: 1.5
                            }}>
                                Your Discord bot requires the following privileged intents to function properly:
                            </p>
                            <ul style={{
                                fontSize: 13,
                                color: colors.textSecondary,
                                margin: "0 0 8px 0",
                                paddingLeft: 20,
                                lineHeight: 1.6
                            }}>
                                <li><strong>Message Content Intent</strong> - Required to read message content</li>
                                <li><strong>Server Members Intent</strong> - Required to access member information</li>
                            </ul>
                            <p style={{
                                fontSize: 13,
                                color: colors.textSecondary,
                                margin: 0,
                                lineHeight: 1.5
                            }}>
                                <strong>How to enable:</strong> Go to{" "}
                                <a
                                    href="https://discord.com/developers/applications"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        color: colors.textWarning,
                                        textDecoration: "underline",
                                        fontWeight: 500
                                    }}
                                >
                                    Discord Developer Portal
                                </a>
                                {" "}→ Your Application → Bot → Privileged Gateway Intents → Enable both "Message Content Intent" and "Server Members Intent"
                            </p>
                        </div>
                    </motion.div>

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
                            <CustomTooltip content="Get your bot token from Discord Developer Portal under Bot settings">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <input
                            type="password"
                            placeholder="MTk4NjIyNDgzNDcxOTI1MjQ4.Cl2FMQ.ZnCjm1XVW7vRze4b7Cq4se7kKWs"
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
                            Get your bot token from the Discord Developer Portal under Bot settings.
                        </p>
                    </div>

                    {/* Application ID Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            Application ID *
                            <CustomTooltip content="Found in Discord Developer Portal under General Information. This is your bot's unique ID.">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <input
                            type="text"
                            placeholder="123456789012345678"
                            value={formData.applicationId}
                            onChange={(e) => handleInputChange('applicationId', e.target.value)}
                            required
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                border: `1px solid ${
                                    validation.applicationId.isValid ? colors.border : colors.borderError
                                }`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 14,
                                outline: "none",
                                transition: "border-color 0.2s",
                                fontFamily: "monospace"
                            }}
                            onFocus={(e) => {
                                if (validation.applicationId.isValid) {
                                    e.target.style.borderColor = colors.borderFocus;
                                }
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = validation.applicationId.isValid
                                    ? colors.border
                                    : colors.borderError;
                            }}
                        />
                        {!validation.applicationId.isValid && (
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
                                {validation.applicationId.message}
                            </motion.div>
                        )}
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Found in Discord Developer Portal under General Information. This is your bot's unique ID.
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
                            <CustomTooltip content="Select the AI provider for your Discord bot. Only configured providers with API keys are available.">
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
                            Choose which AI provider your Discord bot should use to generate responses.
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
                            <CustomTooltip content="Select the specific AI model for your Discord bot. Available models depend on the selected provider.">
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
                            Choose which AI model your Discord bot should use to generate responses.
                        </p>
                    </div>

                    {/* Server ID Filtering Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            Allowed Server IDs (Optional)
                            <CustomTooltip content="Comma-separated list of Discord server IDs. If specified, the bot will only respond in these servers. Leave empty to allow all servers.">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <input
                            type="text"
                            placeholder="123456789012345678, 987654321098765432"
                            value={guildIdsText}
                            onChange={(e) => {
                                setGuildIdsText(e.target.value);
                                setHasChanges(true);
                            }}
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 14,
                                outline: "none",
                                transition: "border-color 0.2s",
                                fontFamily: "monospace"
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = colors.borderFocus;
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = colors.border;
                            }}
                        />
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Enter server IDs separated by commas. Right-click a server → Copy Server ID (requires Developer Mode enabled).
                        </p>
                    </div>

                    {/* User ID Filtering Field */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <label style={{
                            fontSize: 14,
                            fontWeight: 500,
                            color: colors.textPrimary,
                            display: "flex",
                            alignItems: "center",
                            gap: 6
                        }}>
                            Allowed User IDs (Optional)
                            <CustomTooltip content="Comma-separated list of Discord user IDs. If specified, the bot will only respond to these users. Leave empty to allow all users.">
                                <InformationCircleIcon
                                    width={16}
                                    height={16}
                                    style={{ color: colors.textMuted, cursor: "help" }}
                                />
                            </CustomTooltip>
                        </label>
                        <input
                            type="text"
                            placeholder="123456789012345678, 987654321098765432"
                            value={userIdsText}
                            onChange={(e) => {
                                setUserIdsText(e.target.value);
                                setHasChanges(true);
                            }}
                            style={{
                                padding: "12px 16px",
                                borderRadius: 8,
                                border: `1px solid ${colors.border}`,
                                backgroundColor: colors.inputBg,
                                color: colors.textPrimary,
                                fontSize: 14,
                                outline: "none",
                                transition: "border-color 0.2s",
                                fontFamily: "monospace"
                            }}
                            onFocus={(e) => {
                                e.target.style.borderColor = colors.borderFocus;
                            }}
                            onBlur={(e) => {
                                e.target.style.borderColor = colors.border;
                            }}
                        />
                        <p style={{
                            fontSize: 12,
                            color: colors.textMuted,
                            margin: 0,
                            lineHeight: 1.4
                        }}>
                            Enter user IDs separated by commas. Right-click a user → Copy User ID (requires Developer Mode enabled).
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

export default DiscordConfig;
