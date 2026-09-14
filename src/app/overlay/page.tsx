"use client";

import { useEffect, useState, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

function renderMarkdown(text: string): string {
  if (!text) return '';

  // 1. Process Markdown Tables before inline replacements
  let html = text.replace(/((?:\|[^\n]+\|\n?)+)/g, (match) => {
    const lines = match.trim().split('\n').filter(line => line.trim().startsWith('|'));
    if (lines.length < 2) return match;

    // Check if line 1 (index 1) is a separator line (e.g. |---|---|)
    const isSeparator = /^\|?[\s:-]+(\|\s*[\s:-]+\s*)+\|?$/.test(lines[1].trim());
    const headerRowIndex = isSeparator ? 0 : -1;
    const bodyRowsStartIndex = isSeparator ? 2 : 0;

    let tableHtml = '<div style="overflow-x:auto;margin:10px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.12);background:rgba(0,0,0,0.25)"><table style="width:100%;border-collapse:collapse;font-size:12.5px;text-align:left;color:rgba(255,255,255,0.9);font-family:inherit">';

    if (headerRowIndex === 0) {
      const headers = lines[0].split('|').slice(1, -1).map(cell => cell.trim());
      tableHtml += '<thead style="background:rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.15)"><tr>';
      headers.forEach(h => {
        tableHtml += `<th style="padding:7px 12px;font-weight:600;color:#fff">${h}</th>`;
      });
      tableHtml += '</tr></thead>';
    }

    tableHtml += '<tbody>';
    for (let i = bodyRowsStartIndex; i < lines.length; i++) {
      const cells = lines[i].split('|').slice(1, -1).map(cell => cell.trim());
      const bg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)';
      tableHtml += `<tr style="background:${bg};border-bottom:1px solid rgba(255,255,255,0.05)">`;
      cells.forEach(c => {
        tableHtml += `<td style="padding:6px 12px">${c}</td>`;
      });
      tableHtml += '</tr>';
    }
    tableHtml += 'tbody></table></div>';
    return tableHtml;
  });

  html = html
    // Code blocks (```...```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;margin:8px 0;overflow-x:auto;font-size:12px;line-height:1.5;font-family:monospace;color:#e2e8f0"><code>$2</code></pre>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);border-radius:4px;padding:2px 6px;font-size:12px;font-family:monospace;color:#60a5fa">$1</code>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong style="color:#fff;font-weight:600">$1</strong>')
    // Strikethrough
    .replace(/~~(.+?)~~/g, '<del style="color:rgba(255,255,255,0.5)">$1</del>')
    // Italic
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#60a5fa;text-decoration:none;border-bottom:1px solid rgba(96,165,250,0.4)">$1</a>')
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote style="border-left:3px solid #60a5fa;margin:6px 0;padding-left:10px;color:rgba(255,255,255,0.8);font-style:italic">$1</blockquote>')
    // Task lists / Checkboxes
    .replace(/^[ \t]*\[ \] (.+)$/gm, '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:12px;height:12px;border:1px solid rgba(255,255,255,0.3);border-radius:3px;display:inline-block"></span><span>$1</span></div>')
    .replace(/^[ \t]*\[[xX]\] (.+)$/gm, '<div style="display:flex;align-items:center;gap:6px;margin:3px 0"><span style="width:12px;height:12px;background:#3b82f6;border-radius:3px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:9px">✓</span><span style="text-decoration:line-through;color:rgba(255,255,255,0.6)">$1</span></div>')
    // Headings
    .replace(/^### (.+)$/gm, '<div style="font-size:14px;font-weight:600;color:#fff;margin:10px 0 4px;letter-spacing:-0.01em">$1</div>')
    .replace(/^## (.+)$/gm, '<div style="font-size:15px;font-weight:600;color:#fff;margin:12px 0 6px;letter-spacing:-0.01em">$1</div>')
    .replace(/^# (.+)$/gm, '<div style="font-size:16px;font-weight:700;color:#fff;margin:14px 0 6px;letter-spacing:-0.01em">$1</div>')
    // Unordered list items
    .replace(/^[ \t]*[-*] (.+)$/gm, '<div style="padding-left:14px;position:relative;margin:3px 0"><span style="position:absolute;left:2px;color:#60a5fa">•</span>$1</div>')
    // Ordered list items
    .replace(/^(\d+)\. (.+)$/gm, '<div style="padding-left:18px;position:relative;margin:3px 0"><span style="position:absolute;left:0;color:rgba(255,255,255,0.6);font-weight:500">$1.</span>$2</div>')
    // Horizontal rules
    .replace(/^---+$/gm, '<div style="border-top:1px solid rgba(255,255,255,0.12);margin:10px 0"></div>')
    // Paragraphs / Line breaks
    .replace(/\n\n/g, '<div style="margin:8px 0"></div>')
    .replace(/\n/g, '<br/>');

  return html;
}

interface ClarificationOption {
  label: string;
  value: string;
}

interface OverlayPayload {
  state: 'idle' | 'listening' | 'executing' | 'completed' | 'clarification' | 'error' | 'history';
  action?: string;
  response?: string;
  question?: string;
  options?: ClarificationOption[];
  formType?: 'select' | 'input' | 'confirm' | 'single';
  voiceInputText?: string;
  followUps?: Array<{ icon: string; text: string }>;
  message?: string;
}

function playBubbleSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;
    
    // First bubble element (sweeping upward in frequency)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(300, now);
    osc1.frequency.exponentialRampToValueAtTime(900, now + 0.12);
    
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.3, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    
    osc1.start(now);
    osc1.stop(now + 0.16);

    // Second tiny bubble element for bounce/character
    setTimeout(() => {
      if (ctx.state === 'closed') return;
      const now2 = ctx.currentTime;
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(500, now2);
      osc2.frequency.exponentialRampToValueAtTime(1200, now2 + 0.10);
      
      gain2.gain.setValueAtTime(0, now2);
      gain2.gain.linearRampToValueAtTime(0.2, now2 + 0.02);
      gain2.gain.exponentialRampToValueAtTime(0.001, now2 + 0.12);
      
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      
      osc2.start(now2);
      osc2.stop(now2 + 0.13);
      
      setTimeout(() => {
        ctx.close().catch(() => {});
      }, 200);
    }, 80);
  } catch (e) {
    console.error('Failed to play bubble sound:', e);
  }
}

export default function OverlayPage() {
  const [payload, setPayload] = useState<OverlayPayload>({ state: 'idle' });
  const [audioLevels, setAudioLevels] = useState<number[]>([]);
  const [textInputValue, setTextInputValue] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [historyList, setHistoryList] = useState<any[]>([]);
  const [historySearchValue, setHistorySearchValue] = useState('');
  const prevStateRef = useRef<'idle' | 'listening' | 'executing' | 'completed' | 'clarification' | 'error' | 'history'>('idle');

  useEffect(() => {
    // Make body transparent for the overlay window
    document.body.style.backgroundColor = 'transparent';
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.className = '';

    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      (window as any).electronAPI.voiceOverlay.onStateChange((data: any) => {
        // Reset submission state on payload change
        if (data.state !== 'clarification' && data.state !== 'history') {
          setSubmitted(false);
          setTextInputValue('');
        }
        setPayload(data);
      });
      (window as any).electronAPI.voiceOverlay.onAudioLevels((levels: number[]) => {
        setAudioLevels(levels || []);
      });
      return () => (window as any).electronAPI.voiceOverlay.removeListeners();
    }
  }, []);

  const state = payload?.state || 'idle';

  // Fetch history list when state becomes 'history'
  useEffect(() => {
    if (state === 'history') {
      const fetchHistory = async () => {
        try {
          if (typeof window !== 'undefined' && (window as any).electronAPI?.history?.list) {
            const list = await (window as any).electronAPI.history.list();
            setHistoryList(list || []);
          }
        } catch (err) {
          console.error('[VoiceOverlay] Failed to fetch history:', err);
        }
      };
      fetchHistory();
      setSubmitted(false);
    }
  }, [state]);
  const isCompleted = state === 'completed';
  const renderedResponse = useMemo(
    () => renderMarkdown(payload?.response || 'Fern completed the task successfully.'),
    [payload?.response]
  );

  // Sync transcribed voice input to input field
  useEffect(() => {
    if (payload?.voiceInputText) {
      setTextInputValue(payload.voiceInputText);
    }
  }, [payload?.voiceInputText]);

  useEffect(() => {
    if (state === 'completed' && prevStateRef.current !== 'completed') {
      playBubbleSound();
    }
    prevStateRef.current = state;
  }, [state]);

  // Audio reactivity calculations
  const validLevels = Array.isArray(audioLevels) ? audioLevels.filter(v => typeof v === 'number' && !isNaN(v)) : [];
  const avgVolume = validLevels.length > 0 ? validLevels.reduce((a, b) => a + b, 0) / validLevels.length : 15;
  // Map 15-90 to a 0-1 scale
  const intensity = Math.min(1, Math.max(0, (avgVolume - 15) / 75)) || 0;

  // Glassmorphic layout values with smoother, darker drop shadows
  const background = state === 'error'
    ? 'linear-gradient(135deg, rgba(28, 18, 18, 0.96) 0%, rgba(18, 18, 18, 0.96) 100%)'
    : `linear-gradient(135deg, rgba(18, 18, 18, 0.95) 0%, rgba(${18 + Math.floor(intensity * 18)}, ${18 + Math.floor(intensity * 18)}, ${18 + Math.floor(intensity * 18)}, 0.95) 100%)`;
  const boxShadow = 'none';
  const border = state === 'error'
    ? '1px solid rgba(239, 68, 68, 0.25)'
    : `1px solid rgba(255, 255, 255, ${0.06 + intensity * 0.2})`;
  const scale = 1 + intensity * 0.012;

  // Submit MCQ option or confirm value
  const submitChoice = (value: string) => {
    if (submitted) return;
    setSubmitted(true);
    const answers = { [payload.question || 'choice']: [value] };
    if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.submitAnswer) {
      (window as any).electronAPI.voiceOverlay.submitAnswer(answers);
    }
  };

  // Submit Text Input form value
  const handleTextInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!textInputValue.trim() || submitted) return;
    setSubmitted(true);
    const answers = { [payload.question || 'input']: [textInputValue] };
    if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.submitAnswer) {
      (window as any).electronAPI.voiceOverlay.submitAnswer(answers);
    }
  };

  const hasOptions = (payload?.options && payload.options.length > 0) || payload?.formType === 'confirm';
  const clarificationMinHeight = hasOptions ? 320 : 200;

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'flex-end',
      paddingBottom: 20,
      background: 'transparent',
      overflow: 'hidden'
    }}>
      <AnimatePresence mode="wait">
        {state !== 'idle' && (
          <motion.div
            key={state}
            initial={{ opacity: 0, y: 30, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale }}
            exit={{ opacity: 0, y: 30, scale: 0.95, transition: { duration: 0.25, ease: 'easeIn' } }}
            transition={{ type: 'spring', damping: 26, stiffness: 240 }}
            style={{
              background,
              borderRadius: 24,
              padding: isCompleted ? '20px 28px' : (state === 'clarification' || state === 'history') ? '18px 24px' : state === 'error' ? '14px 20px' : '12px 28px',
              display: 'flex',
              flexDirection: (isCompleted || state === 'clarification' || state === 'history') ? 'column' : 'row',
              alignItems: (isCompleted || state === 'clarification' || state === 'history') ? 'stretch' : 'center',
              justifyContent: 'space-between',
              width: isCompleted ? 740 : (state === 'clarification' || state === 'history') ? 600 : 500,
              minHeight: isCompleted ? 260 : state === 'clarification' ? clarificationMinHeight : state === 'history' ? 320 : state === 'error' ? 52 : 64,
              boxShadow,
              border,
              backdropFilter: 'blur(18px)',
              transition: 'background 0.15s ease-out, border 0.15s ease-out, box-shadow 0.15s ease-out',
            }}
          >
            {/* Standard states: Listening & Executing */}
            {state !== 'clarification' && !isCompleted && state !== 'error' && state !== 'history' && (
              <div style={{ display: 'flex', gap: 14, alignItems: 'center', flex: 1, overflow: 'hidden' }}>
                <img
                  src="/images/logos/everfern-withoutbg.png"
                  alt="EverFern Logo"
                  style={{
                    width: 32,
                    height: 32,
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.15))'
                  }}
                />

                {/* State: Listening */}
                {state === 'listening' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, overflow: 'hidden' }}>
                    <div style={{ color: '#fff', fontSize: 15, fontWeight: 400, fontFamily: '"Figtree", sans-serif', opacity: 0.95 }}>
                      <motion.div
                        animate={{ opacity: [0.6, 1, 0.6] }}
                        transition={{ duration: 1.5, repeat: Infinity }}
                      >
                        Listening...
                      </motion.div>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 10, color: 'rgba(255, 255, 255, 0.45)', fontFamily: '"Figtree", sans-serif' }}>
                      <span><kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '1px 3px', fontSize: 8.5 }}>Ctrl+Alt+B</kbd> Resume Chat</span>
                      <span><kbd style={{ backgroundColor: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '1px 3px', fontSize: 8.5 }}>Ctrl+Alt+H</kbd> Chat History</span>
                    </div>
                  </div>
                )}

                {/* State: Executing */}
                {state === 'executing' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, overflow: 'hidden' }}>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em', fontFamily: '"Figtree", sans-serif' }}>
                      Executing
                    </span>
                    <p style={{
                      fontSize: 14,
                      color: '#ffffff',
                      fontWeight: 400,
                      margin: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontFamily: '"Figtree", sans-serif'
                    }}>
                      {payload.action || 'Thinking...'}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Standard controls: Listening & Executing */}
            {state === 'listening' && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {[0, 1, 2, 3].map((i) => (
                  <motion.div
                    key={i}
                    animate={{
                      scaleY: 1 + intensity * (i % 2 === 0 ? 3.5 : 2.2),
                      opacity: 0.5 + intensity * 0.5,
                    }}
                    transition={{ type: 'spring', stiffness: 350, damping: 14 }}
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: 2.5,
                      backgroundColor: '#ffffff',
                      boxShadow: `0 0 6px rgba(255, 255, 255, ${0.05 + intensity * 0.6})`,
                    }}
                  />
                ))}
              </div>
            )}

            {state === 'executing' && (
              <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                  style={{
                    width: 16,
                    height: 16,
                    border: '2px solid rgba(255,255,255,0.1)',
                    borderTopColor: '#ffffff',
                    borderRadius: '50%'
                  }}
                />
              </div>
            )}

            {/* State: Error */}
            {state === 'error' && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flex: 1, fontFamily: '"Figtree", sans-serif' }}>
                <div style={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  backgroundColor: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ef4444',
                  flexShrink: 0
                }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" x2="12" y1="8" y2="12"/>
                    <line x1="12" x2="12.01" y1="16" y2="16"/>
                  </svg>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflow: 'hidden' }}>
                  <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
                    Voice Mode Disabled
                  </span>
                  <span style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.7)', fontWeight: 400, textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {payload.message || "Voice mode isn't enabled. Please configure a provider in settings."}
                  </span>
                </div>
              </div>
            )}

            {/* State: Completed (Large Top Notification) */}
            {isCompleted && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', fontFamily: '"Figtree", sans-serif' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <img
                      src="/images/logos/everfern-withoutbg.png"
                      alt="EverFern Logo"
                      style={{
                        width: 32,
                        height: 32,
                        objectFit: 'contain',
                        filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.15))'
                      }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 13, color: '#ffffff', fontWeight: 500 }}>
                        EverFern Assistant
                      </span>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Execution Complete
                      </span>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <motion.svg
                      width="24"
                      height="24"
                      viewBox="0 0 48 48"
                    >
                      <motion.circle
                        cx="24"
                        cy="24"
                        r="20"
                        stroke="#ffffff"
                        strokeWidth="3.5"
                        fill="transparent"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.5, ease: "easeOut" }}
                      />
                      <motion.path
                        d="M14 24 L21 31 L34 16"
                        stroke="#ffffff"
                        strokeWidth="3.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="transparent"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.4, ease: "easeOut" }}
                      />
                    </motion.svg>
                  </div>
                </div>
                <div
                  dangerouslySetInnerHTML={{ __html: renderedResponse }}
                  style={{
                    fontSize: 14.5,
                    color: 'rgba(255, 255, 255, 0.95)',
                    fontWeight: 400,
                    lineHeight: 1.6,
                    margin: '4px 0 0 0',
                    maxHeight: 200,
                    overflowY: 'auto',
                    paddingRight: 4,
                    fontFamily: '"Figtree", sans-serif'
                  }}
                />

                <div style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  marginTop: 4,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(255, 255, 255, 0.05)'
                }}>
                  {/* Reply by Voice Button */}
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.sendState) {
                        (window as any).electronAPI.voiceOverlay.sendState('listening');
                      }
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 12px',
                      borderRadius: 12,
                      backgroundColor: 'rgba(255, 255, 255, 0.12)',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      color: '#ffffff',
                      fontSize: 12.5,
                      fontWeight: 500,
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                      whiteSpace: 'nowrap',
                      fontFamily: '"Figtree", sans-serif'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.18)';
                      e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.35)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                      e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.25)';
                    }}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                      <line x1="12" x2="12" y1="19" y2="22"/>
                    </svg>
                    <span>Reply by voice</span>
                  </button>

                  {/* Render payload follow-ups */}
                  {payload.followUps && payload.followUps.slice(0, 2).map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        const data = { type: 'followup', query: item.text };
                        if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.submitAnswer) {
                          (window as any).electronAPI.voiceOverlay.submitAnswer(data);
                        }
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 12,
                        backgroundColor: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        color: '#ffffff',
                        fontSize: 12.5,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        whiteSpace: 'nowrap',
                        fontFamily: '"Figtree", sans-serif'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
                        e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.2)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                        e.currentTarget.style.border = '1px solid rgba(255, 255, 255, 0.08)';
                      }}
                    >
                      <span>{item.icon}</span>
                      <span>{item.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* State: Clarification Form / MCQ */}
            {state === 'clarification' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, width: '100%', fontFamily: '"Figtree", sans-serif' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <img
                    src="/images/logos/everfern-withoutbg.png"
                    alt="EverFern Logo"
                    style={{ width: 30, height: 30, objectFit: 'contain' }}
                  />
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Clarification Required
                  </span>
                </div>

                <div style={{ fontSize: 14, color: '#ffffff', fontWeight: 450, lineHeight: 1.4 }}>
                  {payload.question || 'Please provide some input.'}
                </div>

                <div style={{ marginTop: 4 }}>
                  {submitted ? (
                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <motion.div
                        animate={{ rotate: 360 }}
                        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                        style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: '#ffffff', borderRadius: '50%' }}
                      />
                      Submitting answer...
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {/* Option buttons if confirmation */}
                      {payload.formType === 'confirm' && (
                        <div style={{ display: 'flex', gap: 10 }}>
                          <button
                            onClick={() => submitChoice('yes')}
                            style={{
                              flex: 1,
                              padding: '8px 16px',
                              borderRadius: 12,
                              backgroundColor: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              color: '#ffffff',
                              cursor: 'pointer',
                              fontSize: 13,
                              transition: 'all 0.2s',
                              textAlign: 'center'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
                              e.currentTarget.style.border = '1px solid rgba(255,255,255,0.25)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                              e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)';
                            }}
                          >
                            Yes
                          </button>
                          <button
                            onClick={() => submitChoice('no')}
                            style={{
                              flex: 1,
                              padding: '8px 16px',
                              borderRadius: 12,
                              backgroundColor: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.1)',
                              color: '#ffffff',
                              cursor: 'pointer',
                              fontSize: 13,
                              transition: 'all 0.2s',
                              textAlign: 'center'
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.15)';
                              e.currentTarget.style.border = '1px solid rgba(255,255,255,0.25)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.08)';
                              e.currentTarget.style.border = '1px solid rgba(255,255,255,0.1)';
                            }}
                          >
                            No
                          </button>
                        </div>
                      )}

                      {/* Options list if MCQ */}
                      {payload.formType !== 'confirm' && payload.formType !== 'input' && payload.options && payload.options.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 110, overflowY: 'auto', paddingRight: 4 }}>
                          {payload.options.map((opt, i) => (
                            <button
                              key={i}
                              onClick={() => submitChoice(opt.value)}
                              style={{
                                width: '100%',
                                padding: '8px 14px',
                                borderRadius: 12,
                                backgroundColor: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                color: '#ffffff',
                                cursor: 'pointer',
                                fontSize: 13,
                                textAlign: 'left',
                                transition: 'all 0.2s'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                                e.currentTarget.style.border = '1px solid rgba(255,255,255,0.2)';
                                e.currentTarget.style.transform = 'translateX(2px)';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                                e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)';
                                e.currentTarget.style.transform = 'none';
                              }}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Text & Voice dictation form (always shown) */}
                      <form onSubmit={handleTextInputSubmit} style={{ display: 'flex', gap: 10 }}>
                        <input
                          type="text"
                          value={textInputValue}
                          onChange={(e) => setTextInputValue(e.target.value)}
                          placeholder={(payload.options && payload.options.length > 0) || payload.formType === 'confirm' ? "Type or dictate custom response..." : "Type or dictate response..."}
                          style={{
                            flex: 1,
                            padding: '8px 14px',
                            borderRadius: 12,
                            backgroundColor: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: '#ffffff',
                            fontSize: 13,
                            outline: 'none',
                            transition: 'border 0.2s'
                          }}
                          onFocus={(e) => e.target.style.border = '1px solid rgba(255,255,255,0.3)'}
                          onBlur={(e) => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.sendState) {
                              (window as any).electronAPI.voiceOverlay.sendState('listening');
                            }
                          }}
                          style={{
                            padding: '8px 12px',
                            borderRadius: 12,
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#ffffff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s'
                          }}
                          title="Speak your answer"
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.2)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)';
                          }}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                            <line x1="12" x2="12" y1="19" y2="22"/>
                          </svg>
                        </button>
                        <button
                          type="submit"
                          style={{
                            padding: '8px 18px',
                            borderRadius: 12,
                            backgroundColor: '#ffffff',
                            border: 'none',
                            color: '#000000',
                            fontWeight: 500,
                            cursor: 'pointer',
                            fontSize: 13,
                            transition: 'opacity 0.2s'
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
                          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                        >
                          Submit
                        </button>
                      </form>
                      {/* Shortcuts Legend */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'center',
                        gap: 16,
                        marginTop: 10,
                        fontSize: 11,
                        color: 'rgba(255, 255, 255, 0.45)',
                        fontFamily: '"Figtree", sans-serif'
                      }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <kbd style={{
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 4,
                            padding: '1px 4px',
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: '#ffffff'
                          }}>Ctrl + Alt + B</kbd>
                          <span>Resume Chat</span>
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <kbd style={{
                            backgroundColor: 'rgba(255,255,255,0.1)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: 4,
                            padding: '1px 4px',
                            fontSize: 9.5,
                            fontWeight: 600,
                            color: '#ffffff'
                          }}>Ctrl + Alt + H</kbd>
                          <span>Chat History</span>
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* State: History Select */}
            {state === 'history' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', fontFamily: '"Figtree", sans-serif', height: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <img
                      src="/images/logos/everfern-withoutbg.png"
                      alt="EverFern Logo"
                      style={{ width: 30, height: 30, objectFit: 'contain' }}
                    />
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Select Chat History
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.sendState) {
                        (window as any).electronAPI.voiceOverlay.sendState('idle');
                      }
                    }}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'rgba(255,255,255,0.4)',
                      cursor: 'pointer',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                    onMouseEnter={e => e.currentTarget.style.color = '#fff'}
                    onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.4)'}
                  >
                    Close
                  </button>
                </div>

                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    value={historySearchValue}
                    onChange={(e) => setHistorySearchValue(e.target.value)}
                    placeholder="Search recent chats..."
                    style={{
                      width: '100%',
                      padding: '8px 14px',
                      borderRadius: 12,
                      backgroundColor: 'rgba(0,0,0,0.3)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#ffffff',
                      fontSize: 13,
                      outline: 'none',
                      boxSizing: 'border-box',
                      transition: 'border 0.2s'
                    }}
                    onFocus={(e) => e.target.style.border = '1px solid rgba(255,255,255,0.3)'}
                    onBlur={(e) => e.target.style.border = '1px solid rgba(255,255,255,0.1)'}
                  />
                </div>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  maxHeight: 180,
                  overflowY: 'auto',
                  paddingRight: 4
                }} className="custom-scrollbar">
                  {historyList.filter(c => {
                    const title = c.title || 'Untitled Chat';
                    return title.toLowerCase().includes(historySearchValue.toLowerCase());
                  }).length === 0 ? (
                    <div style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
                      No recent chats found
                    </div>
                  ) : (
                    historyList
                      .filter(c => {
                        const title = c.title || 'Untitled Chat';
                        return title.toLowerCase().includes(historySearchValue.toLowerCase());
                      })
                      .slice(0, 5)
                      .map((conv) => (
                        <button
                          key={conv.id}
                          onClick={() => {
                            if (submitted) return;
                            setSubmitted(true);
                            if (typeof window !== 'undefined' && (window as any).electronAPI?.voiceOverlay?.submitAnswer) {
                              (window as any).electronAPI.voiceOverlay.submitAnswer({
                                type: 'select-history',
                                conversationId: conv.id
                              });
                            }
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 14px',
                            borderRadius: 12,
                            backgroundColor: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            color: '#ffffff',
                            cursor: 'pointer',
                            fontSize: 13,
                            textAlign: 'left',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            transition: 'all 0.15s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.12)';
                            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.2)';
                            e.currentTarget.style.transform = 'translateX(2px)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)';
                            e.currentTarget.style.border = '1px solid rgba(255,255,255,0.08)';
                            e.currentTarget.style.transform = 'none';
                          }}
                        >
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                            {conv.title || 'Untitled Chat'}
                          </span>
                          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>
                            {new Date(conv.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                          </span>
                        </button>
                      ))
                  )}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}