import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    XMarkIcon,
    HandThumbUpIcon,
    HandThumbDownIcon,
    ChatBubbleBottomCenterTextIcon
} from '@heroicons/react/24/outline';

interface MessageFeedbackModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (feedbackType: 'up' | 'down', reason: string, customReason: string, dataToSend: 'current' | 'last_3' | 'all') => void;
    feedbackType: 'up' | 'down';
}

const FEEDBACK_OPTIONS_DOWN = [
    "Inaccurate information",
    "Formatting issue",
    "Refused to answer",
    "Not helpful",
    "Custom"
];

const FEEDBACK_OPTIONS_UP = [
    "Very helpful",
    "Accurate",
    "Fast response",
    "Custom"
];

export default function MessageFeedbackModal({ isOpen, onClose, onSubmit, feedbackType }: MessageFeedbackModalProps) {
    const [selectedReason, setSelectedReason] = useState<string>('');
    const [customReason, setCustomReason] = useState<string>('');
    const [dataToSend, setDataToSend] = useState<'current' | 'last_3' | 'all'>('current');

    const options = feedbackType === 'down' ? FEEDBACK_OPTIONS_DOWN : FEEDBACK_OPTIONS_UP;
    const isCustom = selectedReason === 'Custom';

    const handleSubmit = () => {
        if (!selectedReason) return;
        onSubmit(feedbackType, selectedReason, isCustom ? customReason : '', dataToSend);
        onClose();
        // Reset state
        setTimeout(() => {
            setSelectedReason('');
            setCustomReason('');
            setDataToSend('current');
        }, 300);
    };

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <div style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'var(--color-bg-overlay)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                padding: '20px'
            }}>
                <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 20 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 20 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    style={{
                        backgroundColor: 'var(--color-bg-surface)',
                        borderRadius: '24px',
                        border: '1px solid var(--color-border)',
                        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                        width: '100%',
                        maxWidth: '500px',
                        maxHeight: '90vh',
                        overflow: 'hidden',
                        display: 'flex',
                        flexDirection: 'column'
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '24px 32px',
                        borderBottom: '1px solid var(--color-border-subtle)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '40px',
                                height: '40px',
                                backgroundColor: feedbackType === 'up' ? 'var(--color-success-dim)' : 'var(--color-error-dim)',
                                borderRadius: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}>
                                {feedbackType === 'up' ? (
                                    <HandThumbUpIcon style={{ width: '20px', height: '20px', color: 'var(--color-success)' }} />
                                ) : (
                                    <HandThumbDownIcon style={{ width: '20px', height: '20px', color: 'var(--color-error)' }} />
                                )}
                            </div>
                            <div>
                                <h2 style={{
                                    fontSize: '20px',
                                    fontWeight: 600,
                                    color: 'var(--color-text-primary)',
                                    margin: 0,
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Provide Feedback
                                </h2>
                                <p style={{
                                    fontSize: '14px',
                                    color: 'var(--color-text-secondary)',
                                    margin: '4px 0 0',
                                    fontFamily: "'Figtree', system-ui, sans-serif"
                                }}>
                                    Help us improve by sharing what {feedbackType === 'up' ? 'went well' : 'went wrong'}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '8px',
                                backgroundColor: 'transparent',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                color: 'var(--color-text-tertiary)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                e.currentTarget.style.color = 'var(--color-text-secondary)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = 'var(--color-text-tertiary)';
                            }}
                        >
                            <XMarkIcon style={{ width: '20px', height: '20px' }} />
                        </button>
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '32px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            
                            {/* Reason Selection */}
                            <div>
                                <h3 style={{ fontSize: '15px', fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '12px' }}>
                                    What was {feedbackType === 'down' ? 'wrong' : 'good'} with this message?
                                </h3>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {options.map((option) => (
                                        <label key={option} style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                                            <input
                                                type="radio"
                                                name="feedback_reason"
                                                value={option}
                                                checked={selectedReason === option}
                                                onChange={() => setSelectedReason(option)}
                                                style={{ accentColor: 'var(--color-accent)' }}
                                            />
                                            <span style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>{option}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Custom Reason Input */}
                            <AnimatePresence>
                                {isCustom && (
                                    <motion.div
                                        initial={{ height: 0, opacity: 0 }}
                                        animate={{ height: 'auto', opacity: 1 }}
                                        exit={{ height: 0, opacity: 0 }}
                                        style={{ overflow: 'hidden' }}
                                    >
                                        <textarea
                                            placeholder="Please provide more details..."
                                            value={customReason}
                                            onChange={(e) => setCustomReason(e.target.value)}
                                            style={{
                                                width: '100%',
                                                minHeight: '80px',
                                                padding: '12px',
                                                backgroundColor: 'var(--color-bg-subtle)',
                                                border: '1px solid var(--color-border)',
                                                borderRadius: '8px',
                                                color: 'var(--color-text-primary)',
                                                fontSize: '14px',
                                                resize: 'vertical',
                                                fontFamily: 'inherit',
                                                outline: 'none',
                                                marginTop: '8px'
                                            }}
                                            onFocus={e => e.currentTarget.style.borderColor = 'var(--color-accent)'}
                                            onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Data to Send Selection */}
                            <div style={{
                                padding: '16px',
                                backgroundColor: 'var(--color-bg-subtle)',
                                borderRadius: '12px',
                                border: '1px solid var(--color-border-subtle)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                                    <ChatBubbleBottomCenterTextIcon style={{ width: '16px', height: '16px', color: 'var(--color-text-tertiary)' }} />
                                    <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                                        Context to include
                                    </h3>
                                </div>
                                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '16px', lineHeight: 1.4 }}>
                                    Select how much of the conversation history should be sent with this feedback.
                                </p>
                                <select
                                    value={dataToSend}
                                    onChange={(e) => setDataToSend(e.target.value as any)}
                                    style={{
                                        width: '100%',
                                        padding: '10px 12px',
                                        backgroundColor: 'var(--color-bg-surface)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '8px',
                                        color: 'var(--color-text-primary)',
                                        fontSize: '14px',
                                        outline: 'none',
                                        cursor: 'pointer'
                                    }}
                                >
                                    <option value="current">Only this message and prompt</option>
                                    <option value="last_3">Last 3 prompts</option>
                                    <option value="all">Entire chat history</option>
                                </select>
                            </div>

                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{
                        padding: '20px 32px',
                        borderTop: '1px solid var(--color-border-subtle)',
                        display: 'flex',
                        justifyContent: 'flex-end',
                        gap: '12px',
                        backgroundColor: 'var(--color-bg-subtle)'
                    }}>
                        <button
                            onClick={onClose}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: 'transparent',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                color: 'var(--color-text-secondary)',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: 'pointer'
                            }}
                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'}
                            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!selectedReason || (isCustom && !customReason.trim())}
                            style={{
                                padding: '10px 24px',
                                backgroundColor: 'var(--color-accent)',
                                border: 'none',
                                borderRadius: '8px',
                                color: '#fff',
                                fontSize: '14px',
                                fontWeight: 500,
                                cursor: (!selectedReason || (isCustom && !customReason.trim())) ? 'not-allowed' : 'pointer',
                                opacity: (!selectedReason || (isCustom && !customReason.trim())) ? 0.5 : 1
                            }}
                            onMouseEnter={e => {
                                if ((!selectedReason || (isCustom && !customReason.trim()))) return;
                                e.currentTarget.style.filter = 'brightness(1.1)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.filter = 'none';
                            }}
                        >
                            Submit Feedback
                        </button>
                    </div>
                </motion.div>
            </div>
        </AnimatePresence>
    );
}
