"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface CustomTooltipProps {
    content: string;
    children: React.ReactNode;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({ content, children }) => {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div
            style={{ position: "relative", display: "inline-block" }}
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            <AnimatePresence>
                {isVisible && (
                    <motion.div
                        initial={{ opacity: 0, y: -5 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -5 }}
                        transition={{ duration: 0.15 }}
                        style={{
                            position: "absolute",
                            bottom: "calc(100% + 8px)",
                            left: "50%",
                            transform: "translateX(-50%)",
                            backgroundColor: 'var(--color-text-primary)',
                            color: 'var(--color-bg-surface)',
                            padding: "8px 12px",
                            borderRadius: 8,
                            fontSize: 12,
                            lineHeight: 1.4,
                            whiteSpace: "nowrap",
                            maxWidth: 300,
                            zIndex: 1000,
                            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                            pointerEvents: "none"
                        }}
                    >
                        {content}
                        {/* Arrow */}
                        <div
                            style={{
                                position: "absolute",
                                top: "100%",
                                left: "50%",
                                transform: "translateX(-50%)",
                                width: 0,
                                height: 0,
                                borderLeft: "6px solid transparent",
                                borderRight: "6px solid transparent",
                                borderTop: "6px solid #111111"
                            }}
                        />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default CustomTooltip;
