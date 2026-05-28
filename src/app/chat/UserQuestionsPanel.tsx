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
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
                        backgroundColor: 'white',
                        borderRadius: 16,
                        padding: 24,
                        maxWidth: 500,
                        width: '90%',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    }}
                >
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div>
                            <h2 style={{ fontSize: 20, fontWeight: 600, color: '#111827' }}>Select Options</h2>
                            <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                                Question {currentQuestionIndex + 1} of {questions.length}
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 8 }}
                        >
                            <XMarkIcon style={{ width: 20, height: 20, color: '#9ca3af' }} />
                        </button>
                    </div>

                    {/* Progress bar */}
                    <div style={{ height: 4, backgroundColor: '#e5e7eb', borderRadius: 2, marginBottom: 24 }}>
                        <motion.div
                            style={{
                                height: '100%',
                                backgroundColor: '#10b981',
                                borderRadius: 2,
                            }}
                            animate={{ width: `${progress}%` }}
                        />
                    </div>

                    {/* Question */}
                    {currentQuestion && (
                        <div>
                            <p style={{ fontSize: 16, fontWeight: 500, color: '#111827', marginBottom: 16 }}>
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
                                                border: isSelected ? '2px solid #10b981' : '2px solid #e5e7eb',
                                                borderRadius: 8,
                                                backgroundColor: isSelected ? '#ecfdf5' : 'white',
                                                cursor: 'pointer',
                                                transition: 'all 0.15s',
                                                textAlign: 'left',
                                            }}
                                        >
                                            <div style={{
                                                width: 20,
                                                height: 20,
                                                borderRadius: currentQuestion.multiSelect ? 4 : '50%',
                                                border: isSelected ? 'none' : '2px solid #d1d5db',
                                                backgroundColor: isSelected ? '#10b981' : 'transparent',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                            }}>
                                                {isSelected && (
                                                    <CheckCircleIcon style={{ width: 16, height: 16, color: 'white' }} />
                                                )}
                                            </div>
                                            <span style={{
                                                fontSize: 14,
                                                color: isSelected ? '#065f46' : '#374151',
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
                                borderRadius: 8,
                                border: '1px solid #d1d5db',
                                backgroundColor: currentQuestionIndex === 0 ? '#f3f4f6' : 'white',
                                color: currentQuestionIndex === 0 ? '#9ca3af' : '#374151',
                                cursor: currentQuestionIndex === 0 ? 'not-allowed' : 'pointer',
                                fontSize: 14,
                                fontWeight: 500,
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
                                        borderRadius: 8,
                                        border: 'none',
                                        backgroundColor: isCurrentAnswered ? '#10b981' : '#9ca3af',
                                        color: 'white',
                                        cursor: isCurrentAnswered ? 'pointer' : 'not-allowed',
                                        fontSize: 14,
                                        fontWeight: 500,
                                    }}
                                >
                                    Next
                                </button>
                            ) : (
                                <button
                                    onClick={handleSubmit}
                                    disabled={!allAnswered}
                                    style={{
                                        padding: '10px 24px',
                                        borderRadius: 8,
                                        border: 'none',
                                        backgroundColor: allAnswered ? '#10b981' : '#9ca3af',
                                        color: 'white',
                                        cursor: allAnswered ? 'pointer' : 'not-allowed',
                                        fontSize: 14,
                                        fontWeight: 500,
                                    }}
                                >
                                    Submit
                                </button>
                            )}
                        </div>
                    </div>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    );
}
