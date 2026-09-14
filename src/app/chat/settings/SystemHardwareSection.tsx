'use client';
import React, { useState, useEffect, useRef } from 'react';
import { GraphicsCardIcon } from '@phosphor-icons/react';
import { CpuChipIcon, ArrowPathIcon } from '@heroicons/react/24/outline';
import { SectionTitle, SectionSubtitle, Card } from './ui';
// ── Top-level System Hardware Cache ──────────────────────────────────────────
// Module-level cache shared across all mounts of this section. Because the
// settings page unmounts/remounts sections when the user switches tabs, this
// avoids re-running expensive hardware detection and model-list fetches.
let _cachedHardwareInfo: any = null;
let _cachedModelsList: any[] = [];

// ── System & Hardware Section with Model VRAM & TPS Predictor (Top-Level) ─────
export const SystemHardwareSection: React.FC = () => {
    const [hardwareInfo, setHardwareInfo] = useState<{
        ramGB: number;
        freeRamGB?: number;
        usedRamGB?: number;
        cpuModel?: string;
        cpuCores?: number;
        cpuSpeed?: number;
        gpuName: string;
        vramGB: number;
        driverVersion?: string;
        gpuTemp?: number;
        isNvidia?: boolean;
        isAppleSilicon?: boolean;
        platform?: string;
        arch?: string;
        hostname?: string;
    } | null>(_cachedHardwareInfo);

    const [modelsList, setModelsList] = useState<any[]>(_cachedModelsList);
    const [isLoadingHardware, setIsLoadingHardware] = useState(false);
    const [filterStatus, setFilterStatus] = useState<'all' | 'full_gpu' | 'cpu_offload' | 'exceeds_specs'>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [customModelId, setCustomModelId] = useState('');
    const [customResult, setCustomResult] = useState<any>(null);
    const [customError, setCustomError] = useState<string | null>(null);
    const [isCalculatingCustom, setIsCalculatingCustom] = useState(false);
    const [pullingModel, setPullingModel] = useState<string | null>(null);
    const [pullProgress, setPullProgress] = useState<string>('');
    const loadHardwareSeqRef = useRef<number>(0);
    // Tracks whether the searchQuery effect has run once yet; the first run
    // is skipped so the debounced search doesn't duplicate the mount-time load.
    const isFirstRenderRef = useRef<boolean>(true);

    const loadSystemHardware = async (searchParam?: string, forceRefresh = false) => {
        // Sequence token: every call bumps the counter; any in-flight fetch whose
        // token is stale aborts silently. This keeps rapid searches (debounced)
        // from racing each other and overwriting newer results with older ones.
        const seq = ++loadHardwareSeqRef.current;
        setIsLoadingHardware(true);
        try {
            let hw: any = hardwareInfo || _cachedHardwareInfo;
            const sysApi = (window as any).electronAPI?.system;
            if (!hw || forceRefresh) {
                if (sysApi?.detectHardware) {
                    hw = await sysApi.detectHardware();
                    if (seq !== loadHardwareSeqRef.current) return;
                    _cachedHardwareInfo = hw;
                    setHardwareInfo(hw);
                }
            }

            const vram = hw?.vramGB || 0;
            const ram = hw?.ramGB || 16;
            const isApple = Boolean(hw?.isAppleSilicon);
            const gpuName = hw?.gpuName || '';
            const activeSearch = typeof searchParam === 'string' ? searchParam : searchQuery;

            // 1. Local Electron IPC handler first for instant query
            if (sysApi?.getModelRequirements) {
                try {
                    const ipcRes = await sysApi.getModelRequirements({
                        vramGB: vram,
                        ramGB: ram,
                        isAppleSilicon: isApple,
                        gpuName,
                        search: activeSearch
                    });
                    if (seq !== loadHardwareSeqRef.current) return;
                    if (ipcRes?.success && Array.isArray(ipcRes.models) && ipcRes.models.length > 0) {
                        _cachedModelsList = ipcRes.models;
                        setModelsList(ipcRes.models);
                        setIsLoadingHardware(false);
                        return;
                    }
                } catch (ipcErr) {
                    console.warn('[EverFern] ⚠️ IPC query failed:', ipcErr);
                }
            }

            // 2. EverFern Cloud / Local Backend APIs — try each candidate in order
            // with a hard 1.5s abort so a dead backend doesn't block the UI.
            const candidateUrls = [
                process.env.NEXT_PUBLIC_API_URL,
                'http://127.0.0.1:5000',
                'http://localhost:5000',
                'https://api.everfern.app'
            ].filter(Boolean) as string[];

            const q = activeSearch ? `&search=${encodeURIComponent(activeSearch)}` : '';
            for (const baseUrl of candidateUrls) {
                try {
                    const targetUrl = `${baseUrl.replace(/\/$/, '')}/api/system/model-requirements?vram_gb=${vram}&ram_gb=${ram}&is_apple_silicon=${isApple}&gpu_name=${encodeURIComponent(gpuName)}${q}`;
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 1500);
                    const res = await fetch(targetUrl, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
                    clearTimeout(timeout);
                    if (seq !== loadHardwareSeqRef.current) return;
                    if (res.ok) {
                        const data = await res.json();
                        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
                            _cachedModelsList = data.models;
                            setModelsList(data.models);
                            setIsLoadingHardware(false);
                            return;
                        }
                    }
                } catch (e: any) {}
            }

            // 3. Client-side fallback computation (IPC and all backends unreachable) —
            // uses a baked-in model table plus heuristic VRAM/TPS estimates so the
            // section still works fully offline.
            const fallbackModels = [
                { model_id: "meta-llama/Llama-3.2-1B-Instruct", name: "Llama 3.2 1B", params_b: 1.2, raw_fp16_vram_gb: 2.47, quantized_q4_vram_gb: 0.88, quantized_q8_vram_gb: 1.45, min_ram_gb: 4, category: "Ultra-lightweight / Fast Edge", tags: ["llama3.2:1b"] },
                { model_id: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B", params_b: 3.2, raw_fp16_vram_gb: 6.42, quantized_q4_vram_gb: 2.22, quantized_q8_vram_gb: 3.65, min_ram_gb: 6, category: "Compact / High Quality", tags: ["llama3.2:3b"] },
                { model_id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", params_b: 8.0, raw_fp16_vram_gb: 16.06, quantized_q4_vram_gb: 5.34, quantized_q8_vram_gb: 9.10, min_ram_gb: 12, category: "Standard General Purpose", tags: ["llama3.1:8b"] },
                { model_id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B v0.3", params_b: 7.2, raw_fp16_vram_gb: 14.50, quantized_q4_vram_gb: 4.16, quantized_q8_vram_gb: 8.20, min_ram_gb: 8, category: "Fast Instruction & Reasoning", tags: ["mistral:7b"] },
                { model_id: "Qwen/Qwen2.5-Coder-1.5B-Instruct", name: "Qwen 2.5 Coder 1.5B", params_b: 1.5, raw_fp16_vram_gb: 3.08, quantized_q4_vram_gb: 1.08, quantized_q8_vram_gb: 1.78, min_ram_gb: 4, category: "Fast Coding Specialist", tags: ["qwen2.5-coder:1.5b"] },
                { model_id: "Qwen/Qwen2.5-Coder-7B-Instruct", name: "Qwen 2.5 Coder 7B", params_b: 7.6, raw_fp16_vram_gb: 15.22, quantized_q4_vram_gb: 5.08, quantized_q8_vram_gb: 8.65, min_ram_gb: 10, category: "Flagship Coding Specialist", tags: ["qwen2.5-coder:7b"] },
                { model_id: "Qwen/Qwen2.5-Coder-14B-Instruct", name: "Qwen 2.5 Coder 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.75, quantized_q8_vram_gb: 16.50, min_ram_gb: 16, category: "Heavy Coding & Autonomous", tags: ["qwen2.5-coder:14b"] },
                { model_id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B", params_b: 32.5, raw_fp16_vram_gb: 65.00, quantized_q4_vram_gb: 20.40, quantized_q8_vram_gb: 36.20, min_ram_gb: 32, category: "State-of-the-Art Coding", tags: ["qwen2.5-coder:32b"] },
                { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B", name: "DeepSeek R1 1.5B", params_b: 1.8, raw_fp16_vram_gb: 3.56, quantized_q4_vram_gb: 1.25, quantized_q8_vram_gb: 2.05, min_ram_gb: 4, category: "Compact Reasoning", tags: ["deepseek-r1:1.5b"] },
                { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", name: "DeepSeek R1 7B", params_b: 7.6, raw_fp16_vram_gb: 15.22, quantized_q4_vram_gb: 5.15, quantized_q8_vram_gb: 8.65, min_ram_gb: 12, category: "Advanced Reasoning", tags: ["deepseek-r1:7b"] },
                { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B", name: "DeepSeek R1 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.80, quantized_q8_vram_gb: 16.50, min_ram_gb: 16, category: "Deep Reasoning Specialist", tags: ["deepseek-r1:14b"] },
                { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", name: "DeepSeek R1 32B", params_b: 32.8, raw_fp16_vram_gb: 65.60, quantized_q4_vram_gb: 21.20, quantized_q8_vram_gb: 36.80, min_ram_gb: 32, category: "Top-tier Math & Logic Reasoning", tags: ["deepseek-r1:32b"] },
                { model_id: "google/gemma-2-2b-it", name: "Gemma 2 2B", params_b: 2.6, raw_fp16_vram_gb: 5.22, quantized_q4_vram_gb: 1.78, quantized_q8_vram_gb: 2.95, min_ram_gb: 6, category: "Lightweight Google Research", tags: ["gemma2:2b"] },
                { model_id: "google/gemma-2-9b-it", name: "Gemma 2 9B", params_b: 9.2, raw_fp16_vram_gb: 18.48, quantized_q4_vram_gb: 6.12, quantized_q8_vram_gb: 10.40, min_ram_gb: 12, category: "High Accuracy General Purpose", tags: ["gemma2:9b"] },
                { model_id: "microsoft/phi-4", name: "Phi-4 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.70, quantized_q8_vram_gb: 16.50, min_ram_gb: 16, category: "Microsoft Synthetic Reasoning", tags: ["phi4:14b"] },
                { model_id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B", params_b: 70.6, raw_fp16_vram_gb: 141.2, quantized_q4_vram_gb: 43.5, quantized_q8_vram_gb: 78.5, min_ram_gb: 64, category: "Enterprise Frontier Model", tags: ["llama3.1:70b"] }
            ];

            // Apple Silicon has unified memory, so treat ~75% of RAM as usable "VRAM";
            // discrete GPUs are limited to their actual VRAM. `bw` is a rough memory
            // bandwidth tier used for the tokens/sec heuristic below.
            const effectiveVram = isApple ? Math.max(vram, ram * 0.75) : vram;
            const bw = effectiveVram >= 8 ? 360 : (effectiveVram >= 4 ? 240 : 45);

            const computed = fallbackModels.map(m => {
                const q4 = m.quantized_q4_vram_gb;
                let status: 'full_gpu' | 'cpu_offload' | 'exceeds_specs' = 'exceeds_specs';
                let badge = 'Cloud Required';
                let predicted_tps = 0;

                if (effectiveVram >= q4) {
                    status = 'full_gpu';
                    badge = 'Full GPU';
                    predicted_tps = Math.round((bw / Math.max(q4, 0.5)) * 0.75 * 10) / 10;
                } else if ((effectiveVram + (ram * 0.5)) >= q4 && ram >= m.min_ram_gb) {
                    status = 'cpu_offload';
                    badge = 'CPU Offload';
                    predicted_tps = Math.round((35 / Math.max(q4, 0.5)) * 0.65 * 10) / 10;
                }

                return {
                    ...m,
                    status,
                    badge,
                    predicted_tps,
                    fits_in_vram: effectiveVram >= q4,
                    fits_in_ram: ram >= m.min_ram_gb
                };
            });

            if (seq !== loadHardwareSeqRef.current) return;
            if (activeSearch) {
                const q = activeSearch.toLowerCase();
                const filtered = computed.filter(m => m.name.toLowerCase().includes(q) || m.model_id.toLowerCase().includes(q) || (m.tags && m.tags.some(t => t.toLowerCase().includes(q))));
                _cachedModelsList = filtered;
                setModelsList(filtered);
            } else {
                _cachedModelsList = computed;
                setModelsList(computed);
            }
        } catch (err) {
            console.error('Failed to load hardware:', err);
        } finally {
            if (seq === loadHardwareSeqRef.current) {
                setIsLoadingHardware(false);
            }
        }
    };

    useEffect(() => {
        if (!_cachedHardwareInfo || _cachedModelsList.length === 0) {
            loadSystemHardware();
        }
    }, []);

    useEffect(() => {
        if (isFirstRenderRef.current) {
            // Skip the very first render — the mount effect above already
            // triggered a load, so debouncing an immediate duplicate is wasted.
            isFirstRenderRef.current = false;
            return;
        }
        // Debounce search input: only re-query after the user pauses typing
        // for 350ms, and cancel the pending timer if they keep typing.
        const timer = setTimeout(() => {
            loadSystemHardware(searchQuery);
        }, 350);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleCalculateCustomModel = async () => {
        if (!customModelId.trim()) return;
        setIsCalculatingCustom(true);
        setCustomResult(null);
        setCustomError(null);
        try {
            const sysApi = (window as any).electronAPI?.system;
            const vram = hardwareInfo?.vramGB || 0;
            const ram = hardwareInfo?.ramGB || 16;
            const isApple = Boolean(hardwareInfo?.isAppleSilicon);
            const gpuName = hardwareInfo?.gpuName || '';

            if (sysApi?.getModelRequirements) {
                const res = await sysApi.getModelRequirements({
                    vramGB: vram,
                    ramGB: ram,
                    isAppleSilicon: isApple,
                    gpuName,
                    modelId: customModelId.trim()
                });
                if (res) {
                    if (res.notFound || res.success === false) {
                        setCustomError(res.error || `Model repository "${customModelId.trim()}" was not found on Hugging Face Hub.`);
                        return;
                    }
                    setCustomResult(res);
                    return;
                }
            }

            // Cloud / local backend lookup
            const candidateUrls = [
                process.env.NEXT_PUBLIC_API_URL,
                'http://127.0.0.1:5000',
                'http://localhost:5000',
                'https://api.everfern.app'
            ].filter(Boolean) as string[];

            for (const baseUrl of candidateUrls) {
                try {
                    const targetUrl = `${baseUrl.replace(/\/$/, '')}/api/system/model-requirements?model=${encodeURIComponent(customModelId.trim())}`;
                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 1500);
                    const res = await fetch(targetUrl, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
                    clearTimeout(timeout);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.notFound || data.success === false) {
                            setCustomError(data.error || `Model repository "${customModelId.trim()}" was not found on Hugging Face Hub.`);
                            return;
                        }
                        const effectiveVram = isApple ? Math.max(vram, ram * 0.75) : vram;
                        const q4 = data.quantized_q4_vram_gb || 4.16;
                        const bw = effectiveVram >= 8 ? 360 : (effectiveVram >= 4 ? 240 : 45);

                        let status = 'exceeds_specs';
                        let badge = 'Cloud Required';
                        let predicted_tps = 0;

                if (effectiveVram >= q4) {
                    // Tier heuristic mirrors the fallback table: model fully in
                    // VRAM → estimate TPS from bandwidth/q4; partially in RAM →
                    // CPU-offload estimate off a fixed 35 GB/s disk tier.
                    status = 'full_gpu';
                    badge = 'Full GPU';
                    predicted_tps = Math.round((bw / Math.max(q4, 0.5)) * 0.75 * 10) / 10;
                } else if ((effectiveVram + (ram * 0.5)) >= q4) {
                            status = 'cpu_offload';
                            badge = 'CPU Offload';
                            predicted_tps = Math.round((35 / Math.max(q4, 0.5)) * 0.65 * 10) / 10;
                        }

                        setCustomResult({
                            ...data,
                            status,
                            badge,
                            predicted_tps
                        });
                        return;
                    }
                } catch (e) {}
            }

            setCustomError(`Unable to verify model "${customModelId.trim()}" on Hugging Face Hub. Please check your internet connection or verify the repository ID.`);
        } catch (err: any) {
            setCustomError(err?.message || 'Error communicating with model calculation service.');
        } finally {
            setIsCalculatingCustom(false);
        }
    };

    /**
     * Trigger a local `ollama pull` (or LM Studio equivalent) by handing off
     * to a visible terminal when possible; falls back to the headless
     * ollamaPull IPC if the terminal path is unavailable. Progress here is
     * informational text only — real progress streams in the terminal.
     */
    const handlePullModel = async (modelTag: string, provider: 'ollama' | 'lmstudio' = 'ollama') => {
        const api = (window as any).electronAPI?.system;
        if (!api) return;
        setPullingModel(modelTag);
        setPullProgress('Opening terminal to pull model...');
        try {
            if (api.pullLocalModelTerminal) {
                await api.pullLocalModelTerminal({ provider, modelTag });
                setPullProgress(`Opened terminal for ${modelTag}`);
            } else if (api.ollamaPull) {
                await api.ollamaPull(modelTag);
                setPullProgress(`Completed pull for ${modelTag}`);
            }
        } catch (err: any) {
            setPullProgress(`Error: ${err?.message || String(err)}`);
        } finally {
            setTimeout(() => setPullingModel(null), 3500);
        }
    };

    // Memo-free client filter: modelsList is only swapped (not edited) by
    // loadSystemHardware, so filtering straight off state is fine — the list
    // is small and tab switches remount anyway.
    const filteredModels = modelsList.filter(m => {
        if (filterStatus !== 'all' && m.status !== filterStatus) return false;
        return true;
    });

    const vramGb = hardwareInfo?.vramGB || 0;
    const ramGb = hardwareInfo?.ramGB || 16;
    const freeRam = hardwareInfo?.freeRamGB || 8;

    return (
        <div style={{ padding: '4px 0 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <SectionTitle>System &amp; Hardware</SectionTitle>
                <button
                    onClick={() => loadSystemHardware(undefined, true)}
                    disabled={isLoadingHardware}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '7px 14px', borderRadius: 8,
                        backgroundColor: 'var(--color-bg-subtle)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-secondary)',
                        fontSize: 12, fontWeight: 500, cursor: 'pointer',
                        transition: 'all 0.15s'
                    }}
                >
                    <ArrowPathIcon width={13} height={13} className={isLoadingHardware ? 'animate-spin' : ''} />
                    Refresh Specs
                </button>
            </div>
            <SectionSubtitle>
                Inspect machine specifications, compute exact VRAM footprints with KV-cache buffers, and estimate local model execution throughput.
            </SectionSubtitle>

            {/* Hardware Overview Cards Grid with Increased Spacing and Muted Minimal Icons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 24, marginBottom: 28 }}>
                {/* GPU & VRAM Card */}
                <Card style={{ padding: '24px 26px', margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                            width: 42, height: 42, borderRadius: 12,
                            backgroundColor: 'var(--color-bg-subtle)',
                            border: '1px solid var(--color-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--color-text-secondary)',
                            flexShrink: 0
                        }}>
                            <GraphicsCardIcon size={24} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                                Graphics Processor
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {hardwareInfo?.gpuName || 'Detecting GPU...'}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            <span>Dedicated VRAM</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {vramGb} GB {hardwareInfo?.isAppleSilicon ? '(Unified)' : ''}
                            </span>
                        </div>
                        {hardwareInfo?.driverVersion && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                <span>Driver</span>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{hardwareInfo.driverVersion}</span>
                            </div>
                        )}
                        {hardwareInfo?.gpuTemp !== undefined && hardwareInfo.gpuTemp > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                                <span>Core Temperature</span>
                                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>{hardwareInfo.gpuTemp}°C</span>
                            </div>
                        )}
                    </div>
                </Card>

                {/* CPU & RAM Card */}
                <Card style={{ padding: '24px 26px', margin: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                            width: 42, height: 42, borderRadius: 12,
                            backgroundColor: 'var(--color-bg-subtle)',
                            border: '1px solid var(--color-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--color-text-secondary)',
                            flexShrink: 0
                        }}>
                            <CpuChipIcon width={24} height={24} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
                                System CPU &amp; Memory
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {hardwareInfo?.cpuModel || 'Detecting CPU...'}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            <span>System RAM</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                                {ramGb} GB {freeRam ? `(${freeRam} GB Free)` : ''}
                            </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            <span>Architecture</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-tertiary)' }}>
                                {hardwareInfo?.cpuCores ? `${hardwareInfo.cpuCores} Cores • ` : ''}{hardwareInfo?.arch || 'x64'}
                            </span>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Hugging Face Custom Model VRAM Calculator */}
            <div style={{ marginTop: 24, marginBottom: 28 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 6 }}>
                    Hugging Face Model Requirement Calculator
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
                    Query real-time metadata from Hugging Face Hub (config.json, safetensors index) to compute exact parameter counts, KV cache size, and hardware compatibility.
                </div>

                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                    <input
                        type="text"
                        placeholder="e.g. meta-llama/Llama-3.3-70B-Instruct, deepseek-ai/DeepSeek-R1, mistralai/Mistral-Small-24B-Instruct-2501"
                        value={customModelId}
                        onChange={e => setCustomModelId(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCalculateCustomModel()}
                        style={{
                            flex: 1, padding: '10px 14px', borderRadius: 8,
                            backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                            color: 'var(--color-text-primary)', fontSize: 13, fontFamily: 'var(--font-mono)'
                        }}
                    />
                    <button
                        onClick={handleCalculateCustomModel}
                        disabled={isCalculatingCustom || !customModelId.trim()}
                        style={{
                            padding: '10px 18px', borderRadius: 8,
                            backgroundColor: 'var(--color-text-primary)', color: 'var(--color-bg-base)',
                            fontSize: 12.5, fontWeight: 600, border: 'none', cursor: 'pointer',
                            opacity: isCalculatingCustom || !customModelId.trim() ? 0.6 : 1,
                            display: 'flex', alignItems: 'center', gap: 6
                        }}
                    >
                        {isCalculatingCustom ? <ArrowPathIcon width={14} height={14} className="animate-spin" /> : null}
                        Calculate Requirements
                    </button>
                </div>

                {customError && (
                    <div style={{ padding: '10px 14px', borderRadius: 8, backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.25)', color: '#ef4444', fontSize: 12 }}>
                        {customError}
                    </div>
                )}

                {customResult && (
                    <Card style={{ padding: '18px 20px', marginTop: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
                            <div>
                                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 2 }}>
                                    {customResult.name || customResult.model_id}
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                                    {customResult.model_id}
                                </div>
                            </div>
                            <span style={{
                                fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                                backgroundColor: customResult.status === 'full_gpu' ? 'rgba(34, 197, 94, 0.15)' : customResult.status === 'cpu_offload' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                                color: customResult.status === 'full_gpu' ? '#16a34a' : customResult.status === 'cpu_offload' ? '#d97706' : '#dc2626'
                            }}>
                                {customResult.badge}
                            </span>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: '12px 14px', borderRadius: 8, backgroundColor: 'var(--color-bg-subtle)', marginBottom: 12 }}>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Parameters</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{customResult.params_b}B</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>4-Bit (Q4) VRAM</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{customResult.quantized_q4_vram_gb} GB</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>FP16 VRAM</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{customResult.raw_fp16_vram_gb} GB</div>
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Estimated TPS</div>
                                <div style={{ fontSize: 14, fontWeight: 600, color: customResult.predicted_tps > 0 ? '#16a34a' : 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                                    {customResult.predicted_tps > 0 ? `~${customResult.predicted_tps} tok/s` : 'N/A'}
                                </div>
                            </div>
                        </div>

                        {customResult.architecture && (
                            <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
                                Architecture: <span style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>{customResult.architecture}</span>
                                {customResult.context_length ? ` • Context Window: ${customResult.context_length.toLocaleString()} tokens` : ''}
                            </div>
                        )}
                    </Card>
                )}
            </div>

            {/* Compatible Open-Source Models List */}
            <div style={{ marginTop: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            Compatible Open-Source Models
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                            Real-time hardware matching with Ollama and LM Studio integration
                        </div>
                    </div>

                    {/* Filter Pills */}
                    <div style={{ display: 'flex', gap: 6 }}>
                        {(['all', 'full_gpu', 'cpu_offload', 'exceeds_specs'] as const).map(st => (
                            <button
                                key={st}
                                onClick={() => setFilterStatus(st)}
                                style={{
                                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                                    border: 'none', cursor: 'pointer',
                                    backgroundColor: filterStatus === st ? 'var(--color-text-primary)' : 'var(--color-bg-subtle)',
                                    color: filterStatus === st ? 'var(--color-bg-base)' : 'var(--color-text-secondary)',
                                    transition: 'all 0.15s'
                                }}
                            >
                                {st === 'all' ? 'All Models' : st === 'full_gpu' ? '⚡ Full GPU' : st === 'cpu_offload' ? '⏳ CPU Offload' : '☁️ Cloud'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Search Bar */}
                <div style={{ position: 'relative', marginBottom: 14 }}>
                    <input
                        type="text"
                        placeholder="Search models by name, size (e.g. 7b, 14b, qwen, llama, deepseek)..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%', padding: '9px 12px', borderRadius: 8,
                            backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                            color: 'var(--color-text-primary)', fontSize: 12.5
                        }}
                    />
                </div>

                {pullingModel && (
                    <div style={{ padding: '12px 16px', borderRadius: 10, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', marginBottom: 14, fontSize: 12 }}>
                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 4 }}>Pulling {pullingModel}...</div>
                        <div style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{pullProgress}</div>
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filteredModels.map(m => (
                        <div
                            key={m.model_id}
                            style={{
                                padding: '14px 18px', borderRadius: 12,
                                backgroundColor: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                gap: 16
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>{m.name}</span>
                                    <span style={{ fontSize: 10.5, padding: '1px 6px', borderRadius: 4, backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)' }}>
                                        {m.params_b}B
                                    </span>
                                    <span style={{
                                        fontSize: 10.5, fontWeight: 500, padding: '2px 7px', borderRadius: 5,
                                        backgroundColor: 'var(--color-bg-subtle)', border: '1px solid var(--color-border)',
                                        color: 'var(--color-text-secondary)'
                                    }}>
                                        {m.badge}
                                    </span>
                                </div>
                                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                                    {m.category} • Required VRAM: <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>{m.quantized_q4_vram_gb} GB (Q4)</span> / {m.raw_fp16_vram_gb} GB (FP16)
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                {m.predicted_tps > 0 ? (
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                                            ~{m.predicted_tps} <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--color-text-tertiary)' }}>tok/s</span>
                                        </div>
                                        <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
                                            {m.status === 'full_gpu' ? 'GPU' : 'CPU Offload'}
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                                        Cloud Required
                                    </div>
                                )}

                                {m.tags && m.tags[0] && (
                                    <button
                                        onClick={() => handlePullModel(m.tags[0].replace('ollama:', ''))}
                                        disabled={pullingModel === m.tags[0].replace('ollama:', '')}
                                        style={{
                                            padding: '6px 14px', borderRadius: 8,
                                            backgroundColor: 'var(--color-bg-subtle)',
                                            border: '1px solid var(--color-border)',
                                            color: 'var(--color-text-primary)',
                                            fontSize: 12, fontWeight: 500, cursor: 'pointer',
                                            transition: 'all 0.15s'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'}
                                        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--color-bg-subtle)'}
                                    >
                                        {pullingModel === m.tags[0].replace('ollama:', '') ? 'Pulling...' : 'Pull (Terminal)'}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};
