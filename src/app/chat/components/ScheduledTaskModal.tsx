'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { XMarkIcon, ClockIcon, ChevronDownIcon, CalendarDaysIcon, SparklesIcon } from '@heroicons/react/24/outline';

interface ScheduledTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (task: {
    name?: string;
    description: string;
    cron: string;
    prompt: string;
    startsAt?: string;
    endsAt?: string;
  }) => void;
  projectId?: string;
}

const REPEAT_OPTIONS = [
  { label: 'Every Day', value: 'daily' },
  { label: 'Every Monday', value: 'weekly:monday' },
  { label: 'Every Tuesday', value: 'weekly:tuesday' },
  { label: 'Every Wednesday', value: 'weekly:wednesday' },
  { label: 'Every Thursday', value: 'weekly:thursday' },
  { label: 'Every Friday', value: 'weekly:friday' },
  { label: 'Every Saturday', value: 'weekly:saturday' },
  { label: 'Every Sunday', value: 'weekly:sunday' },
  { label: 'Every Hour', value: 'every 1 hour' },
  { label: 'Every 30 Minutes', value: 'every 30 minutes' },
  { label: 'Every 5 Minutes', value: 'every 5 minutes' },
];

const s = {
  /* ── Overlay ── */
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    zIndex: 400,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '16px',
  },

  /* ── Modal shell ── */
  modal: {
    width: '100%',
    maxWidth: 580,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    boxShadow: '0 32px 64px rgba(0,0,0,0.14), 0 8px 24px rgba(0,0,0,0.08)',
    display: 'flex',
    flexDirection: 'column' as const,
    maxHeight: 'calc(100vh - 32px)',
    overflow: 'hidden',
  },

  /* ── Header ── */
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '20px 24px',
    borderBottom: '1px solid #f0f0f0',
    flexShrink: 0,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#111111',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerTitle: {
    margin: 0,
    fontSize: 16,
    fontWeight: 600,
    color: '#111111',
    letterSpacing: '-0.2px',
  },
  headerSubtitle: {
    margin: '2px 0 0',
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: 400,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: '1px solid transparent',
    color: '#9ca3af',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  },

  /* ── Scrollable body ── */
  body: {
    padding: '24px',
    overflowY: 'auto' as const,
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 18,
  },

  /* ── Two-col grid ── */
  grid2: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 14,
  },

  /* ── Field group ── */
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  label: {
    fontSize: 12,
    fontWeight: 600,
    color: '#374151',
    letterSpacing: '0.3px',
    textTransform: 'uppercase' as const,
  },
  required: {
    color: '#ef4444',
    marginLeft: 2,
  },
  hint: {
    fontSize: 11,
    color: '#9ca3af',
    marginLeft: 4,
    fontWeight: 400,
    textTransform: 'none' as const,
    letterSpacing: 0,
  },

  /* ── Inputs ── */
  input: {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 14,
    color: '#111111',
    backgroundColor: '#ffffff',
    outline: 'none',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  },
  inputMuted: {
    backgroundColor: '#fafafa',
  },
  textarea: {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 14,
    color: '#111111',
    backgroundColor: '#ffffff',
    outline: 'none',
    resize: 'none' as const,
    transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
    lineHeight: 1.6,
  },

  /* ── Custom dropdown ── */
  dropdownBtn: {
    width: '100%',
    padding: '10px 14px',
    border: '1.5px solid #e5e7eb',
    borderRadius: 10,
    fontSize: 14,
    color: '#111111',
    backgroundColor: '#ffffff',
    outline: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    transition: 'border-color 0.15s',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
    textAlign: 'left' as const,
  },
  dropdownBtnInner: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    color: '#6b7280',
  },
  dropdownList: {
    position: 'absolute' as const,
    top: 'calc(100% + 4px)',
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    border: '1.5px solid #e5e7eb',
    borderRadius: 12,
    zIndex: 50,
    boxShadow: '0 10px 25px rgba(0,0,0,0.1)',
    overflow: 'hidden',
    maxHeight: 220,
    overflowY: 'auto' as const,
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '14px 20px',
    fontSize: 14,
    textAlign: 'left' as const,
    border: 'none',
    backgroundColor: 'transparent',
    color: '#374151',
    cursor: 'pointer',
    transition: 'background 0.1s',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  },
  dropdownItemActive: {
    backgroundColor: '#f9fafb',
    fontWeight: 700,
    color: '#000000',
  },
  dropdownDivider: {
    height: '1px',
    backgroundColor: '#f3f4f6',
    margin: '4px 0',
  },

  /* ── Footer ── */
  footer: {
    padding: '16px 24px',
    borderTop: '1px solid #f0f0f0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    backgroundColor: '#fafafa',
  },
  footerBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    fontSize: 12,
    color: '#6b7280',
  },
  pulse: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    backgroundColor: '#22c55e',
    flexShrink: 0,
  },
  footerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  cancelBtn: {
    height: 36,
    padding: '0 18px',
    borderRadius: 10,
    border: '1.5px solid #e5e7eb',
    backgroundColor: '#ffffff',
    fontSize: 13,
    fontWeight: 600,
    color: '#374151',
    cursor: 'pointer',
    transition: 'background 0.15s, border-color 0.15s',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
  },
  submitBtn: {
    height: 36,
    padding: '0 18px',
    borderRadius: 10,
    border: '1.5px solid transparent',
    backgroundColor: '#111111',
    fontSize: 13,
    fontWeight: 600,
    color: '#ffffff',
    cursor: 'pointer',
    transition: 'background 0.15s, opacity 0.15s',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  submitBtnDisabled: {
    backgroundColor: '#d1d5db',
    cursor: 'not-allowed',
  },
};

