'use client';
import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, CheckCircleIcon } from '@heroicons/react/24/outline';

interface Question {
    question: string;
    options: string[];
    multiSelect?: boolean;
}

interface UserQuestionsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    questions: Question[];
    onSubmit: (answers: Record<string, string[]>) => void;
}

export default function UserQuestionsPanel({ isOpen, onClose, questions, onSubmit }: UserQuestionsPanelProps) {
    const [answers, setAnswers] = React.useState<Record<string, string[]>>({});
    const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(0);

    const currentQuestion = questions[currentQuestionIndex];
    const progress = ((currentQuestionIndex + 1) / questions.length) * 100;

    const handleOptionClick = (option: string) => {
        const q = currentQuestion.question;
        setAnswers(prev => {
            if (currentQuestion.multiSelect) {
                const existing = prev[q] || [];
                if (existing.includes(option)) {
                    return { ...prev, [q]: existing.filter(o => o !== option) };
                }
                return { ...prev, [q]: [...existing, option] };
            }
            return { ...prev, [q]: [option] };
        });
    };

    const handleNext = () => {
        if (currentQuestionIndex < questions.length - 1) {
            setCurrentQuestionIndex(prev => prev + 1);
        }
    };

    const handleBack = () => {
        if (currentQuestionIndex > 0) {
            setCurrentQuestionIndex(prev => prev - 1);
        }
    };

    const handleSubmit = () => {
        onSubmit(answers);
        onClose();
    };

    const isCurrentAnswered = currentQuestion && answers[currentQuestion.question]?.length > 0;
    const allAnswered = questions.every(q => answers[q.question]?.length > 0);

    if (!isOpen) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 100,
                }}
                onClick={onClose}
            >
                <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={e => e.stopPropagation()}
                    style={{
                        backgroundColor: 'var(--color-bg-surface)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 20,
                        padding: 28,
                        maxWidth: 520,
                        width: '90%',
                        boxShadow: 'var(--shadow-xl)',
                    }}
                >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div>
                            <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text-primary)', fontFamily: 'var(--font-sans)' }}>
                                Select Options
                            </h2>
                            <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                                Question {currentQuestionIndex + 1} of {questions.length}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                background: 'var(--color-bg-subtle)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 10,
                                cursor: 'pointer',
                                padding: 8,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'var(--color-text-tertiary)',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; }}
                            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
                        >
                            <XMarkIcon style={{ width: 18, height: 18 }} />
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 4, backgroundColor: 'var(--color-border)', borderRadius: 2, marginBottom: 24 }}>
                        <motion.div
                            style={{
                                height: '100%',
                                backgroundColor: 'var(--color-success)',
                                borderRadius: 2,
                            }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 0.3 }}
                        />
                    </div>

                    {/* Question */}
                    {currentQuestion && (
                        <div>
                            <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 16, lineHeight: 1.5 }}>
                                {currentQuestion.question}
                            </p>

                            {/* Options */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {currentQuestion.options.map((option, idx) => {
                                    const isSelected = answers[currentQuestion.question]?.includes(option);
                                    return (
                                        <button
                                            key={idx}
                                            onClick={() => handleOptionClick(option)}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: 12,
                                                padding: '12px 16px',
                                                border: isSelected
                                                    ? '2px solid var(--color-success)'
                                                    : '2px solid var(--color-border)',
                                                borderRadius: 12,
                                                backgroundColor: isSelected
                                                    ? 'var(--color-success-dim)'
                                                    : 'var(--color-bg-subtle)',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s',
                                                textAlign: 'left',
                                            }}
                                            onMouseEnter={e => {
                                                if (!isSelected) {
                                                    e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)';
                                                    e.currentTarget.style.borderColor = 'var(--color-border-strong)';
                                                }
                                            }}
                                            onMouseLeave={e => {
                                                if (!isSelected) {
                                                    e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)';
                                                    e.currentTarget.style.borderColor = 'var(--color-border)';
                                                }
                                            }}
                                        >
                                            <div style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: currentQuestion.multiSelect ? 4 : '50%',
                                                border: isSelected ? 'none' : '2px solid var(--color-border-strong)',
                                                backgroundColor: isSelected ? 'var(--color-success)' : 'transparent',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                transition: 'all 0.15s',
                                            }}>
                                                {isSelected && (
                                                    <CheckCircleIcon style={{ width: 16, height: 16, color: 'white' }} />
                                                )}
                                            </div>
                                            <span style={{
                                                fontSize: 14,
                                                color: isSelected ? 'var(--color-success)' : 'var(--color-text-secondary)',
                                                fontWeight: isSelected ? 600 : 400,
                                                transition: 'all 0.15s',
                                            }}>
                                                {option}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Navigation */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 24, gap: 12 }}>
                        <button
                            onClick={handleBack}
                            disabled={currentQuestionIndex === 0}
                            style={{
                                padding: '10px 20px',
                                borderRadius: 10,
                                border: '1px solid var(--color-border)',
                                backgroundColor: currentQuestionIndex === 0 ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                color: currentQuestionIndex === 0 ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
                                cursor: currentQuestionIndex === 0 ? 'not-allowed' : 'pointer',
                                fontSize: 14,
                                fontWeight: 500,
                                opacity: currentQuestionIndex === 0 ? 0.6 : 1,
                                transition: 'all 0.15s',
                            }}
                        >
                            Back
                        </button>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {currentQuestionIndex < questions.length - 1 ? (
                                <button
                                    onClick={handleNext}
                                    disabled={!isCurrentAnswered}
                                    style={{
                                        padding: '10px 20px',
                                        borderRadius: 10,
                                        border: 'none',
                                        backgroundColor: isCurrentAnswered ? 'var(--color-success)' : 'var(--color-border-strong)',
                                        color: 'white',
                                        cursor: isCurrentAnswered ? 'pointer' : 'not-allowed',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        opacity: isCurrentAnswered ? 1 : 0.6,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    Next →
                                </button>
                            ) : (
                                <button
                                    onClick={handleSubmit}
                                    disabled={!allAnswered}
                                    style={{
                                        padding: '10px 24px',
                                        borderRadius: 10,
                                        border: 'none',
                                        backgroundColor: allAnswered ? 'var(--color-success)' : 'var(--color-border-strong)',
                                        color: 'white',
                                        cursor: allAnswered ? 'pointer' : 'not-allowed',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        opacity: allAnswered ? 1 : 0.6,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    Submit ✓
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
