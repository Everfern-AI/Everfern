'use client';

import React, { useState, useEffect } from 'react';
import { CheckIcon, DocumentTextIcon } from '@heroicons/react/24/outline';

interface PdfOcrConfig {
    engine: 'ocrmypdf' | 'tesseract' | 'paddleocr' | 'paddleocr-vl' | 'vision-send';
    backend: 'auto' | 'openvino';
    autoOcr: boolean;
}

const DEFAULT_PDF_OCR_SETTINGS: PdfOcrConfig = {
    engine: 'ocrmypdf',
    backend: 'auto',
    autoOcr: true,
};

const Label = ({ children }: { children: React.ReactNode }) => (
    <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, margin: '0 0 8px' }}>
        {children}
    </p>
);

/**
 * PDF OCR panel — Auto-extract text when PDFs are attached.
 * Shares the same persisted config (~/.everfern/tool-settings.json → pdfOcr) as
 * the send flow, so changes here apply immediately to the chat prompt input.
 */
export default function PdfOcrPanel() {
    const [config, setConfig] = useState<PdfOcrConfig>(DEFAULT_PDF_OCR_SETTINGS);
    const [isLoading, setIsLoading] = useState(true);
    const [ocrReady, setOcrReady] = useState<boolean | null>(null);
    const [ocrInstalling, setOcrInstalling] = useState(false);
    const [ocrMessage, setOcrMessage] = useState('');
    const [ocrProgress, setOcrProgress] = useState<{ percent: number; step: string; detail: string } | null>(null);

    useEffect(() => {
        const unsub = (window as any).electronAPI?.system?.onOcrProgress?.((data: { percent: number; step: string; detail: string }) => {
            setOcrProgress(data);
        });
        return () => { unsub && unsub(); };
    }, []);

    useEffect(() => {
        const load = async () => {
            try {
                const stored = await (window as any).electronAPI?.toolSettings?.get?.();
                if (stored?.pdfOcr) {
                    setConfig({ ...DEFAULT_PDF_OCR_SETTINGS, ...stored.pdfOcr });
                }
                const ocrStatus = await (window as any).electronAPI?.system?.ocrStatus?.();
                if (ocrStatus) setOcrReady(Boolean(ocrStatus.ready));
            } catch (e) {
                console.error('[PdfOcrPanel] Failed to load config:', e);
            }
            setIsLoading(false);
        };
        load();
    }, []);

    const save = async (next: PdfOcrConfig) => {
        setConfig(next);
        try {
            const stored = await (window as any).electronAPI?.toolSettings?.get?.();
            await (window as any).electronAPI?.toolSettings?.set?.({ ...(stored || {}), pdfOcr: next });
        } catch (e) {
            console.error('[PdfOcrPanel] Failed to save config:', e);
        }
    };

    const handleInstallOcr = async () => {
        setOcrInstalling(true);
        setOcrMessage('Setting up OCR engine — a terminal window has opened to show live progress.');
        setOcrProgress({ percent: 0, step: 'Bootstrap', detail: 'Starting install...' });
        try {
            const result = await (window as any).electronAPI?.system?.ocrInstall?.();
            if (result) {
                setOcrMessage(result.ok ? (result.message || 'OCR dependencies ready.') : (result.message || 'OCR setup failed.'));
                setOcrProgress(result.ok ? { percent: 100, step: 'Done', detail: 'OCR dependencies ready.' } : null);
                if (result.ok) setOcrReady(true);
            } else {
                setOcrMessage('OCR setup completed. Check the terminal window for details.');
                setOcrProgress({ percent: 100, step: 'Done', detail: 'OCR dependencies ready.' });
                setOcrReady(true);
            }
        } catch (e) {
            console.error('[PdfOcrPanel] Failed to install OCR deps:', e);
            setOcrMessage(e instanceof Error ? e.message : 'OCR setup failed.');
            setOcrProgress(null);
        } finally {
            setOcrInstalling(false);
        }
    };

    if (isLoading) {
        return (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--color-text-tertiary)', fontSize: 14 }}>
                Loading PDF OCR settings...
            </div>
        );
    }

    return (
        <div style={{ backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                    <DocumentTextIcon width={18} height={18} />
                </div>
                <div style={{ flex: 1 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>PDF OCR</h3>
                    <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '2px 0 0' }}>Auto-extract text when PDFs are attached</p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, color: ocrReady ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: ocrReady ? 'var(--color-success)' : 'var(--color-text-placeholder)', display: 'inline-block' }} />
                    {ocrReady === null ? 'Checking...' : ocrReady ? 'OCR ready' : 'Not installed'}
                </div>
            </div>

            <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: '0 0 16px' }}>
                When you attach a PDF, EverFern processes it locally so the AI gets the content automatically — no need for the AI to invoke Python to scan the file. <strong>OCRmyPDF</strong> produces searchable text and sidecar extraction using Tesseract. <strong>Vision Send</strong> takes a screenshot of each page and sends the images to the AI instead.
            </p>

            {/* Engine selector */}
            <div style={{ marginBottom: 16 }}>
                <Label>OCR Engine</Label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                    {([
                        { id: 'ocrmypdf', title: 'OCRmyPDF (Default)', desc: 'High quality PDF text & sidecar OCR via Tesseract' },
                        { id: 'tesseract', title: 'Tesseract', desc: 'Direct page-by-page OCR recognition' },
                        { id: 'paddleocr', title: 'PaddleOCR', desc: 'Deep learning PP-OCR text extraction' },
                        { id: 'paddleocr-vl', title: 'PaddleOCR-VL', desc: 'Vision-language OCR' },
                        { id: 'vision-send', title: 'Vision Send', desc: 'Send page screenshots to AI' },
                    ] as const).map(eng => {
                        const isSelected = config.engine === eng.id;
                        return (
                            <div
                                key={eng.id}
                                onClick={() => save({ ...config, engine: eng.id })}
                                style={{
                                    padding: '14px 16px',
                                    borderRadius: 12,
                                    border: `1.5px solid ${isSelected ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                    backgroundColor: isSelected ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-out',
                                    position: 'relative',
                                    userSelect: 'none',
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                            >
                                {isSelected && (
                                    <div style={{ position: 'absolute', top: 10, right: 10, color: 'var(--color-text-primary)' }}>
                                        <CheckIcon width={14} height={14} strokeWidth={2.5} />
                                    </div>
                                )}
                                <div style={{ fontSize: 13.5, fontWeight: isSelected ? 600 : 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>{eng.title}</div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.35 }}>{eng.desc}</div>
                            </div>
                        );
                    })}
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 8 }}>
                    OCRmyPDF uses Tesseract to automatically produce searchable text layers and extract clean text from attached documents.
                </p>
            </div>

            {/* Backend selector */}
            <div style={{ marginBottom: 16 }}>
                <Label>Acceleration Backend</Label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    {([
                        { id: 'auto', title: 'Auto', desc: 'Best for the detected CPU' },
                        { id: 'openvino', title: 'OpenVINO', desc: 'Accelerated on Intel CPUs / iGPUs' },
                    ] as const).map(bk => {
                        const isSelected = config.backend === bk.id;
                        return (
                            <div
                                key={bk.id}
                                onClick={() => save({ ...config, backend: bk.id })}
                                style={{
                                    padding: '14px 16px',
                                    borderRadius: 12,
                                    border: `1.5px solid ${isSelected ? 'var(--color-text-primary)' : 'var(--color-border)'}`,
                                    backgroundColor: isSelected ? 'var(--color-bg-subtle)' : 'var(--color-bg-surface)',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s ease-out',
                                    position: 'relative',
                                    userSelect: 'none',
                                }}
                                onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'; }}
                                onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--color-bg-surface)'; }}
                            >
                                {isSelected && (
                                    <div style={{ position: 'absolute', top: 10, right: 10, color: 'var(--color-text-primary)' }}>
                                        <CheckIcon width={14} height={14} strokeWidth={2.5} />
                                    </div>
                                )}
                                <div style={{ fontSize: 14, fontWeight: isSelected ? 600 : 500, color: 'var(--color-text-primary)', marginBottom: 2 }}>{bk.title}</div>
                                <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>{bk.desc}</div>
                            </div>
                        );
                    })}
                </div>
                <p style={{ fontSize: 11, color: 'var(--color-text-placeholder)', marginTop: 8 }}>
                    OpenVINO accelerates OCR on Intel CPUs and integrated GPUs. Auto falls back to CPU/MKLDNN on other hardware.
                </p>
            </div>

            {/* Auto-OCR toggle */}
            <div style={{ marginBottom: 16 }}>
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 12,
                }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-primary)' }}>
                            Auto-OCR attached PDFs
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            Extract text automatically on upload before sending to the AI
                        </div>
                    </div>
                    <div
                        onClick={() => save({ ...config, autoOcr: !config.autoOcr })}
                        style={{
                            width: 44, height: 24, borderRadius: 12, position: 'relative',
                            backgroundColor: config.autoOcr ? 'var(--color-text-primary)' : 'var(--color-border)',
                            cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
                        }}
                    >
                        <div style={{
                            position: 'absolute', top: 3,
                            left: config.autoOcr ? 23 : 3,
                            width: 18, height: 18, borderRadius: '50%',
                            backgroundColor: 'var(--color-bg-surface)',
                            transition: 'left 0.2s',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                        }} />
                    </div>
                </div>
            </div>

            {/* Install button + status */}
            <div>
                <button
                    type="button"
                    onClick={handleInstallOcr}
                    disabled={ocrInstalling || ocrReady === true}
                    style={{
                        padding: '10px 16px',
                        borderRadius: 10,
                        border: 'none',
                        backgroundColor: (ocrInstalling || ocrReady === true) ? 'var(--color-bg-subtle)' : 'var(--color-text-primary)',
                        color: (ocrInstalling || ocrReady === true) ? 'var(--color-text-tertiary)' : 'var(--color-bg-base)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: (ocrInstalling || ocrReady === true) ? 'default' : 'pointer',
                        transition: 'all 0.15s ease',
                    }}
                >
                    {ocrInstalling ? 'Installing OCR dependencies...' : ocrReady === true ? 'OCR Ready' : 'Install OCR Dependencies'}
                </button>
                {ocrMessage && (
                    <p style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', margin: '10px 0 0', lineHeight: 1.5 }}>{ocrMessage}</p>
                )}
            </div>
        </div>
    );
}