export default function ScheduledTaskModal({ isOpen, onClose, onSave }: ScheduledTaskModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pattern, setPattern] = useState('daily');
  const [startTime, setStartTime] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return now.toISOString().slice(0, 16);
  });
  const [prompt, setPrompt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  /* Close dropdown on outside click */
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSubmit = async () => {
    if (!description.trim() || !prompt.trim()) return;
    setIsSaving(true);
    try {
      await onSave({
        name: name.trim() || undefined,
        description: description.trim(),
        cron: pattern,
        prompt: prompt.trim(),
        startsAt: startTime ? new Date(startTime).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      });
      setName(''); setDescription(''); setPattern('daily'); setPrompt(''); setEndsAt('');
      onClose();
    } catch (err) {
      console.error('Error saving task:', err);
    } finally {
      setIsSaving(false);
    }
  };

  const isDisabled = !description.trim() || !prompt.trim() || isSaving;
  const selectedOption = REPEAT_OPTIONS.find(opt => opt.value === pattern) || { label: 'Custom', value: pattern };

  /* Focus ring helpers */
  const focusOn = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#111111';
  };
  const focusOff = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = '#e5e7eb';
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div style={s.overlay}>
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          style={s.modal}
        >
          {/* ── Header ── */}
          <div style={s.header}>
            <div style={s.headerLeft}>
              <div style={s.headerIcon}>
                <ClockIcon width={18} height={18} color="#ffffff" />
              </div>
              <div>
                <h2 style={s.headerTitle}>Schedule Task</h2>
                <p style={s.headerSubtitle}>Automate recurring background work</p>
              </div>
            </div>
            <button
              onClick={onClose}
              style={s.closeBtn}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f3f4f6';
                (e.currentTarget as HTMLButtonElement).style.color = '#111111';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                (e.currentTarget as HTMLButtonElement).style.color = '#9ca3af';
                (e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent';
              }}
            >
              <XMarkIcon width={16} height={16} />
            </button>
          </div>

          {/* ── Body (scrollable) ── */}
          <div style={s.body}>

            {/* Row 1: Name & Description */}
            <div style={s.grid2}>
              <div style={s.fieldGroup}>
                <label style={s.label}>
                  Task Name
                  <span style={s.hint}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Morning Briefing"
                  style={s.input}
                  onFocus={focusOn}
                  onBlur={focusOff}
                />
              </div>
              <div style={s.fieldGroup}>
                <label style={s.label}>
                  Description<span style={s.required}>*</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="Briefly explain the goal"
                  style={s.input}
                  onFocus={focusOn}
                  onBlur={focusOff}
                />
              </div>
            </div>

            {/* Row 2: Repeat Pattern & Starts At */}
            <div style={s.grid2}>
              {/* Custom dropdown */}
              <div style={s.fieldGroup}>
                <label style={s.label}>Repeat Pattern</label>
                <div style={{ position: 'relative' }} ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setIsDropdownOpen(v => !v)}
                    style={{
                      ...s.dropdownBtn,
                      borderColor: isDropdownOpen ? '#111111' : '#e5e7eb',
                    }}
                  >
                    <span style={s.dropdownBtnInner}>
                      <CalendarDaysIcon width={15} height={15} />
                      <span style={{ color: '#111111' }}>{selectedOption.label}</span>
                    </span>
                    <ChevronDownIcon
                      width={14}
                      height={14}
                      style={{
                        color: '#9ca3af',
                        transition: 'transform 0.2s',
                        transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                        flexShrink: 0,
                      }}
                    />
                  </button>

                  <AnimatePresence>
                    {isDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={{ duration: 0.14 }}
                        style={s.dropdownList}
                      >
                        {REPEAT_OPTIONS.map((opt, i) => {
                          const isActive = pattern === opt.value;
                          /* Divider before "Every Hour" group */
                          const showDivider = i === 8;
                          return (
                            <React.Fragment key={opt.value}>
                              {showDivider && <div style={s.dropdownDivider} />}
                              <button
                                type="button"
                                onClick={() => { setPattern(opt.value); setIsDropdownOpen(false); }}
                                style={{
                                  ...s.dropdownItem,
                                  ...(isActive ? s.dropdownItemActive : {}),
                                }}
                                onMouseEnter={e => {
                                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f9fafb';
                                }}
                                onMouseLeave={e => {
                                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                                }}
                              >
                                {opt.label}
                              </button>
                            </React.Fragment>
                          );
                        })}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              {/* Starts At */}
              <div style={s.fieldGroup}>
                <label style={s.label}>Starts At / Run Time</label>
                <input
                  type="datetime-local"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                  style={s.input}
                  onFocus={focusOn}
                  onBlur={focusOff}
                />
              </div>
            </div>

            {/* AI Instructions */}
            <div style={s.fieldGroup}>
              <label style={s.label}>
                AI Instructions<span style={s.required}>*</span>
              </label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="What should the AI do when this triggers?"
                rows={4}
                style={s.textarea}
                onFocus={e => { e.currentTarget.style.borderColor = '#111111'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; }}
              />
            </div>

            {/* Expires At */}
            <div style={s.fieldGroup}>
              <label style={s.label}>
                Expires At
                <span style={s.hint}>(optional)</span>
              </label>
              <input
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                style={{ ...s.input, ...s.inputMuted }}
                onFocus={focusOn}
                onBlur={focusOff}
              />
            </div>

          </div>

          {/* ── Footer ── */}
          <div style={s.footer}>
            <div style={s.footerBadge}>
              <div style={s.pulse} />
              Runs automatically
            </div>

            <div style={s.footerActions}>
              <button
                type="button"
                onClick={onClose}
                style={s.cancelBtn}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f9fafb';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#d1d5db';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#ffffff';
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb';
                }}
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={isDisabled}
                style={{
                  ...s.submitBtn,
                  ...(isDisabled ? s.submitBtnDisabled : {}),
                }}
                onMouseEnter={e => {
                  if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a1a';
                }}
                onMouseLeave={e => {
                  if (!isDisabled) (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#111111';
                }}
              >
                <SparklesIcon width={14} height={14} />
                {isSaving ? 'Scheduling…' : 'Schedule Task'}
              </button>
            </div>
          </div>

        </motion.div>
      </div>
    </AnimatePresence>
  );
}
