import { ipcMain, dialog, shell, Notification, app, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { memorySaveTool } from '../agent/tools/memory-save';
import { ensureDockerContainer } from '../agent/tools/linux-vm-executor';

function imageMimeFromPath(filePath: string): string | null {
  const ext = path.extname(filePath).replace(/^\./, '').toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon',
    svg: 'image/svg+xml',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };
  return map[ext] || null;
}

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
        } catch {}
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

export function registerSystemHandlers() {
  ipcMain.handle('system:checkWSL', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      // Fast check 1: list installed distros (stripping potential UTF-16 null bytes)
      try {
        const { stdout: listOut } = await execAsync('wsl.exe -l -q', { timeout: 4000 });
        const cleaned = listOut ? listOut.replace(/\x00/g, '').trim() : '';
        if (cleaned.length > 0) return true;
      } catch {}

      // Fast check 2: status
      try {
        const { stdout: statusOut } = await execAsync('wsl.exe --status', { timeout: 4000 });
        const cleaned = statusOut ? statusOut.replace(/\x00/g, '').trim() : '';
        if (cleaned.length > 0 && !cleaned.toLowerCase().includes('not installed')) return true;
      } catch {}

      // Responsive check 3: echo test
      try {
        const { stdout } = await execAsync('wsl.exe -e echo ok', { timeout: 8000 });
        if (stdout && stdout.includes('ok')) return true;
      } catch {}

      return false;
    } catch {
      return false;
    }
  });

  ipcMain.handle('system:checkDocker', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      await execAsync('docker info', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('system:getWSLInfo', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // Check if it's responsive at all
      await execAsync('wsl.exe -e echo ok', { timeout: 5000 });
      
      let osName = 'Unknown Linux OS';
      let uptime = 'Unknown';
      try {
        const { stdout: osRelease } = await execAsync('wsl.exe -e cat /etc/os-release', { encoding: 'utf8', timeout: 5000 });
        const nameMatch = osRelease.match(/PRETTY_NAME="([^"]+)"/);
        if (nameMatch) osName = nameMatch[1];
      } catch {}
      try {
        const { stdout: up } = await execAsync('wsl.exe -e uptime -p', { encoding: 'utf8', timeout: 5000 });
        if (up && up.trim()) uptime = up.trim();
      } catch {}

      return {
        healthy: true,
        osName,
        uptime
      };
    } catch (err: any) {
      return {
        healthy: false,
        error: err.message
      };
    }
  });

  ipcMain.handle('system:installWSL', async () => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    try {
      console.log('[WSL Installer] Attempting to install default Ubuntu on WSL...');
      await execAsync('wsl.exe --install -d Ubuntu --no-launch', { timeout: 180000 });
      return { success: true };
    } catch (err: any) {
      console.warn('[WSL Installer] Primary install failed, attempting elevated PowerShell install:', err);
      try {
        await execAsync('powershell -Command "Start-Process wsl.exe -ArgumentList \'--install -d Ubuntu --no-launch\' -Verb RunAs -Wait"', { timeout: 180000 });
        return { success: true };
      } catch (elevatedErr: any) {
        console.error('[WSL Installer] Elevated install also failed:', elevatedErr);
        return { success: false, error: elevatedErr.message || err.message };
      }
    }
  });

  ipcMain.handle('system:setupDockerUbuntu', async () => {
    try {
      await ensureDockerContainer();
      return { success: true };
    } catch (err: any) {
      console.error('[Docker Installer] Container setup failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:toHostPath', async (_event, pathStr: string) => {
    const { toHostPath } = require('../agent/tools/linux-vm-executor');
    return toHostPath(pathStr);
  });

  ipcMain.handle('system:get-version', () => {
    return app.getVersion();
  });

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
          } catch {}
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

  ipcMain.handle('system:check-for-updates', async () => {
    try {
      const { autoUpdater } = require('electron-updater');
      const result = await autoUpdater.checkForUpdates();

      if (result && result.updateInfo && result.updateInfo.version !== app.getVersion()) {
        return {
          hasUpdate: true,
          latestVersion: result.updateInfo.version,
          notes: typeof result.updateInfo.releaseNotes === 'string' ? result.updateInfo.releaseNotes : ''
        };
      }
      return { hasUpdate: false };
    } catch (err) {
      console.error('[UpdateCheck] Failed to check for updates:', err);
      return { hasUpdate: false, error: String(err) };
    }
  });

  ipcMain.handle('system:open-file-picker', async (_event, options?: { filters?: { name: string, extensions: string[] }[] }) => {
    console.log('[IPC] system:open-file-picker called with options:', options);

    const mainWindow = (global as any).mainWindow;
    if (!mainWindow) {
      console.error('[IPC] system:open-file-picker: mainWindow not available');
      return { success: false, error: 'Main window not available' };
    }

    try {
      console.log('[IPC] Opening file dialog...');
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: options?.filters || [
          { name: 'All Files', extensions: ['*'] },
          { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
          { name: 'Text & Documents', extensions: ['txt', 'md', 'json', 'csv', 'js', 'ts', 'py', 'log', 'html', 'css'] }
        ]
      });

      console.log('[IPC] Dialog result - canceled:', canceled, 'filePaths:', filePaths);

      if (canceled || filePaths.length === 0) {
        console.log('[IPC] User canceled or no file selected');
        return { success: false, canceled: true };
      }

      const originalFilePath = filePaths[0];
      console.log('[IPC] Processing file:', originalFilePath);

      const stats = fs.statSync(originalFilePath);
      const ext = path.extname(originalFilePath).toLowerCase();
      const ONE_GB = 1073741824;

      // Copy to ~/.everfern/attachments (host)
      const attachmentsDir = path.join(os.homedir(), '.everfern', 'attachments');
      if (!fs.existsSync(attachmentsDir)) {
        fs.mkdirSync(attachmentsDir, { recursive: true });
      }
      const safeFileName = `${Date.now()}-${path.basename(originalFilePath)}`;
      const newFilePath = path.join(attachmentsDir, safeFileName);
      fs.copyFileSync(originalFilePath, newFilePath);
      console.log('[IPC] File copied to:', newFilePath);

      // Clone to Linux VM (WSL) for fast VM-side access — skip files >1GB
      if (stats.size <= ONE_GB) {
        try {
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          // First check if WSL is available
          let wslCmd = 'wsl.exe';
          try {
            await execAsync('where wsl.exe', { timeout: 3000 });
          } catch {
            try {
              await execAsync('wsl -e echo ok', { timeout: 5000 });
              wslCmd = 'wsl';
            } catch {
              throw new Error('WSL not available, skipping clone');
            }
          }
          const wslUsername = (os.userInfo().username || 'user').toLowerCase();
          const wslAttachmentsDir = `/everfern`;
          // Build WSL path from Windows path — keep drive letter lowercase, rest preserves case (WSL mounts /mnt/c/ case-sensitively)
          const driveLetter = path.parse(newFilePath).root.replace(':', '').toLowerCase();
          const wslRelPath = newFilePath.replace(/^[A-Za-z]:\\/, '').replace(/\\/g, '/');
          const wslSourcePath = `/mnt/${driveLetter}/${wslRelPath}`;
          console.log(`[IPC] Cloning to WSL: ${wslSourcePath} -> ${wslAttachmentsDir}/`);
          // Create dir and copy via WSL
          await execAsync(`${wslCmd} --exec bash -c "mkdir -p ${wslAttachmentsDir} && cp '${wslSourcePath}' '${wslAttachmentsDir}/'"`, { timeout: 30000 });
          console.log('[IPC] File cloned to WSL:', `${wslAttachmentsDir}/${safeFileName}`);
        } catch (cloneErr: any) {
          console.warn(`[IPC] Failed to clone file to WSL (non-fatal): ${cloneErr.message}`);
        }
      } else {
        console.log('[IPC] File >1GB, skipping WSL clone. Accessible via /mnt/c/ path.');
      }

      const MAX_TEXT_PREVIEW_BYTES = 256 * 1024; // 256KB max preview
      const MAX_INLINE_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB max inline base64

      let mimeType = 'application/octet-stream';
      if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
        mimeType = `image/${ext === '.jpg' ? 'jpeg' : ext.slice(1)}`;
        if (stats.size <= MAX_INLINE_IMAGE_BYTES) {
          const base64 = fs.readFileSync(newFilePath).toString('base64');
          const uri = `data:${mimeType};base64,${base64}`;
          console.log('[IPC] Returning inline image file, size:', stats.size);
          return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType, base64: uri, success: true };
        }
        console.log('[IPC] Image too large for base64 inline, returning path reference, size:', stats.size);
        return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType, success: true };
      } else {
        let content = '';
        if (stats.size <= MAX_TEXT_PREVIEW_BYTES) {
          content = fs.readFileSync(newFilePath, 'utf-8');
        } else {
          const buffer = Buffer.alloc(MAX_TEXT_PREVIEW_BYTES);
          const fd = fs.openSync(newFilePath, 'r');
          fs.readSync(fd, buffer, 0, MAX_TEXT_PREVIEW_BYTES, 0);
          fs.closeSync(fd);
          content = buffer.toString('utf-8') + '\n\n... [File preview truncated for memory safety. Full file accessible at path]';
        }
        console.log('[IPC] Returning bounded text preview, original size:', stats.size);
        return { path: newFilePath, name: path.basename(originalFilePath), size: stats.size, mimeType: 'text/plain', content, success: true };
      }
    } catch (err: any) {
      console.error('[IPC] Error in open-file-picker:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:open-folder-picker', async () => {
    const mainWindow = (global as any).mainWindow;
    if (!mainWindow) return null;
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    const folderPath = filePaths[0];
    try {
      const stats = fs.statSync(folderPath);
      if (!stats.isDirectory()) return { success: false, error: 'Selected path is not a folder.' };
      return { path: folderPath, name: path.basename(folderPath), success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:to-host-path', (_event, pathStr: string) => {
    try {
      const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
      return translateLinuxPathToHost(pathStr);
    } catch {
      return pathStr;
    }
  });

  ipcMain.handle('system:open-folder', async (_event, folderPath: string) => {
    if (folderPath) {
      try {
        const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
        const hostPath = translateLinuxPathToHost(folderPath);
        shell.openPath(hostPath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'Folder not found' };
  });

  function getOllamaBinary(): string {
    const isWin = process.platform === 'win32';
    if (isWin) {
      const home = os.homedir();
      const ollamaPath = path.join(home, 'AppData', 'Local', 'Programs', 'ollama', 'ollama.exe');
      if (fs.existsSync(ollamaPath)) return ollamaPath;
      return 'ollama';
    }
    const isMac = process.platform === 'darwin';
    if (isMac) {
      const siliconPath = '/opt/homebrew/bin/ollama';
      const intelPath = '/usr/local/bin/ollama';
      if (fs.existsSync(siliconPath)) return siliconPath;
      if (fs.existsSync(intelPath)) return intelPath;
      return 'ollama';
    }
    const linuxPaths = ['/usr/local/bin/ollama', '/usr/bin/ollama'];
    for (const p of linuxPaths) {
      if (fs.existsSync(p)) return p;
    }
    return 'ollama';
  }

  ipcMain.handle('system:ollama-status', async () => {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const bin = getOllamaBinary();

      // Check if Ollama is installed
      try {
        await execAsync(`"${bin}" -v`);
      } catch {
        return { installed: false, modelInstalled: false };
      }

      // Check if the specific model is pulled
      try {
        const { stdout } = await execAsync(`"${bin}" list`, { encoding: 'utf8' });
        const modelInstalled = stdout.includes('qwen3-vl:2b');
        return { installed: true, modelInstalled };
      } catch {
        return { installed: true, modelInstalled: false };
      }
    } catch {
      return { installed: false, modelInstalled: false };
    }
  });

  ipcMain.handle('system:ollama-install', async (event) => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');

      // Switch command based on platform
      const isWin = process.platform === 'win32';
      const shellCmd = isWin ? 'powershell.exe' : 'sh';
      const command = isWin
        ? 'irm https://ollama.com/install.ps1 | Invoke-Expression'
        : 'curl -fsSL https://ollama.com/install.sh | sh';

      const args = isWin
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
        : ['-c', command];

      const proc = spawn(shellCmd, args, { shell: false });

      proc.stdout.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stdout' });
        });
      });

      proc.stderr.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-install-line', { line: line.trim(), type: 'stderr' });
        });
      });

      proc.on('close', (code: number) => {
        resolve({ success: code === 0, code });
      });
    });
  });

  ipcMain.handle('system:ollama-pull', async (event, modelName: string) => {
    return new Promise((resolve) => {
      const { spawn } = require('child_process');
      const bin = getOllamaBinary();
      const isWin = process.platform === 'win32';

      const proc = spawn(bin, ['pull', modelName], { shell: isWin && bin !== 'ollama' });

      proc.on('error', (err: any) => {
        console.error('[System] Ollama pull spawn error:', err);
        resolve({ success: false, code: -1, error: err.message });
      });

      proc.stdout.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stdout' });
        });
      });

      proc.stderr.on('data', (d: Buffer) => {
        d.toString().split('\n').filter(Boolean).forEach((line: string) => {
          event.sender.send('system:ollama-pull-line', { line: line.trim(), type: 'stderr' });
        });
      });

      proc.on('close', (code: number) => resolve({ success: code === 0 || code === null, code }));
    });
  });
  ipcMain.handle('system:open-terminal-installer', async (event, action: 'install-all' | 'pull-model') => {
    const { exec } = require('child_process');
    const isWin = process.platform === 'win32';
    if (isWin) {
      if (action === 'install-all') {
        exec('start cmd.exe /k "echo ==================================================== && echo DOWNLOADING AND INSTALLING OLLAMA... && echo ==================================================== && powershell -NoProfile -ExecutionPolicy Bypass -Command \\"irm https://ollama.com/install.ps1 | Invoke-Expression\\" && echo ==================================================== && echo PULLING QWEN3-VL:2B VISION MODEL... && echo ==================================================== && ollama pull qwen3-vl:2b && echo ==================================================== && echo Installation completed! You can close this window now. && pause"');
      } else {
        exec('start cmd.exe /k "echo ==================================================== && echo PULLING QWEN3-VL:2B VISION MODEL... && echo ==================================================== && ollama pull qwen3-vl:2b && echo ==================================================== && echo Completed! You can close this window now. && pause"');
      }
    } else {
      const isMac = process.platform === 'darwin';
      if (isMac) {
        if (action === 'install-all') {
          exec(`osascript -e 'tell app "Terminal" to do script "curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen3-vl:2b"'`);
        } else {
          exec(`osascript -e 'tell app "Terminal" to do script "ollama pull qwen3-vl:2b"'`);
        }
      } else {
        if (action === 'install-all') {
          exec(`x-terminal-emulator -e "curl -fsSL https://ollama.com/install.sh | sh && ollama pull qwen3-vl:2b"`);
        } else {
          exec(`x-terminal-emulator -e "ollama pull qwen3-vl:2b"`);
        }
      }
    }
    return { success: true };
  });

  ipcMain.handle('memory:save-direct', async (_event, content: string, metadata?: string) => {
    return memorySaveTool.execute({ content, metadata });
  });

  ipcMain.handle('memory:get-graph', async () => {
    try {
      const { loadMemoryGraph } = require('../agent/learning/memory/persistent-memory');
      return loadMemoryGraph();
    } catch (err: any) {
      console.error('[IPC] memory:get-graph error:', err);
      return { nodes: [], edges: [] };
    }
  });

  ipcMain.handle('memory:delete-node', async (_event, id: string) => {
    try {
      const { deleteMemoryNode } = require('../agent/learning/memory/persistent-memory');
      deleteMemoryNode(id);
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] memory:delete-node error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory:export-zip', async () => {
    try {
      const { loadMemoryGraph, getMemoryDir } = require('../agent/learning/memory/persistent-memory');
      const graph = loadMemoryGraph();
      const memDir = getMemoryDir();

      // Build an in-memory zip using only node built-ins (no extra dep)
      // We'll produce a JSON export + any linked .md files, bundled as a zip
      const JSZip = (() => {
        try { return require('jszip'); } catch { return null; }
      })();

      let exportBuffer: Buffer;
      let defaultName = `everfern-memory-${new Date().toISOString().slice(0, 10)}.json`;
      let filters = [{ name: 'JSON', extensions: ['json'] }];

      if (JSZip) {
        const zip = new JSZip();
        zip.file('memory_graph.json', JSON.stringify(graph, null, 2));
        // Include linked markdown files
        for (const node of graph.nodes) {
          if (node.linkedFile) {
            const mdPath = node.linkedFile.startsWith('/') || /^[A-Z]:/i.test(node.linkedFile)
              ? node.linkedFile
              : path.join(memDir, node.linkedFile);
            if (fs.existsSync(mdPath)) {
              zip.file(path.basename(mdPath), fs.readFileSync(mdPath));
            }
          }
        }
        exportBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
        defaultName = `everfern-memory-${new Date().toISOString().slice(0, 10)}.zip`;
        filters = [{ name: 'ZIP Archive', extensions: ['zip'] }];
      } else {
        exportBuffer = Buffer.from(JSON.stringify(graph, null, 2), 'utf-8');
      }

      const mainWindow = (global as any).mainWindow;
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Memory Graph',
        defaultPath: path.join(os.homedir(), 'Desktop', defaultName),
        filters,
      });
      if (canceled || !filePath) return { success: false, reason: 'canceled' };
      fs.writeFileSync(filePath, exportBuffer);
      return { success: true, filePath };
    } catch (err: any) {
      console.error('[IPC] memory:export-zip error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('memory:import-merge-graph', async () => {
    try {
      const { loadMemoryGraph, saveMemoryGraph } = require('../agent/learning/memory/persistent-memory');
      const mainWindow = (global as any).mainWindow;
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: 'Import & Merge Memory Graph',
        filters: [
          { name: 'Memory Files', extensions: ['json', 'zip'] },
          { name: 'JSON', extensions: ['json'] },
          { name: 'ZIP Archive', extensions: ['zip'] },
        ],
        properties: ['openFile'],
      });
      if (canceled || !filePaths.length) return { success: false, reason: 'canceled' };

      const filePath = filePaths[0];
      let importedGraph: { nodes: any[]; edges: any[] } = { nodes: [], edges: [] };

      if (filePath.endsWith('.zip')) {
        const JSZip = require('jszip');
        const data = fs.readFileSync(filePath);
        const zip = await JSZip.loadAsync(data);
        const jsonFile = zip.file('memory_graph.json');
        if (!jsonFile) return { success: false, error: 'No memory_graph.json found in ZIP' };
        const jsonStr = await jsonFile.async('string');
        importedGraph = JSON.parse(jsonStr);
      } else {
        importedGraph = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      }

      // Merge: add nodes/edges that don't already exist (by id / source+target)
      const current = loadMemoryGraph();
      const existingIds = new Set(current.nodes.map((n: any) => n.id));
      const newNodes = (importedGraph.nodes || []).filter((n: any) => !existingIds.has(n.id));
      const existingEdges = new Set(current.edges.map((e: any) => `${e.source}:${e.target}`));
      const newEdges = (importedGraph.edges || []).filter((e: any) => !existingEdges.has(`${e.source}:${e.target}`));

      const merged = {
        nodes: [...current.nodes, ...newNodes],
        edges: [...current.edges, ...newEdges],
      };
      saveMemoryGraph(merged);
      return { success: true, addedNodes: newNodes.length, addedEdges: newEdges.length };
    } catch (err: any) {
      console.error('[IPC] memory:import-merge-graph error:', err);
      return { success: false, error: err.message };
    }
  });


  ipcMain.handle('system:wipe-account', async () => {
    const everfernDir = path.join(os.homedir(), '.everfern');
    try {
      // Close all open database connections before wiping files
      try {
        const { closeDb } = await import('../lib/db');
        await closeDb();
        console.log('[IPC] system:wipe-account: main DB closed');
      } catch (dbErr: any) {
        console.warn('[IPC] system:wipe-account: main DB close warning:', dbErr.message);
      }

      try {
        const { closeChatVectorDb } = await import('../store/chat-vectors');
        await closeChatVectorDb();
        console.log('[IPC] system:wipe-account: chat vector DB closed');
      } catch (vecErr: any) {
        console.warn('[IPC] system:wipe-account: chat vector DB close warning:', vecErr.message);
      }

      // Wipe .everfern directory
      if (fs.existsSync(everfernDir)) {
        fs.rmSync(everfernDir, { recursive: true, force: true });
      }
      fs.mkdirSync(everfernDir, { recursive: true });

      console.log('[IPC] system:wipe-account: .everfern (including sql databases) wiped');
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:wipe-account error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:open-external', async (_event, url: string) => {
    if (url) {
      try {
        if (url.startsWith('file://')) {
          let decodedUrl = decodeURIComponent(url);
          let filePath = decodedUrl.replace(/^file:\/\/\/?/, '');

          const { translateLinuxPathToHost } = require('../agent/tools/linux-vm-executor');
          const hostPath = translateLinuxPathToHost(filePath);

          console.log(`[IPC] system:open-external: Original file:// url: ${url}, Translated host path: ${hostPath}`);

          const resultMsg = await shell.openPath(hostPath);
          if (resultMsg) {
            return { success: false, error: resultMsg };
          }
          return { success: true };
        }

        await shell.openExternal(url);
        return { success: true };
      } catch (err: any) {
        console.error('[IPC] Error in system:open-external:', err);
        return { success: false, error: err.message };
      }
    }
    return { success: false, error: 'No URL provided' };
  });

  ipcMain.handle('system:read-image-data-url', async (_event, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') {
        return { success: false, error: 'No image path provided' };
      }

      const resolved = path.resolve(filePath);
      const mimeType = imageMimeFromPath(resolved);
      if (!mimeType) {
        return { success: false, error: 'Unsupported image file type' };
      }

      if (!fs.existsSync(resolved)) {
        return { success: false, error: 'File not found' };
      }

      const stat = fs.statSync(resolved);
      const maxPreviewBytes = 32 * 1024 * 1024;
      if (!stat.isFile()) {
        return { success: false, error: 'Path is not a file' };
      }
      if (stat.size > maxPreviewBytes) {
        return { success: false, error: 'Image is too large to preview inline', size: stat.size };
      }

      const base64 = fs.readFileSync(resolved).toString('base64');
      return {
        success: true,
        path: resolved,
        mimeType,
        size: stat.size,
        dataUrl: `data:${mimeType};base64,${base64}`,
      };
    } catch (err: any) {
      console.error('[IPC] system:read-image-data-url error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('system:fetch-metadata', async (_event, url: string) => {
    if (!url) return null;
    try {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
      } catch {
        return null;
      }

      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(parsedUrl.href, {
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36' 
        },
        signal: controller.signal
      });
      clearTimeout(id);

      if (!response.ok) return null;
      const html = await response.text();

      // Basic meta extraction
      const getMeta = (prop: string) => {
        const regex = new RegExp(`<meta[^>]*?(?:name|property)=["']${prop}["'][^>]*?content=["'](.*?)["']`, 'i');
        const match = html.match(regex);
        if (match) return match[1];
        const altRegex = new RegExp(`<meta[^>]*?content=["'](.*?)["'][^>]*?(?:name|property)=["']${prop}["']`, 'i');
        const altMatch = html.match(altRegex);
        return altMatch ? altMatch[1] : null;
      };

      const cleanText = (text: string) => {
        if (!text) return '';
        return text
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&apos;/g, "'")
          .replace(/\s+/g, ' ')
          .trim();
      };

      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const rawTitle = getMeta('og:title') || (titleMatch ? titleMatch[1] : '') || '';
      const title = cleanText(rawTitle);

      const rawDescription = getMeta('og:description') || getMeta('description') || '';
      const description = cleanText(rawDescription);

      let favicon = html.match(/<link[^>]*?rel=["'](?:shortcut )?icon["'][^>]*?href=["'](.*?)["']/i)?.[1] || '';

      if (favicon && !favicon.startsWith('http')) {
        try {
          favicon = new URL(favicon, parsedUrl.origin).href;
        } catch { /* ignore */ }
      }

      return { title, description, favicon };
    } catch {
      return null;
    }
  });

  ipcMain.handle('system:start-dispatch', async (event, config: { sessionId: string, pinCode: string, url: string, apiUrl: string, key: string, token: string, userId: string, isForever?: boolean }) => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      const service = DispatchService.getInstance();

      // Wire the command handler BEFORE initializing so no commands are missed
      service.onCommand = (command: string, model?: string) => {
        // Forward the command to all windows and bring the app to foreground
        import('electron').then(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.show(); // Wake up from tray/background
              win.webContents.send('system:dispatch-command', { command, model });
            }
          });
        });
      };

      await service.initialize(config, () => {
        // Send event to the window that initiated the dispatch
        event.sender.send('system:dispatch-active');
      });
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:start-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:restore-dispatch', async (event, config: { url: string, apiUrl: string, key: string, token: string, userId: string }) => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      const service = DispatchService.getInstance();

      // Wire the command handler so restored sessions also forward commands
      service.onCommand = (command: string, model?: string) => {
        import('electron').then(({ BrowserWindow }) => {
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) {
              win.show();
              win.webContents.send('system:dispatch-command', { command, model });
            }
          });
        });
      };

      // Pass a dummy sessionId and pinCode for initialization since restoreSession will overwrite them
      await service.initialize({ ...config, sessionId: '', pinCode: '' }, () => {
        event.sender.send('system:dispatch-active');
      });
      return await service.restoreSession();
    } catch (err: any) {
      console.error('[IPC] system:restore-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:stop-dispatch', async () => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      await DispatchService.getInstance().disconnect();
      return { success: true };
    } catch (err: any) {
      console.error('[IPC] system:stop-dispatch error:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:broadcast-dispatch', async (_event, { event, data }: { event: string; data: any }) => {
    try {
      const { DispatchService } = await import('../lib/dispatch');
      DispatchService.getInstance().broadcastToWeb(event, data);
    } catch (err) {
      console.error('[IPC] system:broadcast-dispatch error:', err);
    }
  });

  /**
   * Ensure an attachment file is available in the Linux VM (WSL).
   * Retries the clone at send time if it failed during file picking.
   */
  ipcMain.handle('system:ensure-attachment-in-vm', async (_event, filePath: string) => {
    if (process.platform !== 'win32') return { success: true };
    if (!filePath || !fs.existsSync(filePath)) return { success: false, error: 'File not found' };

    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const wslUsername = (os.userInfo().username || 'user').toLowerCase();
      const wslAttachmentsDir = `/everfern`;
      const safeFileName = path.basename(filePath);
      const existingTarget = `\\\\wsl.localhost\\Ubuntu\\everfern\\${safeFileName}`;

      // Skip if already cloned
      if (fs.existsSync(existingTarget)) return { success: true };

      const driveLetter = path.parse(filePath).root.replace(':', '').toLowerCase();
      const wslRelPath = filePath.replace(/^[A-Za-z]:\\/, '').replace(/\\/g, '/');
      const wslSourcePath = `/mnt/${driveLetter}/${wslRelPath}`;

      await execAsync(`wsl.exe --exec bash -c "mkdir -p ${wslAttachmentsDir} && cp '${wslSourcePath}' '${wslAttachmentsDir}/'"`, { timeout: 30000 });
      console.log('[IPC] Attachment cloned to Linux VM:', existingTarget);
      return { success: true };
    } catch (err: any) {
      console.warn('[IPC] Failed to clone attachment to Linux VM (non-fatal):', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('system:parse-pptx', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-pptx-'));
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const isWin = process.platform === 'win32';
      if (isWin) {
        const zipPath = path.join(tempDir, 'temp.zip');
        fs.copyFileSync(filePath, zipPath);
        const escapedZipPath = zipPath.replace(/'/g, "''");
        const escapedTempDir = tempDir.replace(/'/g, "''");
        const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedTempDir}' -Force"`;
        await execAsync(cmd);
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
      } else {
        const { execFile } = require('child_process');
        const execFileAsync = promisify(execFile);
        await execFileAsync('unzip', ['-q', '-o', filePath, '-d', tempDir]);
      }

      const slidesDir = path.join(tempDir, 'ppt', 'slides');
      if (!fs.existsSync(slidesDir)) {
        return { success: false, error: 'Invalid presentation file: missing ppt/slides directory' };
      }

      const slideFiles = fs.readdirSync(slidesDir)
        .filter(file => file.startsWith('slide') && file.endsWith('.xml'))
        .sort((a, b) => {
          const numA = parseInt(a.replace(/[^\d]/g, ''), 10) || 0;
          const numB = parseInt(b.replace(/[^\d]/g, ''), 10) || 0;
          return numA - numB;
        });

      if (slideFiles.length === 0) {
        return { success: true, slides: [] };
      }

      const slides = [];

      const decodeXmlEntities = (str: string): string => {
        return str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#x9;/g, '\t')
          .replace(/&#xA;/g, '\n')
          .replace(/&#xD;/g, '\r')
          .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
          .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      };

      for (const slideFile of slideFiles) {
        const slidePath = path.join(slidesDir, slideFile);
        const xmlContent = fs.readFileSync(slidePath, 'utf8');

        const shapeRegex = /<p:sp>([\s\S]*?)<\/p:sp>/g;
        let shapeMatch;
        const shapes = [];

        while ((shapeMatch = shapeRegex.exec(xmlContent)) !== null) {
          const shapeXml = shapeMatch[1];

          const phRegex = /<p:ph[^>]*?type="([^"]+)"/;
          const nameRegex = /<p:cNvPr[^>]*?name="([^"]+)"/;

          const phMatch = shapeXml.match(phRegex);
          const nameMatch = shapeXml.match(nameRegex);

          const phType = phMatch ? phMatch[1].toLowerCase() : '';
          const name = nameMatch ? nameMatch[1].toLowerCase() : '';

          let role: 'title' | 'subtitle' | 'body' | 'unknown' = 'unknown';
          if (phType === 'title' || phType === 'ctrtitle' || name.includes('title')) {
            role = 'title';
          } else if (phType === 'subtitle' || name.includes('subtitle')) {
            role = 'subtitle';
          } else if (phType === 'body' || phType === 'obj' || name.includes('placeholder') || name.includes('content')) {
            role = 'body';
          }

          const pRegex = /<a:p>([\s\S]*?)<\/a:p>/g;
          let pMatch;
          const paragraphs = [];

          while ((pMatch = pRegex.exec(shapeXml)) !== null) {
            const pXml = pMatch[1];
            const tRegex = /<a:t>([^<]*?)<\/a:t>/g;
            let tMatch;
            let pText = '';
            while ((tMatch = tRegex.exec(pXml)) !== null) {
              pText += tMatch[1];
            }
            pText = decodeXmlEntities(pText).trim();
            if (pText) {
              paragraphs.push(pText);
            }
          }

          if (paragraphs.length > 0) {
            shapes.push({ role, paragraphs });
          }
        }

        let title = '';
        let subtitle = '';
        const points: string[] = [];

        const titleShape = shapes.find(s => s.role === 'title');
        const subtitleShape = shapes.find(s => s.role === 'subtitle');

        if (titleShape) {
          title = titleShape.paragraphs.join(' ');
        }
        if (subtitleShape) {
          subtitle = subtitleShape.paragraphs.join(' ');
        }

        shapes.forEach(s => {
          if (s !== titleShape && s !== subtitleShape) {
            if (s.role === 'body') {
              points.push(...s.paragraphs);
            }
          }
        });

        if (!title && shapes.length > 0) {
          const firstShape = shapes[0];
          title = firstShape.paragraphs.join(' ');
          if (shapes.length > 1) {
            shapes.slice(1).forEach(s => {
              points.push(...s.paragraphs);
            });
          }
        } else {
          shapes.forEach(s => {
            if (s !== titleShape && s !== subtitleShape && s.role !== 'body') {
              points.push(...s.paragraphs);
            }
          });
        }

        slides.push({
          title,
          subtitle,
          points
        });
      }

      return { success: true, slides };
    } catch (err: any) {
      console.error('[PPTXParser] error:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn('[PPTXParser] cleanup failed:', cleanErr);
      }
    }
  });

  ipcMain.handle('system:parse-docx', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-docx-'));
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const isWin = process.platform === 'win32';
      if (isWin) {
        const zipPath = path.join(tempDir, 'temp.zip');
        fs.copyFileSync(filePath, zipPath);
        const escapedZipPath = zipPath.replace(/'/g, "''");
        const escapedTempDir = tempDir.replace(/'/g, "''");
        const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedTempDir}' -Force"`;
        await execAsync(cmd);
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
      } else {
        const { execFile } = require('child_process');
        const execFileAsync = promisify(execFile);
        await execFileAsync('unzip', ['-q', '-o', filePath, '-d', tempDir]);
      }

      const docXmlPath = path.join(tempDir, 'word', 'document.xml');
      if (!fs.existsSync(docXmlPath)) {
        return { success: false, error: 'Invalid document file: missing word/document.xml' };
      }

      const xmlContent = fs.readFileSync(docXmlPath, 'utf8');

      // Simple regex parser for paragraphs and headers
      const pRegex = /<w:p[^>]*>([\s\S]*?)<\/w:p>/g;
      let pMatch;
      const paragraphs: string[] = [];

      const decodeXmlEntities = (str: string): string => {
        return str
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
          .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      };

      while ((pMatch = pRegex.exec(xmlContent)) !== null) {
        const pXml = pMatch[1];
        
        // Find all w:t tags in this paragraph
        const tRegex = /<w:t[^>]*>([^<]*?)<\/w:t>/g;
        let tMatch;
        let pText = '';
        while ((tMatch = tRegex.exec(pXml)) !== null) {
          pText += tMatch[1];
        }
        
        pText = decodeXmlEntities(pText).trim();
        if (pText) {
          paragraphs.push(pText);
        }
      }

      return { success: true, text: paragraphs.join('\n\n') };
    } catch (err: any) {
      console.error('[DOCXParser] error:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn('[DOCXParser] cleanup failed:', cleanErr);
      }
    }
  });

  ipcMain.handle('system:parse-xlsx', async (_event, filePath: string) => {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, error: 'File not found' };
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'everfern-xlsx-'));
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      const isWin = process.platform === 'win32';
      if (isWin) {
        const zipPath = path.join(tempDir, 'temp.zip');
        fs.copyFileSync(filePath, zipPath);
        const escapedZipPath = zipPath.replace(/'/g, "''");
        const escapedTempDir = tempDir.replace(/'/g, "''");
        const cmd = `powershell.exe -NoProfile -Command "Expand-Archive -Path '${escapedZipPath}' -DestinationPath '${escapedTempDir}' -Force"`;
        await execAsync(cmd);
        if (fs.existsSync(zipPath)) {
          fs.unlinkSync(zipPath);
        }
      } else {
        const { execFile } = require('child_process');
        const execFileAsync = promisify(execFile);
        await execFileAsync('unzip', ['-q', '-o', filePath, '-d', tempDir]);
      }

      // 1. Read shared strings
      const sharedStrings: string[] = [];
      const sharedStringsPath = path.join(tempDir, 'xl', 'sharedStrings.xml');
      if (fs.existsSync(sharedStringsPath)) {
        const xml = fs.readFileSync(sharedStringsPath, 'utf8');
        const tRegex = /<t[^>]*>([\s\S]*?)<\/t>/g;
        let match;
        const decodeXmlEntities = (str: string): string => {
          return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
            .replace(/&#x([0-9A-Fa-f]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
        };
        while ((match = tRegex.exec(xml)) !== null) {
          sharedStrings.push(decodeXmlEntities(match[1]));
        }
      }

      // 2. Read sheet1
      const sheet1Path = path.join(tempDir, 'xl', 'worksheets', 'sheet1.xml');
      if (!fs.existsSync(sheet1Path)) {
        return { success: false, error: 'Invalid spreadsheet: missing xl/worksheets/sheet1.xml' };
      }

      const xml = fs.readFileSync(sheet1Path, 'utf8');
      const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
      let rowMatch;
      const grid: string[][] = [];

      // Helper to map cell reference (like A1, B3, AB4) to col index
      const colRefToIndex = (ref: string): number => {
        const letters = ref.replace(/[0-9]/g, '');
        let index = 0;
        for (let i = 0; i < letters.length; i++) {
          index = index * 26 + (letters.charCodeAt(i) - 64);
        }
        return index - 1;
      };

      while ((rowMatch = rowRegex.exec(xml)) !== null) {
        const rowXml = rowMatch[1];
        const cellRegex = /<c r="([^"]+)"[^>]*?(?:t="([^"]+)")?>([\s\S]*?)<\/c>/g;
        let cellMatch;
        const rowCells: string[] = [];

        while ((cellMatch = cellRegex.exec(rowXml)) !== null) {
          const ref = cellMatch[1];
          const t = cellMatch[2] || '';
          const innerXml = cellMatch[3];

          const vRegex = /<v>([\s\S]*?)<\/v>/;
          const vMatch = innerXml.match(vRegex);
          let val = '';

          if (vMatch) {
            const rawVal = vMatch[1];
            if (t === 's') {
              const idx = parseInt(rawVal, 10);
              val = sharedStrings[idx] || '';
            } else {
              val = rawVal;
            }
          }

          const colIdx = colRefToIndex(ref);
          rowCells[colIdx] = val;
        }

        // Fill empty cells
        for (let i = 0; i < rowCells.length; i++) {
          if (rowCells[i] === undefined) {
            rowCells[i] = '';
          }
        }
        grid.push(rowCells);
      }

      // Convert grid to CSV content
      const csvLines = grid.map(row => 
        row.map(cell => {
          const escaped = cell.replace(/"/g, '""');
          if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
            return `"${escaped}"`;
          }
          return escaped;
        }).join(',')
      );

      return { success: true, csv: csvLines.join('\n') };
    } catch (err: any) {
      console.error('[XLSXParser] error:', err);
      return { success: false, error: err.message || String(err) };
    } finally {
      try {
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true });
        }
      } catch (cleanErr) {
        console.warn('[XLSXParser] cleanup failed:', cleanErr);
      }
    }
  });

  let localSttPort: number | null = null;
  let localSttProcess: any = null;

  async function checkWsl(): Promise<boolean> {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      await execAsync('wsl.exe -e echo ok', { timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }

  function translateWindowsPathToLinux(windowsPath: string): string {
    if (!windowsPath) return '';
    const clean = windowsPath.replace(/\\/g, '/');
    const match = clean.match(/^([a-zA-Z]):\/(.*)$/);
    if (match) {
      const drive = match[1].toLowerCase();
      const rest = match[2];
      return `/mnt/${drive}/${rest}`;
    }
    return clean;
  }

  function getUnusedPort(): Promise<number> {
    return new Promise((resolve) => {
      const netModule = require('net');
      const server = netModule.createServer();
      server.listen(0, () => {
        const address = server.address();
        const port = typeof address === 'object' && address !== null ? address.port : 8010;
        server.close(() => resolve(port));
      });
      server.on('error', () => resolve(8010));
    });
  }

  async function startLocalSttServer(): Promise<number> {
    if (localSttProcess && localSttPort) {
      return localSttPort;
    }
    
    const port = await getUnusedPort();
    console.log(`[LocalSTT] Dynamic port selected: ${port}`);
    
    const scriptPath = path.join(app.getAppPath(), '..', '..', 'local_stt_server.py');
    console.log(`[LocalSTT] Python script path: ${scriptPath}`);
    
    const isWin = process.platform === 'win32';
    const hasWsl = isWin && (await checkWsl());
    
    let pythonBin = 'python';
    let args: string[] = [];
    
    if (hasWsl) {
      const translatedScript = translateWindowsPathToLinux(scriptPath);
      pythonBin = 'wsl.exe';
      args = ['--exec', 'bash', '-c', `~/.everfern/venv/bin/python "${translatedScript}" ${port}`];
      console.log(`[LocalSTT] Spawning uvicorn server in WSL: wsl.exe ${args.join(' ')}`);
    } else {
      const venvPythonPath = isWin
        ? path.join(app.getAppPath(), '..', '..', '.venv', 'Scripts', 'python.exe')
        : path.join(app.getAppPath(), '..', '..', '.venv', 'bin', 'python');
        
      if (fs.existsSync(venvPythonPath)) {
        pythonBin = venvPythonPath;
      } else if (process.platform !== 'win32') {
        pythonBin = 'python3';
      }
      args = [scriptPath, port.toString()];
      console.log(`[LocalSTT] Spawning uvicorn server on Host: ${pythonBin} ${args.join(' ')}`);
    }
    
    try {
      const { spawn } = require('child_process');
      const child = spawn(pythonBin, args, {
        shell: false,
        stdio: 'pipe'
      });
      
      child.stdout.on('data', (data: Buffer) => {
        console.log(`[LocalSTT Server]: ${data.toString().trim()}`);
      });
      
      child.stderr.on('data', (data: Buffer) => {
        console.error(`[LocalSTT Server Error]: ${data.toString().trim()}`);
      });
      
      child.on('error', (err: any) => {
        console.error('[LocalSTT Spawn Error]:', err);
      });
      
      child.on('close', (code: number) => {
        console.log(`[LocalSTT Server closed] Code: ${code}`);
        if (localSttProcess === child) {
          localSttProcess = null;
          localSttPort = null;
        }
      });

      localSttProcess = child;
      localSttPort = port;
      
      // Poll /health to wait for server to start up
      let ready = false;
      const startTime = Date.now();
      const timeoutMs = 12000; // wait up to 12 seconds
      while (Date.now() - startTime < timeoutMs) {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`);
          if (res.ok) {
            ready = true;
            break;
          }
        } catch (e) {
          // ignore connection refused/failed errors during boot
        }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
      if (!ready) {
        console.warn(`[LocalSTT] Server did not become ready within ${timeoutMs}ms.`);
      } else {
        console.log(`[LocalSTT] Server is ready and accepting requests on port ${port}.`);
      }
      
      return port;
    } catch (err) {
      console.error('[LocalSTT] Failed to start local STT server:', err);
      throw err;
    }
  }

  // Auto-kill local STT server on Electron app exit
  app.on('will-quit', () => {
    if (localSttProcess) {
      console.log('[LocalSTT] Terminating local STT server...');
      localSttProcess.kill();
      localSttProcess = null;
    }
  });

  ipcMain.handle('system:transcribe-local', async (event, audioBuffer: ArrayBuffer) => {
    try {
      const port = await startLocalSttServer();
      const buffer = Buffer.from(audioBuffer);
      
      const response = await fetch(`http://127.0.0.1:${port}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'audio/webm'
        },
        body: buffer
      });
      
      if (response.ok) {
        const result = (await response.json()) as any;
        return { success: true, transcription: result.transcription || '' };
      } else {
        return { success: false, error: `Local STT server returned status ${response.status}` };
      }
    } catch (err: any) {
      console.error('[LocalSTT] Transcription error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('system:transcribe-audio', async (event, audioBuffer: ArrayBuffer, userApiKey?: string) => {
    try {
      const apiKey = (userApiKey && typeof userApiKey === 'string' && userApiKey.trim()) || process.env.DEEPGRAM_API_KEY || '';
      if (!apiKey) {
        return { success: false, error: 'Deepgram API key not configured. Please set your API key in Settings.' };
      }
      const buffer = Buffer.from(audioBuffer);
      const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=en', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'audio/webm'
        },
        body: buffer
      });
      if (response.ok) {
        const result = (await response.json()) as any;
        const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        return { success: true, transcript };
      } else {
        const errBody = await response.text().catch(() => '');
        return { success: false, error: `Deepgram API returned status ${response.status}: ${errBody}` };
      }
    } catch (err: any) {
      console.error('[Voice] Main process transcription error:', err);
      return { success: false, error: err.message || String(err) };
    }
  });
}

