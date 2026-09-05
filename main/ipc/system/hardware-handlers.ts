import { ipcMain } from 'electron';
import * as os from 'os';

export const KNOWN_MODELS = [
  { model_id: "meta-llama/Llama-3.2-1B-Instruct", name: "Llama 3.2 1B", params_b: 1.2, raw_fp16_vram_gb: 2.47, quantized_q4_vram_gb: 0.88, quantized_q8_vram_gb: 1.45, min_ram_gb: 4, category: "Ultra-lightweight / Fast Edge", tags: ["llama3.2:1b", "llama3.2"] },
  { model_id: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B", params_b: 3.2, raw_fp16_vram_gb: 6.42, quantized_q4_vram_gb: 2.22, quantized_q8_vram_gb: 3.65, min_ram_gb: 6, category: "Compact / High Quality", tags: ["llama3.2:3b", "llama3.2"] },
  { model_id: "meta-llama/Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B", params_b: 8.0, raw_fp16_vram_gb: 16.06, quantized_q4_vram_gb: 5.34, quantized_q8_vram_gb: 9.10, min_ram_gb: 12, category: "Standard General Purpose", tags: ["llama3.1:8b", "llama3.1"] },
  { model_id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B v0.3", params_b: 7.2, raw_fp16_vram_gb: 14.50, quantized_q4_vram_gb: 4.16, quantized_q8_vram_gb: 8.20, min_ram_gb: 8, category: "Fast Instruction & Reasoning", tags: ["mistral:7b", "mistral"] },
  { model_id: "Qwen/Qwen2.5-Coder-1.5B-Instruct", name: "Qwen 2.5 Coder 1.5B", params_b: 1.5, raw_fp16_vram_gb: 3.08, quantized_q4_vram_gb: 1.08, quantized_q8_vram_gb: 1.78, min_ram_gb: 4, category: "Fast Coding Specialist", tags: ["qwen2.5-coder:1.5b", "qwen", "coder"] },
  { model_id: "Qwen/Qwen2.5-Coder-7B-Instruct", name: "Qwen 2.5 Coder 7B", params_b: 7.6, raw_fp16_vram_gb: 15.22, quantized_q4_vram_gb: 5.08, quantized_q8_vram_gb: 8.65, min_ram_gb: 10, category: "Flagship Coding Specialist", tags: ["qwen2.5-coder:7b", "qwen", "coder"] },
  { model_id: "Qwen/Qwen2.5-Coder-14B-Instruct", name: "Qwen 2.5 Coder 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.75, quantized_q8_vram_gb: 16.50, min_ram_gb: 16, category: "Heavy Coding & Autonomous", tags: ["qwen2.5-coder:14b", "qwen", "coder"] },
  { model_id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B", params_b: 32.5, raw_fp16_vram_gb: 65.00, quantized_q4_vram_gb: 20.40, quantized_q8_vram_gb: 36.20, min_ram_gb: 32, category: "State-of-the-Art Coding", tags: ["qwen2.5-coder:32b", "qwen", "coder"] },
  { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B", name: "DeepSeek R1 1.5B", params_b: 1.8, raw_fp16_vram_gb: 3.56, quantized_q4_vram_gb: 1.25, quantized_q8_vram_gb: 2.05, min_ram_gb: 4, category: "Compact Reasoning", tags: ["deepseek-r1:1.5b", "deepseek", "reasoning"] },
  { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", name: "DeepSeek R1 7B", params_b: 7.6, raw_fp16_vram_gb: 15.22, quantized_q4_vram_gb: 5.15, quantized_q8_vram_gb: 8.65, min_ram_gb: 12, category: "Advanced Reasoning", tags: ["deepseek-r1:7b", "deepseek", "reasoning"] },
  { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B", name: "DeepSeek R1 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.80, quantized_q8_vram_gb: 16.50, min_ram_gb: 16, category: "Deep Reasoning Specialist", tags: ["deepseek-r1:14b", "deepseek", "reasoning"] },
  { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B", name: "DeepSeek R1 32B", params_b: 32.8, raw_fp16_vram_gb: 65.60, quantized_q4_vram_gb: 21.20, quantized_q8_vram_gb: 36.80, min_ram_gb: 32, category: "Top-tier Math & Logic Reasoning", tags: ["deepseek-r1:32b", "deepseek", "reasoning"] },
  { model_id: "google/gemma-2-2b-it", name: "Gemma 2 2B", params_b: 2.6, raw_fp16_vram_gb: 5.22, quantized_q4_vram_gb: 1.78, quantized_q8_vram_gb: 2.95, min_ram_gb: 6, category: "Lightweight Google Research", tags: ["gemma2:2b", "gemma"] },
  { model_id: "google/gemma-2-9b-it", name: "Gemma 2 9B", params_b: 9.2, raw_fp16_vram_gb: 18.48, quantized_q4_vram_gb: 6.12, quantized_q8_vram_gb: 10.40, min_ram_gb: 12, category: "High Accuracy General Purpose", tags: ["gemma2:9b", "gemma"] },
  { model_id: "microsoft/phi-4", name: "Phi-4 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.70, quantized_q8_vram_gb: 16.50, min_ram_gb: 16, category: "Microsoft Synthetic Reasoning", tags: ["phi4:14b", "phi4"] },
  { model_id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B", params_b: 70.6, raw_fp16_vram_gb: 141.2, quantized_q4_vram_gb: 43.5, quantized_q8_vram_gb: 78.5, min_ram_gb: 64, category: "Enterprise Frontier Model", tags: ["llama3.1:70b", "llama"] }
];

// Fallback for Windows 11 24H2+ where wmic was removed (BK parity #4 / MP-CORR-21).
async function getGpuInfoViaCim(): Promise<{ name: string; vramBytes: number } | null> {
  try {
    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);
    // Get-CimInstance survives Win11 24H2+ where wmic was removed. Note: AdapterRAM is
    // uint32 even via CIM, so it saturates ≈4GiB for cards with more VRAM.
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_VideoController | Select-Object Name,@{N='Vram';E={$_.AdapterRAM}} | ConvertTo-Json -Compress`,
    ], { timeout: 8000, windowsHide: true });
    const parsed = JSON.parse(stdout);
    const entries = (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
    if (!entries.length) return null;
    const best = entries.reduce((acc: any, e: any) => (Number(e?.Vram ?? 0) > Number(acc?.Vram ?? 0) ? e : acc));
    return { name: String(best?.Name ?? ''), vramBytes: Number(best?.Vram ?? 0) };
  } catch {
    return null;
  }
}

function mergeCimGpuInfo(cim: { name: string; vramBytes: number } | null, gpuName: string, vramGB: number): { gpuName: string; vramGB: number; isNvidia: boolean } {
  if (cim && cim.name && (gpuName === 'Unknown GPU' || cim.name.toLowerCase().includes('nvidia') || cim.name.toLowerCase().includes('rtx'))) {
    gpuName = cim.name;
  }
  if (cim && cim.vramBytes > 0) {
    // ≥4GB reported as 4 (AdapterRAM is uint32-saturated; registry qwMemorySize would be
    // needed for exact). Treat saturation as a floor, not a ceiling, when gating models.
    if (cim.vramBytes >= 4026531840) {
      vramGB = Math.max(vramGB, 4);
    } else {
      vramGB = Math.max(vramGB, Math.round((cim.vramBytes / (1024 * 1024 * 1024)) * 10) / 10);
    }
  }
  const isNvidia = gpuName.toLowerCase().includes('nvidia') || gpuName.toLowerCase().includes('rtx') || gpuName.toLowerCase().includes('gtx');
  return { gpuName, vramGB, isNvidia };
}

export async function detectHardwareSpecsAsync() {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  const ramGB = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
  const freeRamGB = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
  const cpus = os.cpus() || [];
  const cpuModel = cpus[0]?.model ? cpus[0].model.trim() : 'Generic Processor';
  const cpuCores = cpus.length;
  const cpuSpeed = cpus[0]?.speed || 0;

  let gpuName = 'Unknown GPU';
  let vramGB = 0;
  let isNvidia = false;
  let isAppleSilicon = false;
  let driverVersion = '';
  let gpuTemp = 0;

  try {
    if (process.platform === 'win32') {
      try {
        const { stdout: nvsmi } = await execAsync('nvidia-smi --query-gpu=name,memory.total,driver_version,temperature.gpu --format=csv,noheader,nounits', { timeout: 3000 });
        const parts = nvsmi.trim().split(',');
        if (parts.length >= 2) {
          gpuName = parts[0].trim();
          const mb = parseInt(parts[1].trim(), 10);
          if (!isNaN(mb)) vramGB = Math.round((mb / 1024) * 10) / 10;
          if (parts[2]) driverVersion = parts[2].trim();
          if (parts[3]) gpuTemp = parseInt(parts[3].trim(), 10) || 0;
          isNvidia = true;
        }
      } catch {
        let wmicResolved = false;
        try {
          const { stdout } = await execAsync('wmic path Win32_VideoController get AdapterRAM,Name,DriverVersion /format:list', { timeout: 3000 });
          for (const line of stdout.split('\n')) {
            const trimmed = line.trim();
            if (trimmed.startsWith('AdapterRAM=')) {
              const bytes = parseInt(trimmed.substring(11), 10);
              if (!isNaN(bytes) && bytes > 0) vramGB = Math.max(vramGB, Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10);
            } else if (trimmed.startsWith('Name=')) {
              const name = trimmed.substring(5).trim();
              if (name && (gpuName === 'Unknown GPU' || name.toLowerCase().includes('nvidia') || name.toLowerCase().includes('rtx'))) {
                gpuName = name;
              }
            } else if (trimmed.startsWith('DriverVersion=')) {
              driverVersion = trimmed.substring(14).trim();
            }
          }
          isNvidia = gpuName.toLowerCase().includes('nvidia') || gpuName.toLowerCase().includes('rtx') || gpuName.toLowerCase().includes('gtx');
          wmicResolved = gpuName !== 'Unknown GPU' || vramGB > 0;
        } catch {}
        if (!wmicResolved) {
          ({ gpuName, vramGB, isNvidia } = mergeCimGpuInfo(await getGpuInfoViaCim(), gpuName, vramGB));
        }
      }
    } else if (process.platform === 'darwin') {
      try {
        const { stdout } = await execAsync('system_profiler SPDisplaysDataType', { timeout: 4000 });
        isAppleSilicon = stdout.includes('Apple M') || (os.cpus()[0]?.model || '').includes('Apple');
        const chipsetMatch = stdout.match(/Chipset Model:\s*(.+)/);
        gpuName = chipsetMatch ? chipsetMatch[1].trim() : (isAppleSilicon ? 'Apple Silicon' : 'Intel/AMD Mac');
        if (isAppleSilicon) {
          vramGB = Math.round(ramGB * 0.75 * 10) / 10;
        } else {
          const vramMatch = stdout.match(/VRAM \(Total\):\s*(\d+)\s*(MB|GB)/i) || stdout.match(/VRAM:\s*(\d+)\s*(MB|GB)/i);
          if (vramMatch) {
            const val = parseInt(vramMatch[1], 10);
            const unit = vramMatch[2].toUpperCase();
            vramGB = unit === 'GB' ? val : Math.round((val / 1024) * 10) / 10;
          }
        }
      } catch {}
    } else if (process.platform === 'linux') {
      try {
        const { stdout } = await execAsync('nvidia-smi --query-gpu=name,memory.total,driver_version,temperature.gpu --format=csv,noheader,nounits', { timeout: 3000 });
        const parts = stdout.trim().split(',');
        if (parts.length >= 2) {
          gpuName = parts[0].trim();
          const mb = parseInt(parts[1].trim(), 10);
          if (!isNaN(mb)) vramGB = Math.round((mb / 1024) * 10) / 10;
          if (parts[2]) driverVersion = parts[2].trim();
          if (parts[3]) gpuTemp = parseInt(parts[3].trim(), 10) || 0;
          isNvidia = true;
        }
      } catch {}
    }
  } catch {}

  return {
    ramGB,
    freeRamGB,
    cpuModel,
    cpuCores,
    cpuSpeed,
    gpuName,
    vramGB,
    isNvidia,
    isAppleSilicon,
    driverVersion,
    gpuTemp
  };
}

export function enrichModelWithHardware(m: any, hardware: { vramGB: number; ramGB: number; isAppleSilicon?: boolean }) {
  const vram = Number(hardware.vramGB || 0);
  const ram = Number(hardware.ramGB || 16);
  const effectiveVram = hardware.isAppleSilicon ? Math.max(vram, ram * 0.75) : vram;
  const bw = effectiveVram >= 8 ? 360 : (effectiveVram >= 4 ? 240 : 45);

  const q4 = Number(m.quantized_q4_vram_gb || 4);
  let status: 'full_gpu' | 'cpu_offload' | 'exceeds_specs' = 'exceeds_specs';
  let badge = 'Cloud Required';
  let predicted_tps = 0;

  if (effectiveVram >= q4) {
    status = 'full_gpu';
    badge = 'Full GPU';
    predicted_tps = Math.round((bw / Math.max(q4, 0.5)) * 0.75 * 10) / 10;
  } else if ((effectiveVram + (ram * 0.5)) >= q4 && ram >= (m.min_ram_gb || 4)) {
    status = 'cpu_offload';
    badge = 'CPU Offload';
    predicted_tps = Math.round((35 / Math.max(q4, 0.5)) * 0.65 * 10) / 10;
  }

  const isSmooth = predicted_tps >= 15;
  const smoothRating = predicted_tps >= 30 ? '🚀 Ultra Smooth' : (predicted_tps >= 20 ? '⚡ Smooth & Fast' : (predicted_tps >= 10 ? '⚡ Good Performance' : '🐢 Slower CPU Offload'));

  return {
    ...m,
    status,
    badge,
    predicted_tps,
    isSmooth,
    smoothRating,
    fits_in_vram: effectiveVram >= q4,
    fits_in_ram: ram >= (m.min_ram_gb || 4),
    isRunnable: status !== 'exceeds_specs'
  };
}

export function registerHardwareHandlers(): void {
  ipcMain.handle('system:detect-hardware', async () => {
    return await detectHardwareSpecsAsync();
  });

  ipcMain.handle('system:get-model-requirements', async (_event, params?: { vramGB?: number; ramGB?: number; isAppleSilicon?: boolean; gpuName?: string; search?: string; modelId?: string }) => {
    let vramGB = Number(params?.vramGB);
    let ramGB = Number(params?.ramGB);
    let isAppleSilicon = Boolean(params?.isAppleSilicon);
    let gpuName = params?.gpuName || '';
    const search = (params?.search || '').toLowerCase().trim();
    const modelId = params?.modelId || '';

    // If hardware specs not provided, detect them asynchronously
    if (isNaN(vramGB) || isNaN(ramGB)) {
      const hw = await detectHardwareSpecsAsync();
      vramGB = hw.vramGB;
      ramGB = hw.ramGB;
      isAppleSilicon = hw.isAppleSilicon;
      gpuName = hw.gpuName;
    }

    console.log(`\n[EverFern Desktop] [IPC:system:get-model-requirements] 🖥️ Hardware: VRAM=${vramGB}GB, RAM=${ramGB}GB, AppleSilicon=${isAppleSilicon}, GPU='${gpuName}', Search='${search}', ModelId='${modelId}'`);

    const hwSpecs = { vramGB, ramGB, isAppleSilicon };

    // If single model requested
    if (modelId) {
      const matched = KNOWN_MODELS.find(m => m.model_id.toLowerCase() === modelId.toLowerCase() || m.name.toLowerCase() === modelId.toLowerCase());
      if (matched) {
        return { success: true, ...enrichModelWithHardware(matched, hwSpecs) };
      }

      // Query Hugging Face metadata
      try {
        const https = require('https');
        const fetchHf = (url: string): Promise<any> => new Promise((resolve, reject) => {
          https.get(url, { headers: { 'User-Agent': 'EverFern-Desktop' } }, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
          }).on('error', reject);
        });

        const hfData = await fetchHf(`https://huggingface.co/api/models/${encodeURIComponent(modelId)}`);
        if (hfData && !hfData.error) {
          const totalParams = hfData.safetensors?.total;
          let paramsB = totalParams ? (totalParams / 1e9) : 0;
          
          if (!paramsB && hfData.config) {
            const hidden = hfData.config.hidden_size || hfData.config.d_model || hfData.config.dim;
            const layers = hfData.config.num_hidden_layers || hfData.config.num_layers || hfData.config.n_layer;
            const vocab = hfData.config.vocab_size || 32000;
            const inter = hfData.config.intermediate_size || (hidden ? hidden * 4 : 0);
            if (hidden && layers) {
              const layerParams = layers * (4 * (hidden ** 2) + 2 * (hidden * inter));
              const embedParams = 2 * (vocab * hidden);
              paramsB = (layerParams + embedParams) / 1e9;
            }
          }

          if (!paramsB && Array.isArray(hfData.siblings)) {
            const totalBytes = hfData.siblings.filter((s: any) => s.rfilename && (s.rfilename.endsWith('.safetensors') || s.rfilename.endsWith('.bin') || s.rfilename.endsWith('.gguf'))).reduce((acc: number, s: any) => acc + (s.size || 0), 0);
            if (totalBytes > 0) {
              paramsB = (totalBytes / (1024 ** 3)) / 2.3;
            }
          }

          if (paramsB > 0) {
            paramsB = Math.round(paramsB * 100) / 100;
            const rawFp16 = Math.round((paramsB * 2 * 1.15) * 100) / 100;
            const q4 = Math.round((paramsB * 0.5 * 1.15) * 100) / 100;
            const q8 = Math.round((paramsB * 1.0 * 1.15) * 100) / 100;
            return {
              success: true,
              ...enrichModelWithHardware({
                model_id: modelId,
                name: modelId.split('/').pop() || modelId,
                params_b: paramsB,
                raw_fp16_vram_gb: rawFp16,
                quantized_q4_vram_gb: q4,
                quantized_q8_vram_gb: q8,
                category: "Hugging Face Hub Model",
                tags: [modelId]
              }, hwSpecs)
            };
          }
        }
      } catch (err) {
        console.error('[IPC:system:get-model-requirements] Error fetching from HF:', err);
      }

      // Not found on Hugging Face Hub - DO NOT show fake data
      return {
        success: false,
        notFound: true,
        error: `Model repository "${modelId}" was not found on Hugging Face Hub. Please check the repository ID or ensure it is public.`,
        model: modelId
      };
    }

    let models = KNOWN_MODELS.map(m => enrichModelWithHardware(m, hwSpecs));

    if (search) {
      let filtered = models.filter(m =>
        m.name.toLowerCase().includes(search) ||
        m.model_id.toLowerCase().includes(search) ||
        m.category.toLowerCase().includes(search) ||
        (m.tags && m.tags.some((t: string) => t.toLowerCase().includes(search)))
      );

      if (filtered.length < 3 && search.length >= 2) {
        try {
          const https = require('https');
          const fetchHfSearch = (url: string): Promise<any[]> => new Promise((resolve, reject) => {
            https.get(url, { headers: { 'User-Agent': 'EverFern-Desktop' } }, (res: any) => {
              let data = '';
              res.on('data', (chunk: any) => data += chunk);
              res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { resolve([]); }
              });
            }).on('error', () => resolve([]));
          });

          const hfResults = await fetchHfSearch(`https://huggingface.co/api/models?search=${encodeURIComponent(search)}&limit=6`);
          if (Array.isArray(hfResults)) {
            const seen = new Set(filtered.map(f => f.model_id.toLowerCase()));
            for (const item of hfResults) {
              const id = item.id || item.modelId;
              if (id && !seen.has(id.toLowerCase())) {
                const paramsB = parseFloat((id.match(/(\d+(?:\.\d+)?)[bB]/) || ['', '7'])[1]);
                const rawFp16 = Math.round(paramsB * 2 * 1.15 * 100) / 100;
                const q4 = Math.round((rawFp16 / 4) * 1.15 * 100) / 100;
                filtered.push(enrichModelWithHardware({
                  model_id: id,
                  name: id.split('/').pop() || id,
                  params_b: paramsB,
                  raw_fp16_vram_gb: rawFp16,
                  quantized_q4_vram_gb: q4,
                  quantized_q8_vram_gb: Math.round(q4 * 2 * 100) / 100,
                  category: "Hugging Face Hub Model",
                  tags: [id]
                }, hwSpecs));
                seen.add(id.toLowerCase());
              }
            }
          }
        } catch {}
      }
      models = filtered;
    }

    console.log(`[EverFern Desktop] [IPC:system:get-model-requirements] 🚀 Returning ${models.length} compatible models.`);
    return {
      success: true,
      models
    };
  });

  ipcMain.handle('system:get-local-models', async (_event, params?: { provider?: string; baseUrl?: string }) => {
    const provider = String(params?.provider || 'ollama').toLowerCase();
    const defaultUrl = provider === 'lmstudio' ? 'http://localhost:1234/v1' : 'http://localhost:11434';
    const baseUrl = (params?.baseUrl && params.baseUrl.trim()) ? params.baseUrl.trim().replace(/\/$/, '') : defaultUrl;

    console.log(`\n[EverFern Desktop] [IPC:system:get-local-models] Querying local provider '${provider}' at '${baseUrl}'...`);

    // 1. Detect hardware for exact VRAM and TPS calculations
    let hardware: any = null;
    try {
      const ramGB = Math.round((os.totalmem() / (1024 * 1024 * 1024)) * 10) / 10;
      const freeRamGB = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
      const cpus = os.cpus() || [];
      const cpuModel = cpus[0]?.model ? cpus[0].model.trim() : 'Generic Processor';
      const cpuCores = cpus.length;
      let gpuName = 'Unknown GPU';
      let vramGB = 0;
      let isNvidia = false;
      let isAppleSilicon = false;

      if (process.platform === 'darwin') {
        const { execSync } = require('child_process');
        try {
          const stdout = execSync('system_profiler SPDisplaysDataType', { encoding: 'utf8' });
          isAppleSilicon = stdout.includes('Apple M') || (os.cpus()[0]?.model || '').includes('Apple');
          const chipsetMatch = stdout.match(/Chipset Model:\s*(.+)/);
          gpuName = chipsetMatch ? chipsetMatch[1].trim() : (isAppleSilicon ? 'Apple Silicon' : 'Intel/AMD Mac');
          vramGB = isAppleSilicon ? Math.round(ramGB * 0.75 * 10) / 10 : 0;
        } catch {}
      } else if (process.platform === 'win32') {
        const { execSync } = require('child_process');
        try {
          const stdout = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { encoding: 'utf8' });
          const parts = stdout.trim().split(',');
          if (parts.length >= 2) {
            gpuName = parts[0].trim();
            const mb = parseInt(parts[1].trim(), 10);
            if (!isNaN(mb)) vramGB = Math.round((mb / 1024) * 10) / 10;
            isNvidia = true;
          }
        } catch {
          let wmicResolved = false;
          try {
            const stdout = execSync('wmic path Win32_VideoController get AdapterRAM,Name /format:list', { encoding: 'utf8' });
            for (const line of stdout.split('\n')) {
              const trimmed = line.trim();
              if (trimmed.startsWith('AdapterRAM=')) {
                const bytes = parseInt(trimmed.substring(11), 10);
                if (!isNaN(bytes) && bytes > 0) vramGB = Math.max(vramGB, Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10);
              } else if (trimmed.startsWith('Name=')) {
                const name = trimmed.substring(5).trim();
                if (name && (gpuName === 'Unknown GPU' || name.toLowerCase().includes('nvidia') || name.toLowerCase().includes('rtx'))) {
                  gpuName = name;
                }
              }
            }
            wmicResolved = gpuName !== 'Unknown GPU' || vramGB > 0;
          } catch {}
          if (!wmicResolved) {
            ({ gpuName, vramGB, isNvidia } = mergeCimGpuInfo(await getGpuInfoViaCim(), gpuName, vramGB));
          }
        }
      }

      hardware = {
        ramGB,
        freeRamGB,
        cpuModel,
        cpuCores,
        gpuName,
        vramGB,
        isNvidia,
        isAppleSilicon,
      };
    } catch (e) {
      hardware = {
        ramGB: 16,
        freeRamGB: 8,
        cpuModel: 'CPU Processor',
        cpuCores: 8,
        gpuName: 'Default GPU',
        vramGB: 4,
        isNvidia: false,
        isAppleSilicon: false
      };
    }

    const vram = Number(hardware.vramGB || 0);
    const ram = Number(hardware.ramGB || 16);
    const isApple = Boolean(hardware.isAppleSilicon);
    const effectiveVram = isApple ? Math.max(vram, ram * 0.75) : vram;
    const bw = effectiveVram >= 8 ? 360 : (effectiveVram >= 4 ? 240 : 45);

    const enrichAnyModel = (m: any) => {
      const q4 = Number(m.quantized_q4_vram_gb || 4);
      let status: 'full_gpu' | 'cpu_offload' | 'exceeds_specs' = 'exceeds_specs';
      let badge = 'Cloud Required';
      let predicted_tps = 0;

      if (effectiveVram >= q4) {
        status = 'full_gpu';
        badge = 'Full GPU';
        predicted_tps = Math.round((bw / Math.max(q4, 0.5)) * 0.75 * 10) / 10;
      } else if ((effectiveVram + (ram * 0.5)) >= q4 && ram >= (m.min_ram_gb || 4)) {
        status = 'cpu_offload';
        badge = 'CPU Offload';
        predicted_tps = Math.round((35 / Math.max(q4, 0.5)) * 0.65 * 10) / 10;
      }

      const isRunnable = status !== 'exceeds_specs' && (effectiveVram + (ram * 0.5)) >= q4;
      const isSmooth = predicted_tps >= 18;
      let smoothRating = 'Slow (CPU Offload)';
      if (predicted_tps >= 30) smoothRating = 'Ultra Smooth';
      else if (predicted_tps >= 20) smoothRating = 'Smooth & Fast';
      else if (predicted_tps >= 10) smoothRating = 'Good Performance';
      else if (predicted_tps > 0) smoothRating = 'Moderate (CPU Offload)';

      return {
        ...m,
        status,
        badge,
        predicted_tps,
        smoothRating,
        isSmooth,
        isRunnable,
        fits_in_vram: effectiveVram >= q4,
        fits_in_ram: ram >= (m.min_ram_gb || 4)
      };
    };

    // Calculate AI recommended models
    const KNOWN_RECOMMENDED = [
      { model_id: "Qwen/Qwen2.5-Coder-7B-Instruct", name: "Qwen 2.5 Coder 7B", params_b: 7.6, raw_fp16_vram_gb: 15.22, quantized_q4_vram_gb: 5.08, min_ram_gb: 8, category: "Flagship Coding Specialist", tags: ["qwen2.5-coder:7b", "qwen2.5-coder"] },
      { model_id: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B", params_b: 3.2, raw_fp16_vram_gb: 6.42, quantized_q4_vram_gb: 2.22, min_ram_gb: 6, category: "Compact / High Speed", tags: ["llama3.2:3b", "llama3.2"] },
      { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B", name: "DeepSeek R1 7B", params_b: 7.6, raw_fp16_vram_gb: 15.22, quantized_q4_vram_gb: 5.15, min_ram_gb: 8, category: "Advanced Reasoning Specialist", tags: ["deepseek-r1:7b", "deepseek-r1"] },
      { model_id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B v0.3", params_b: 7.2, raw_fp16_vram_gb: 14.50, quantized_q4_vram_gb: 4.16, min_ram_gb: 8, category: "Fast Instruction & Reasoning", tags: ["mistral:7b", "mistral"] },
      { model_id: "Qwen/Qwen2.5-Coder-1.5B-Instruct", name: "Qwen 2.5 Coder 1.5B", params_b: 1.5, raw_fp16_vram_gb: 3.08, quantized_q4_vram_gb: 1.08, min_ram_gb: 4, category: "Ultra-Fast Lightweight Coding", tags: ["qwen2.5-coder:1.5b"] },
      { model_id: "meta-llama/Llama-3.2-1B-Instruct", name: "Llama 3.2 1B", params_b: 1.2, raw_fp16_vram_gb: 2.47, quantized_q4_vram_gb: 0.88, min_ram_gb: 4, category: "Ultra-Lightweight Edge", tags: ["llama3.2:1b"] },
      { model_id: "Qwen/Qwen2.5-Coder-14B-Instruct", name: "Qwen 2.5 Coder 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.75, min_ram_gb: 16, category: "Heavy Coding & Autonomous", tags: ["qwen2.5-coder:14b"] },
      { model_id: "deepseek-ai/DeepSeek-R1-Distill-Qwen-14B", name: "DeepSeek R1 14B", params_b: 14.7, raw_fp16_vram_gb: 29.40, quantized_q4_vram_gb: 9.80, min_ram_gb: 16, category: "Deep Math & Logic Reasoning", tags: ["deepseek-r1:14b"] },
      { model_id: "google/gemma-2-9b-it", name: "Gemma 2 9B", params_b: 9.2, raw_fp16_vram_gb: 18.48, quantized_q4_vram_gb: 6.12, min_ram_gb: 12, category: "High Accuracy General Purpose", tags: ["gemma2:9b"] },
    ];

    const recommendedModels = KNOWN_RECOMMENDED.map(enrichAnyModel);

    // 2. Query the active local provider
    const installedModels: any[] = [];
    let isRunning = false;
    let providerError = '';

    if (provider === 'ollama') {
      try {
        const http = baseUrl.startsWith('https:') ? require('https') : require('http');
        const fetchOllama = (url: string): Promise<any> => new Promise((resolve, reject) => {
          const req = http.get(url, { timeout: 3000 }, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
        });

        const data = await fetchOllama(`${baseUrl}/api/tags`);
        if (data && Array.isArray(data.models)) {
          isRunning = true;
          for (const m of data.models) {
            const rawName = String(m.name || m.model || '');
            if (!rawName) continue;
            let paramB = 7;
            const paramMatch = rawName.match(/(\d+(?:\.\d+)?)[bB]/);
            if (paramMatch) paramB = parseFloat(paramMatch[1]);
            else if (m.details?.parameter_size) {
              const dMatch = String(m.details.parameter_size).match(/(\d+(?:\.\d+)?)/);
              if (dMatch) paramB = parseFloat(dMatch[1]);
            } else if (m.size) {
              paramB = Math.max(1, Math.round((m.size / (1024 * 1024 * 1024) / 0.65) * 10) / 10);
            }

            const sizeGB = m.size ? Math.round((m.size / (1024 * 1024 * 1024)) * 100) / 100 : Math.round(paramB * 0.65 * 100) / 100;
            const q4 = Math.round(Math.max(sizeGB, paramB * 0.55) * 100) / 100;
            const rawFp16 = Math.round(paramB * 2 * 100) / 100;

            const enriched = enrichAnyModel({
              id: rawName,
              model_id: rawName,
              name: rawName,
              params_b: paramB,
              size_gb: sizeGB,
              quantized_q4_vram_gb: q4,
              raw_fp16_vram_gb: rawFp16,
              min_ram_gb: Math.max(4, Math.round(paramB * 1.1)),
              category: "Installed Local Model",
              tags: [rawName],
              details: m.details,
              modified_at: m.modified_at
            });
            installedModels.push(enriched);
          }
        }
      } catch (err: any) {
        providerError = `Could not connect to Ollama at ${baseUrl}. Ensure Ollama is running.`;
      }
    } else if (provider === 'lmstudio') {
      try {
        const http = baseUrl.startsWith('https:') ? require('https') : require('http');
        const urlToFetch = baseUrl.endsWith('/v1') ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
        const fetchLm = (url: string): Promise<any> => new Promise((resolve, reject) => {
          const req = http.get(url, { timeout: 3000 }, (res: any) => {
            let data = '';
            res.on('data', (chunk: any) => data += chunk);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('Connection timed out')); });
        });

        const data = await fetchLm(urlToFetch);
        const rawList = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : []));
        if (rawList && rawList.length > 0) {
          isRunning = true;
          for (const m of rawList) {
            const rawId = typeof m === 'string' ? m : (m.id || m.name || '');
            if (!rawId) continue;
            let paramB = 7;
            const paramMatch = rawId.match(/(\d+(?:\.\d+)?)[bB]/);
            if (paramMatch) paramB = parseFloat(paramMatch[1]);
            const q4 = Math.round((paramB * 0.58 + 0.5) * 100) / 100;
            const rawFp16 = Math.round(paramB * 2 * 100) / 100;

            const enriched = enrichAnyModel({
              id: rawId,
              model_id: rawId,
              name: rawId.split('/').pop() || rawId,
              params_b: paramB,
              quantized_q4_vram_gb: q4,
              raw_fp16_vram_gb: rawFp16,
              min_ram_gb: Math.max(4, Math.round(paramB * 1.1)),
              category: "LM Studio Loaded Model",
              tags: [rawId]
            });
            installedModels.push(enriched);
          }
        } else if (data && (data.data || data.models)) {
          isRunning = true;
        }
      } catch (err: any) {
        providerError = `Could not reach LM Studio at ${baseUrl}. Make sure LM Studio Local Server is started.`;
      }
    }

    return {
      success: isRunning,
      running: isRunning,
      provider,
      baseUrl,
      hardware,
      installedModels,
      recommendedModels,
      error: isRunning ? undefined : providerError
    };
  });
}
