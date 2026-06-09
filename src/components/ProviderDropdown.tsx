"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import Image from "next/image";

interface Provider {
    type: string;
    name: string;
    image?: string;
    enabled?: boolean;
}

interface ProviderDropdownProps {
    providers: Provider[];
    selectedProvider: string;
    onSelect: (providerType: string) => void;
    placeholder?: string;
    colors: {
        border: string;
        borderFocus: string;
        inputBg: string;
        textPrimary: string;
        textMuted: string;
        buttonHover: string;
    };
}

const ProviderDropdown: React.FC<ProviderDropdownProps> = ({
    providers,
    selectedProvider,
    onSelect,
    placeholder = "Select a provider...",
    colors
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    const selectedProviderData = providers.find(p => p.type === selectedProvider);

    return (
        <div ref={dropdownRef} style={{ position: "relative", width: "100%" }}>
            {/* Dropdown Button */}
            <div
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: "12px 16px",
                    borderRadius: 8,
                    border: `1px solid ${isOpen ? colors.borderFocus : colors.border}`,
                    backgroundColor: colors.inputBg,
                    color: colors.textPrimary,
                    fontSize: 14,
                    outline: "none",
                    transition: "border-color 0.2s",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                    {selectedProviderData ? (
                        <>
                            {selectedProviderData.image && (
                                <Image
                                    src={selectedProviderData.image}
                                    alt={selectedProviderData.name}
                                    width={20}
                                    height={20}
                                    style={{ objectFit: "contain" }}
                                    unoptimized
                                />
                            )}
                            <span>{selectedProviderData.name}</span>
                        </>
                    ) : (
                        <span style={{ color: colors.textMuted }}>{placeholder}</span>
                    )}
                </div>
                <ChevronDownIcon
                    width={16}
                    height={16}
                    style={{
                        color: colors.textMuted,
                        transition: "transform 0.2s",
                        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)"
                    }}
                />
            </div>

            {/* Dropdown Menu */}
            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            position: "absolute",
                            top: "calc(100% + 6px)",
                            left: 0,
                            right: 0,
                            backgroundColor: "#ffffff",
                            border: `1px solid ${colors.border}`,
                            borderRadius: 8,
                            boxShadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
                            zIndex: 1000,
                            maxHeight: 300,
                            overflowY: "auto"
                        }}
                    >
                        {providers.map((provider, index) => {
                            const isSelected = provider.type === selectedProvider;
                            const isDisabled = provider.enabled === false;

                            return (
                                <div
                                    key={provider.type}
                                    onClick={() => {
                                        if (!isDisabled) {
                                            onSelect(provider.type);
                                            setIsOpen(false);
                                        }
                                    }}
                                    style={{
                                        padding: "12px 16px",
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 12,
                                        cursor: isDisabled ? "not-allowed" : "pointer",
                                        backgroundColor: isSelected ? "#f4f4f4" : "#ffffff",
                                        borderBottom: index < providers.length - 1 ? `1px solid #f0f0f0` : "none",
                                        opacity: isDisabled ? 0.4 : 1,
                                        transition: "background-color 0.1s"
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!isDisabled) {
                                            e.currentTarget.style.backgroundColor = isSelected ? "#f4f4f4" : "#f9f9f9";
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = isSelected ? "#f4f4f4" : "#ffffff";
                                    }}
                                >
                                    {provider.image && (
                                        <Image
                                            src={provider.image}
                                            alt={provider.name}
                                            width={20}
                                            height={20}
                                            style={{ objectFit: "contain" }}
                                            unoptimized
                                        />
                                    )}
                                    <span
                                        style={{
                                            flex: 1,
                                            fontSize: 14,
                                            color: colors.textPrimary,
                                            fontWeight: isSelected ? 600 : 400
                                        }}
                                    >
                                        {provider.name}
                                    </span>
                                    {isSelected && (
                                        <CheckIcon
                                            width={16}
                                            height={16}
                                            style={{ color: colors.textPrimary }}
                                        />
                                    )}
                                    {isDisabled && (
                                        <span
                                            style={{
                                                fontSize: 11,
                                                color: colors.textMuted,
                                                fontWeight: 500,
                                                textTransform: "uppercase",
                                                letterSpacing: "0.05em"
                                            }}
                                        >
                                            Not configured
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default ProviderDropdown;
