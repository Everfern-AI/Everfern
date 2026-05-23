"use strict";
/**
 * EverFern Desktop — Grounding Engine v4
 *
 *  NEW IN V4
 *  ─────────
 *  1. SoM (Set-of-Marks) — detectElements() labels every interactive widget
 *     with a numbered overlay so the agent can say "click 7" instead of
 *     running a VLM grounding search from scratch each time.
 *
 *  2. Screen-hash cache — cheapHash() now runs over the full buffer so that
 *     locate() on an unchanged screen returns instantly even across calls
 *     that provide different query strings (whole-screen cache tier).
 *
 *  3. Text-match fast path — if the query is a short, exact string that
 *     appears verbatim in any SoM element label, the coords are returned
 *     without any VLM call.
 *
 *  4. SoM element cache — a detected element map is kept for 3 s so that
 *     multiple click_element() calls within the same agent step all resolve
 *     from the same annotated screenshot without re-detecting.
 *
 *  RETAINED FROM V3
 *  ────────────────
 *  5. PARALLEL RACE      — ShowUI + Ollama fire simultaneously.
 *  6. REGION HINTS       — Crops to taskbar/header/sidebar before full scan.
 *  7. RESULT CACHE       — Same query + same screen → instant return.
 *  8. WARM-PATH          — High-confidence first attempt skips retry.
 *  9. TIMEOUT WRAPPER    — Promise.race fallback timeout.
 * 10. SMART RETRY        — Max 3 attempts; crop → full → slim.
 * 11. SELF-HEALING       — Failed backends recover after 60 s.
 * 12. COORD GUARD        — Rejects hallucinated top-left corner + out-of-range.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedGroundingEngine = exports.GroundingEngine = void 0;
exports.createGroundingEngine = createGroundingEngine;
const electron_1 = require("electron");
const showui_server_1 = require("./showui-server");
// sharp is an optional native module — load lazily so a missing binary doesn't crash startup
let sharp = null;
try {
    sharp = require('sharp');
}
catch {
    console.warn('[Grounding] sharp unavailable — image processing disabled');
}
// ── Constants ────────────────────────────────────────────────────────────────
const CONFIDENCE_THRESHOLD = 75;
const MAX_LOCATE_ATTEMPTS = 3;
const SHOWUI_TIMEOUT_MS = 3_000;
const OLLAMA_TIMEOUT_MS = 60_000;
const FALLBACK_TIMEOUT_MS = 30_000;
const BACKEND_COOLDOWN_MS = 60_000;
const SOM_DETECTION_TIMEOUT_MS = 120_000;
// SoM colour palette for overlays (id % 8)
const SOM_COLORS = [
    '#E53935', '#1E88E5', '#43A047', '#FB8C00',
    '#8E24AA', '#00ACC1', '#D81B60', '#6D4C41',
];
// ── Backend health tracking ───────────────────────────────────────────────────
const BACKEND_FAILURES = new Map();
function isBackendHealthy(key) {
    const failedAt = BACKEND_FAILURES.get(key);
    if (!failedAt)
        return true;
    if (Date.now() - failedAt > BACKEND_COOLDOWN_MS) {
        BACKEND_FAILURES.delete(key);
        return true;
    }
    return false;
}
function markBackendFailed(key) {
    BACKEND_FAILURES.set(key, Date.now());
    console.warn(`[Grounding] ⛔ Backend "${key}" unhealthy for ${BACKEND_COOLDOWN_MS / 1000}s`);
}
// ── Hashing ───────────────────────────────────────────────────────────────────
/** Fast 32-bit hash sampling ~512 positions spread across the string. */
function cheapHash(s) {
    let h = 0x811c9dc5;
    const step = Math.max(1, Math.floor(s.length / 512));
    for (let i = 0; i < s.length; i += step) {
        h ^= s.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    return h;
}
const LOCATE_CACHE = new Map();
const CACHE_TTL_MS = 4_000;
function locateCacheKey(query, b64) {
    return query.toLowerCase().trim() + ':' + cheapHash(b64).toString(16);
}
function locateCacheGet(key) {
    const entry = LOCATE_CACHE.get(key);
    if (!entry)
        return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        LOCATE_CACHE.delete(key);
        return null;
    }
    return entry.result;
}
function locateCacheSet(key, result) {
    const now = Date.now();
    for (const [k, v] of LOCATE_CACHE)
        if (now - v.ts > CACHE_TTL_MS)
            LOCATE_CACHE.delete(k);
    LOCATE_CACHE.set(key, { result, ts: now });
}
const SOM_CACHE = new Map();
const SOM_CACHE_TTL_MS = 3_000;
function somCacheGet(hash) {
    const entry = SOM_CACHE.get(hash);
    if (!entry)
        return null;
    if (Date.now() - entry.ts > SOM_CACHE_TTL_MS) {
        SOM_CACHE.delete(hash);
        return null;
    }
    return entry.result;
}
function somCacheSet(hash, result) {
    const now = Date.now();
    for (const [k, v] of SOM_CACHE)
        if (now - v.ts > SOM_CACHE_TTL_MS)
            SOM_CACHE.delete(k);
    SOM_CACHE.set(hash, { result, ts: now });
}
const REGION_KEYWORDS = [
    {
        patterns: [/taskbar/i, /start menu/i, /tray/i, /system tray/i, /clock/i, /notification area/i],
        getRegion: (w, h) => ({ x: 0, y: h - Math.round(h * 0.06), w, h: Math.round(h * 0.06) })
    },
    {
        patterns: [/menu bar/i, /top bar/i, /title bar/i, /header/i, /toolbar/i],
        getRegion: (w, h) => ({ x: 0, y: 0, w, h: Math.round(h * 0.07) })
    },
    {
        patterns: [/sidebar/i, /nav/i, /panel/i, /left panel/i],
        getRegion: (w, _h) => ({ x: 0, y: 0, w: Math.round(w * 0.20), h: _h })
    },
    {
        patterns: [/right panel/i, /right sidebar/i, /properties/i],
        getRegion: (w, h) => ({ x: Math.round(w * 0.80), y: 0, w: Math.round(w * 0.20), h })
    },
    {
        patterns: [/address bar/i, /url bar/i, /omnibox/i, /search bar/i, /search/i, /find/i],
        getRegion: (w, h) => ({ x: Math.round(w * 0.05), y: 0, w: Math.round(w * 0.90), h: Math.round(h * 0.12) })
    },
    {
        patterns: [/status bar/i, /status strip/i, /bottom bar/i],
        getRegion: (w, h) => ({ x: 0, y: h - Math.round(h * 0.04), w, h: Math.round(h * 0.04) })
    },
];
function getRegionHint(query, imgW, imgH) {
    for (const hint of REGION_KEYWORDS) {
        if (hint.patterns.some(p => p.test(query)))
            return hint.getRegion(imgW, imgH);
    }
    return null;
}
function cropImage(b64, region) {
    const img = electron_1.nativeImage.createFromBuffer(Buffer.from(b64, 'base64'));
    const size = img.getSize();
    const x = Math.max(0, region.x), y = Math.max(0, region.y);
    const w = Math.min(region.w, size.width - x), h = Math.min(region.h, size.height - y);
    const cropped = img.crop({ x, y, width: w, height: h });
    // Align crop to 32px boundaries for Qwen vision tokens
    const round32 = (v) => Math.max(32, Math.floor(v / 32) * 32);
    const finalW = round32(w);
    const finalH = round32(h);
    const finalB64 = electron_1.nativeImage.createFromBuffer(cropped.toJPEG(90))
        .resize({ width: finalW, height: finalH, quality: 'best' })
        .toJPEG(90)
        .toString('base64');
    return { croppedB64: finalB64, offsetX: x, offsetY: y, cropW: finalW, cropH: finalH, origW: w, origH: h };
}
/**
 * Align image to Qwen-VL optimal dimensions (32px patches, ~2M pixel area).
 * Based on qwen-computer.py preprocessing logic.
 */
async function prepareImageForQwen(b64, w, h) {
    const AREA_MAX = 2_000_000;
    const AREA_MIN = 4096;
    const SCALE_32 = 32;
    const area = w * h;
    const clamped = Math.min(Math.max(area, AREA_MIN), AREA_MAX);
    const scale = Math.sqrt(clamped / area);
    const round32 = (v) => Math.max(SCALE_32, Math.floor(v / SCALE_32) * SCALE_32);
    const rw = round32(w * scale);
    const rh = round32(h * scale);
    const outB64 = await sharp(Buffer.from(b64, 'base64'))
        .resize(rw, rh, { kernel: 'lanczos3' })
        .jpeg({ quality: 75, optimizeScans: true })
        .toBuffer()
        .then(b => b.toString('base64'));
    return { b64: outB64, rw, rh };
}
// ── SoM overlay rendering ─────────────────────────────────────────────────────
/**
 * Draws numbered element markers onto a screenshot.
 * Each element gets a small coloured pill (number + label) near its centre.
 */
async function annotateSoM(b64, elements, w, h) {
    const PILL_H = 20, PAD = 6, R = 4;
    const svgParts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`];
    for (const el of elements) {
        const color = SOM_COLORS[el.id % SOM_COLORS.length];
        const label = `${el.id}: ${el.label.slice(0, 18)}`;
        const pillW = Math.max(30, label.length * 6.5 + PAD * 2);
        // Clamp pill position inside the image
        const px = Math.min(el.x, w - pillW - 2);
        const py = Math.max(2, el.y - PILL_H - 4);
        // Small dot at element centre
        svgParts.push(`<circle cx="${el.x}" cy="${el.y}" r="5" fill="${color}" opacity="0.85"/>`, `<circle cx="${el.x}" cy="${el.y}" r="5" fill="none" stroke="white" stroke-width="1.5"/>`, 
        // Pill background
        `<rect x="${px}" y="${py}" width="${pillW}" height="${PILL_H}" rx="${R}" fill="${color}" opacity="0.92"/>`, 
        // Pill text
        `<text x="${px + PAD}" y="${py + 14}" font-family="system-ui,sans-serif" font-size="11" font-weight="600" fill="white">${label}</text>`);
    }
    svgParts.push('</svg>');
    return sharp(Buffer.from(b64, 'base64'))
        .composite([{ input: Buffer.from(svgParts.join('')), top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer()
        .then(b => b.toString('base64'));
}
// ── SoM VLM prompt ────────────────────────────────────────────────────────────
function buildSoMPrompt(w, h) {
    return `You are a UI element detector analyzing a ${w}×${h} desktop screenshot.

Identify ALL interactive elements: buttons, inputs, links, checkboxes, dropdowns, tabs, menus, icons, etc.
Also include important non-interactive text labels if they identify a section or field.

Return ONLY a valid JSON array.
Each element: {"id":1,"label":"short label","type":"button","x_pct":42.3,"y_pct":65.1,"confidence":90}

Rules:
- LIMIT: Only return the TOP 15 most important interactive elements.
- label: ≤15 chars, descriptive ("Submit", "Search", "File", "Close")
- x_pct / y_pct: absolute center as 0–100 %
- type: button, input, link, checkbox, radio, dropdown, tab, menu, icon, text, image, other
- confidence: 0–100

IMPORTANT: Response must be ONLY the [ ... ] array. No markdown, no prose.
`.trim();
}
// ── Grounding prompt ──────────────────────────────────────────────────────────
function buildGroundingPrompt(query, w, h, attempt) {
    const urgency = attempt === 1
        ? 'Look carefully at all UI elements.'
        : attempt === 2
            ? 'Focus on edges, corners, icons, and text labels.'
            : 'Scan every pixel. The element must exist somewhere.';
    return `Task: Find the UI element "${query}" in this ${w}×${h} screenshot.
${urgency}
Return the geometric center as percentages.

Respond ONLY with valid JSON (no markdown fences, no extra text):
{"found":true,"confidence":95,"x_pct":42.3,"y_pct":7.1,"reasoning":"Button at top-right"}

If not found: {"found":false,"confidence":0,"x_pct":0,"y_pct":0,"reasoning":"not visible"}`.trim();
}
// ── JSON parsers ──────────────────────────────────────────────────────────────
function parseGroundingJSON(raw, imgW, imgH) {
    const EMPTY = { found: false, x: 0, y: 0, confidence: 0 };
    try {
        const cleanedRaw = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
        const cleaned = cleanedRaw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = cleaned.match(/\{[\s\S]*?\}/);
        if (!match)
            return EMPTY;
        const parsed = JSON.parse(match[0]);
        if (!parsed.found)
            return EMPTY;
        const conf = Number(parsed.confidence ?? 0);
        if (conf < CONFIDENCE_THRESHOLD) {
            console.warn(`[Grounding] Low confidence (${conf}%) — rejecting.`);
            return { ...EMPTY, confidence: conf };
        }
        let xNorm, yNorm;
        if (parsed.x_pct !== undefined) {
            xNorm = parsed.x_pct / 100;
            yNorm = parsed.y_pct / 100;
        }
        else {
            xNorm = parsed.x / 1000;
            yNorm = parsed.y / 1000;
        }
        if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) {
            console.warn(`[Grounding] Out-of-range (${xNorm.toFixed(3)}, ${yNorm.toFixed(3)}) — rejecting.`);
            return EMPTY;
        }
        if (xNorm < 0.05 && yNorm < 0.05) {
            console.warn('[Grounding] Top-left hallucination — rejecting.');
            return EMPTY;
        }
        return { found: true, x: Math.round(xNorm * imgW), y: Math.round(yNorm * imgH), confidence: conf };
    }
    catch {
        return EMPTY;
    }
}
function parseSoMJSON(raw, imgW, imgH) {
    try {
        const cleanedRaw = raw.replace(/<think>[\s\S]*?<\/think>/g, '');
        const cleaned = cleanedRaw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        // Use a more literal match for the array to avoid greedy regex issues
        const startIdx = cleaned.indexOf('[');
        const endIdx = cleaned.lastIndexOf(']');
        if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
            console.warn("[Grounding] SoM JSON not found or invalid format.");
            return [];
        }
        const arr = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
        if (!Array.isArray(arr))
            return [];
        const elements = [];
        for (const item of arr) {
            if (typeof item.x_pct !== 'number')
                continue;
            const xNorm = item.x_pct / 100;
            const yNorm = item.y_pct / 100;
            if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1)
                continue;
            elements.push({
                id: elements.length + 1,
                label: String(item.label ?? '?').slice(0, 40),
                type: item.type ?? 'other',
                x: Math.round(xNorm * imgW),
                y: Math.round(yNorm * imgH),
                x_pct: item.x_pct,
                y_pct: item.y_pct,
                confidence: Number(item.confidence ?? 70),
            });
        }
        return elements;
    }
    catch {
        return [];
    }
}
// ── Backend implementations ────────────────────────────────────────────────────
async function groundViaShowUILocal(b64, imgW, imgH, query, baseUrl) {
    const ready = await (0, showui_server_1.ensureShowUIServer)((l) => console.log(l));
    if (!ready)
        throw new Error('ShowUI server failed to start');
    const url = baseUrl.replace(/\/$/, '') + '/gradio_api/run/on_submit';
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: [{ url: `data:image/jpeg;base64,${b64}` }, query] }),
        signal: AbortSignal.timeout(SHOWUI_TIMEOUT_MS),
    });
    if (!resp.ok)
        throw new Error(`ShowUI ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const rawArr = data?.data?.[0];
    if (!Array.isArray(rawArr) || rawArr.length < 2)
        return { found: false, x: 0, y: 0, confidence: 0, source: 'showui-local' };
    const rx = Number(rawArr[0]), ry = Number(rawArr[1]);
    if (isNaN(rx) || isNaN(ry))
        return { found: false, x: 0, y: 0, confidence: 0, source: 'showui-local' };
    const x = rx <= 1 && rx > 0 ? Math.round(rx * imgW) : Math.round(rx);
    const y = ry <= 1 && ry > 0 ? Math.round(ry * imgH) : Math.round(ry);
    return { found: true, x, y, confidence: 0.95, source: 'showui-local' };
}
async function groundViaOllama(b64, imgW, imgH, query, baseUrl, modelName, apiKey, attempt, isSlim) {
    const source = isSlim ? 'ollama-slim' : (apiKey ? 'ollama-cloud' : 'ollama-maiui');
    const resp = await fetch(baseUrl.replace(/\/$/, '') + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: buildGroundingPrompt(query, imgW, imgH, attempt), images: [b64] }],
            stream: false,
            options: { temperature: 0, num_ctx: 2048, num_predict: 200 },
        }),
        signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!resp.ok)
        throw new Error(`Ollama ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const raw = data?.message?.content ?? '';
    const parsed = parseGroundingJSON(raw, imgW, imgH);
    return { ...parsed, confidence: parsed.found ? parsed.confidence / 100 : 0, source };
}
/**
 * SoM detection via Ollama (or cloud VLM).
 * Identifies all interactive elements and returns a labelled list.
 */
async function detectViaOllama(b64, imgW, imgH, baseUrl, modelName, apiKey) {
    const resp = await fetch(baseUrl.replace(/\/$/, '') + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
        body: JSON.stringify({
            model: modelName,
            messages: [{ role: 'user', content: buildSoMPrompt(imgW, imgH), images: [b64] }],
            stream: false,
            options: { temperature: 0, num_ctx: 4096, num_predict: 2000 },
        }),
        signal: AbortSignal.timeout(SOM_DETECTION_TIMEOUT_MS),
    });
    if (!resp.ok)
        throw new Error(`Ollama (SoM) ${resp.status}: ${await resp.text()}`);
    const data = await resp.json();
    const raw = data?.message?.content ?? '';
    if (apiKey) {
        console.log("[Grounding] SoM Cloud Raw Response:", raw);
    }
    return parseSoMJSON(raw, imgW, imgH);
}
async function detectViaFallback(b64, imgW, imgH, client) {
    const response = await withTimeout(client.chat({
        model: client.model,
        messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
                    { type: 'text', text: buildSoMPrompt(imgW, imgH) },
                ],
            }],
        temperature: 0,
        maxTokens: 2000,
    }), SOM_DETECTION_TIMEOUT_MS, 'SoM-fallback');
    const raw = typeof response.content === 'string'
        ? response.content
        : response.content?.map((c) => c.text ?? '').join('') ?? '';
    return parseSoMJSON(raw, imgW, imgH);
}
function withTimeout(promise, ms, label) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`[Grounding] ${label} timed out after ${ms}ms`)), ms)),
    ]);
}
async function groundViaFallback(b64, imgW, imgH, query, client, attempt) {
    const response = await withTimeout(client.chat({
        model: client.model,
        messages: [{
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
                    { type: 'text', text: buildGroundingPrompt(query, imgW, imgH, attempt) },
                ],
            }],
        temperature: 0,
        maxTokens: 1500,
        responseFormat: 'json',
        guidedJson: {
            type: "object",
            properties: {
                found: { type: "boolean" },
                confidence: { type: "number" },
                x_pct: { type: "number" },
                y_pct: { type: "number" },
                reasoning: { type: "string" }
            },
            required: ["found", "confidence", "x_pct", "y_pct", "reasoning"],
            additionalProperties: false
        }
    }), FALLBACK_TIMEOUT_MS, 'vision-fallback');
    const raw = typeof response.content === 'string'
        ? response.content
        : response.content?.map((c) => c.text ?? '').join('') ?? '';
    const parsed = parseGroundingJSON(raw, imgW, imgH);
    return { ...parsed, confidence: parsed.found ? parsed.confidence / 100 : 0, source: 'vision-fallback' };
}
// ── GroundingEngine ───────────────────────────────────────────────────────────
class GroundingEngine {
    config;
    constructor(config) {
        this.config = config;
        // Migrate old F16 model
        if (this.config.ollamaModel === 'hf.co/Qwen/Qwen3-VL-2B-Thinking-GGUF:F16') {
            this.config.ollamaModel = 'hf.co/Qwen/Qwen3-VL-2B-Thinking-GGUF:Q4_K_M';
        }
    }
    get backendName() {
        if (this.config.showuiUrl)
            return `ShowUI (${this.config.showuiUrl})`;
        if (this.config.ollamaBaseUrl)
            return `Ollama (${this.config.ollamaModel ?? 'qwen3-vl:2b'})`;
        return 'Vision Fallback';
    }
    async checkShowUIHealth() {
        if (!this.config.showuiUrl)
            return false;
        try {
            const resp = await fetch(this.config.showuiUrl.replace(/\/$/, '') + '/', {
                method: 'GET', signal: AbortSignal.timeout(3000),
            });
            return resp.ok;
        }
        catch {
            return false;
        }
    }
    // ── SoM: detect all interactive elements ──────────────────────────────────
    //
    // This is the recommended first call when the agent needs to interact with
    // multiple elements on the same screen. One VLM call returns 5–40 elements
    // with ids; subsequent click_element(id) calls skip VLM entirely.
    async detectElements(b64, imgW, imgH) {
        const hash = cheapHash(b64);
        // SoM cache hit — same screen detected recently
        const cached = somCacheGet(hash);
        if (cached) {
            console.log(`[Grounding] ⚡ SoM cache hit (${cached.elements.length} elements)`);
            return cached;
        }
        console.log('[Grounding] 🔍 SoM detection starting...');
        // Use Qwen-optimal scaling for detection
        const { b64: workB64, rw: workW, rh: workH } = await prepareImageForQwen(b64, imgW, imgH);
        let elements = [];
        // Try Ollama first, fall back to vision client
        if (this.config.ollamaBaseUrl) {
            const model = this.config.ollamaModel ?? 'qwen3-vl:2b';
            const apiKey = this.config.ollamaApiKey;
            const backendKey = apiKey ? 'ollama-cloud' : 'ollama-maiui';
            if (isBackendHealthy(backendKey)) {
                try {
                    elements = await detectViaOllama(workB64, workW, workH, this.config.ollamaBaseUrl, model, apiKey);
                }
                catch (err) {
                    console.warn('[Grounding] Ollama SoM failed:', err);
                    markBackendFailed(backendKey);
                }
            }
        }
        if (elements.length === 0 && this.config.fallbackClient) {
            try {
                elements = await detectViaFallback(workB64, workW, workH, this.config.fallbackClient);
            }
            catch (err) {
                console.warn('[Grounding] Fallback SoM failed:', err);
            }
        }
        console.log(`[Grounding] ✅ SoM: ${elements.length} elements detected`);
        const annotatedB64 = await annotateSoM(b64, elements, imgW, imgH);
        const result = { elements, annotatedB64, screenHash: hash };
        somCacheSet(hash, result);
        return result;
    }
    /**
     * Get a SoM element by id from a cached result, or null if not found.
     * The hash is derived from the b64 so the caller doesn't need to track it.
     */
    getElementById(b64, id) {
        const hash = cheapHash(b64);
        const cached = somCacheGet(hash);
        if (!cached)
            return null;
        return cached.elements.find(e => e.id === id) ?? null;
    }
    /**
     * Text-match fast path: search SoM element labels for an exact or
     * case-insensitive substring match before running VLM grounding.
     */
    matchElementByText(b64, query) {
        const hash = cheapHash(b64);
        const cached = somCacheGet(hash);
        if (!cached || cached.elements.length === 0)
            return null;
        const q = query.toLowerCase().trim();
        // Exact match first
        let el = cached.elements.find(e => e.label.toLowerCase() === q);
        // Then prefix / contains
        if (!el)
            el = cached.elements.find(e => e.label.toLowerCase().startsWith(q));
        if (!el)
            el = cached.elements.find(e => e.label.toLowerCase().includes(q));
        // Reverse: query contains the label (e.g. query "click the Submit button" → label "Submit")
        if (!el)
            el = cached.elements.find(e => q.includes(e.label.toLowerCase()));
        if (!el)
            return null;
        console.log(`[Grounding] ⚡ Text-match: "${query}" → element #${el.id} "${el.label}"`);
        return {
            found: true,
            x: el.x,
            y: el.y,
            confidence: el.confidence / 100,
            source: 'text-match',
            elementId: el.id,
        };
    }
    // ── locate: find a single element by natural-language query ───────────────
    async locate(b64, imgW, imgH, query) {
        console.log(`[Grounding] 🔍 Locating: "${query}"`);
        // Locate cache hit
        const ck = locateCacheKey(query, b64);
        const cached = locateCacheGet(ck);
        if (cached) {
            console.log(`[Grounding] ⚡ Cache hit → (${cached.x}, ${cached.y})`);
            return cached;
        }
        // SoM text-match fast path (free if SoM has run recently on this screen)
        const textMatch = this.matchElementByText(b64, query);
        if (textMatch) {
            locateCacheSet(ck, textMatch);
            return textMatch;
        }
        for (let attempt = 1; attempt <= MAX_LOCATE_ATTEMPTS; attempt++) {
            let workB64 = b64, workW = imgW, workH = imgH, offsetX = 0, offsetY = 0;
            let offsetScaleX = 1, offsetScaleY = 1;
            if (attempt === 1) {
                const hint = getRegionHint(query, imgW, imgH);
                if (hint) {
                    console.log(`[Grounding]  Region hint: ${JSON.stringify(hint)}`);
                    const crop = cropImage(b64, hint);
                    workB64 = crop.croppedB64;
                    workW = crop.cropW;
                    workH = crop.cropH;
                    offsetX = crop.offsetX;
                    offsetY = crop.offsetY;
                    offsetScaleX = crop.origW / crop.cropW; // Remap from rounded back to original crop bounds
                    offsetScaleY = crop.origH / crop.cropH;
                }
            }
            if (attempt === 3) {
                const prepped = await prepareImageForQwen(b64, imgW, imgH);
                workB64 = prepped.b64;
                workW = prepped.rw;
                workH = prepped.rh;
            }
            const candidates = [];
            if (this.config.showuiUrl && isBackendHealthy('showui-local')) {
                candidates.push(groundViaShowUILocal(workB64, workW, workH, query, this.config.showuiUrl)
                    .then(r => r.found ? r : null)
                    .catch(err => { console.warn('[Grounding] ShowUI error:', err); markBackendFailed('showui-local'); return null; }));
            }
            if (this.config.ollamaBaseUrl) {
                const model = this.config.ollamaModel ?? 'qwen3-vl:2b';
                const apiKey = this.config.ollamaApiKey;
                const backendKey = apiKey ? 'ollama-cloud' : 'ollama-maiui';
                const isSlim = attempt === 3;
                if (isBackendHealthy(backendKey)) {
                    candidates.push(groundViaOllama(workB64, workW, workH, query, this.config.ollamaBaseUrl, model, apiKey, attempt, isSlim)
                        .then(r => r.found ? r : null)
                        .catch(err => { console.warn(`[Grounding] Ollama error:`, err); markBackendFailed(backendKey); return null; }));
                }
            }
            const hasOtherBackend = candidates.length > 0;
            if (this.config.fallbackClient && (!hasOtherBackend || attempt === MAX_LOCATE_ATTEMPTS)) {
                candidates.push(groundViaFallback(workB64, workW, workH, query, this.config.fallbackClient, attempt)
                    .then(r => r.found ? r : null)
                    .catch(err => { console.warn('[Grounding] Fallback error:', err); return null; }));
            }
            if (candidates.length === 0) {
                console.warn('[Grounding] No backends.');
                break;
            }
            const winner = await raceToFound(candidates);
            if (winner) {
                // Remap from potentially modified aspect ratio (due to 32px rounding)
                const finalX = Math.round(winner.x * (imgW / workW) * (attempt === 1 ? offsetScaleX : 1)) + offsetX;
                const finalY = Math.round(winner.y * (imgH / workH) * (attempt === 1 ? offsetScaleY : 1)) + offsetY;
                const final = { ...winner, x: finalX, y: finalY, attempts: attempt };
                console.log(`[Grounding] ✅ (${finalX}, ${finalY}) via ${winner.source} [atmt ${attempt}, conf ${Math.round(winner.confidence * 100)}%]`);
                if (winner.confidence >= 0.85)
                    locateCacheSet(ck, final);
                return final;
            }
            console.log(`[Grounding] ❌ Attempt ${attempt}/${MAX_LOCATE_ATTEMPTS} — no result.`);
        }
        console.warn(`[Grounding] 💀 All attempts exhausted for "${query}"`);
        return { found: false, x: 0, y: 0, confidence: 0, source: 'vision-fallback', attempts: MAX_LOCATE_ATTEMPTS };
    }
}
exports.GroundingEngine = GroundingEngine;
// ── Utility: race promises but only resolve on truthy value ───────────────────
async function raceToFound(promises) {
    return new Promise((resolve) => {
        let settled = 0;
        for (const p of promises) {
            p.then(result => {
                if (result !== null)
                    resolve(result);
                else if (++settled === promises.length)
                    resolve(null);
            }).catch(() => { if (++settled === promises.length)
                resolve(null); });
        }
    });
}
/**
 * EnhancedGroundingEngine extends GroundingEngine with hybrid detection
 * and intelligent fallback logic combining DOM and visual approaches.
 */
class EnhancedGroundingEngine extends GroundingEngine {
    enhancedConfig;
    extensionElements = new Map();
    lastExtensionUpdate = 0;
    extensionUpdateTTL = 5000; // 5 seconds
    learningLog = [];
    maxLearningLogSize = 1000;
    selectorOptimizations = new Map(); // Maps queries to optimized selectors
    constructor(config) {
        super(config);
        this.enhancedConfig = {
            enableSoMDetection: true,
            fallbackToVisual: true,
            confidenceThreshold: 0.75,
            maxRetryAttempts: 3,
            enableExtensionData: true,
            ...config,
        };
    }
    /**
     * Update extension element data from Chrome extension
     * This data is used as a primary source for DOM-based detection
     */
    updateExtensionElements(elements) {
        this.extensionElements.clear();
        for (const el of elements) {
            this.extensionElements.set(el.selector, el);
        }
        this.lastExtensionUpdate = Date.now();
        console.log(`[EnhancedGrounding] Updated ${elements.length} extension elements`);
    }
    /**
     * Check if extension data is still fresh
     */
    isExtensionDataFresh() {
        return Date.now() - this.lastExtensionUpdate < this.extensionUpdateTTL;
    }
    /**
     * Try to match query against extension element data
     * Returns a VisualGroundingResult if a match is found
     */
    matchExtensionElements(query) {
        if (!this.enhancedConfig.enableExtensionData || !this.isExtensionDataFresh()) {
            return null;
        }
        const q = query.toLowerCase().trim();
        let bestMatch = null;
        let bestConfidence = 0;
        // Search through extension elements with scoring
        for (const [selector, el] of this.extensionElements) {
            const text = el.textContent.toLowerCase().trim();
            const ariaLabel = (el.ariaLabel || '').toLowerCase().trim();
            const dataTestId = (el.dataTestId || '').toLowerCase().trim();
            const tagName = el.tagName.toLowerCase();
            let confidence = 0;
            // Exact matches get highest confidence
            if (text === q || ariaLabel === q || dataTestId === q) {
                confidence = 0.98;
            }
            // Substring matches get good confidence
            else if (text.includes(q) || ariaLabel.includes(q) || dataTestId.includes(q)) {
                confidence = 0.85;
            }
            // Partial word matches
            else if (text.split(/\s+/).some(word => word.includes(q)) ||
                ariaLabel.split(/\s+/).some(word => word.includes(q))) {
                confidence = 0.75;
            }
            // Boost confidence for interactive elements
            if (confidence > 0 && el.isInteractive) {
                confidence = Math.min(0.99, confidence + 0.05);
            }
            // Track best match
            if (confidence > bestConfidence) {
                bestConfidence = confidence;
                bestMatch = { selector, el, confidence };
            }
        }
        if (bestMatch && bestConfidence >= this.enhancedConfig.confidenceThreshold) {
            const rect = bestMatch.el.boundingRect;
            const x = Math.round((rect.left + rect.right) / 2);
            const y = Math.round((rect.top + rect.bottom) / 2);
            console.log(`[EnhancedGrounding] ✅ Extension match: "${query}" → ${bestMatch.selector} (confidence: ${bestConfidence.toFixed(2)})`);
            return {
                found: true,
                x,
                y,
                confidence: bestConfidence,
                source: 'showui-local', // Treat as high-confidence DOM match
                method: 'dom',
                domSelector: bestMatch.selector,
                extensionData: bestMatch.el,
                visualConfidence: bestConfidence,
            };
        }
        return null;
    }
    /**
     * Validate coordinates against viewport bounds with detailed checks
     */
    validateCoordinates(x, y, imgW, imgH) {
        // Allow small margin for edge elements (10px)
        const margin = 10;
        // Check if coordinates are within reasonable bounds
        const withinBounds = x >= -margin && x <= imgW + margin && y >= -margin && y <= imgH + margin;
        if (!withinBounds) {
            console.warn(`[EnhancedGrounding] ⚠️ Coordinates out of bounds: (${x}, ${y}) vs viewport (${imgW}x${imgH})`);
            return false;
        }
        // Warn if coordinates are at extreme edges (might be unreliable)
        if (x < margin || x > imgW - margin || y < margin || y > imgH - margin) {
            console.warn(`[EnhancedGrounding] ⚠️ Coordinates at viewport edge: (${x}, ${y})`);
        }
        return true;
    }
    /**
     * Hybrid detection: try DOM first, then visual grounding
     * Combines extension data with visual grounding for robust element detection
     */
    async hybridDetection(screenshot, domElements, query, imgW, imgH) {
        console.log(`[EnhancedGrounding] 🔄 Hybrid detection for: "${query}"`);
        const startTime = Date.now();
        // Step 1: Try extension element matching (if available)
        if (domElements && domElements.length > 0) {
            this.updateExtensionElements(domElements);
            const extensionMatch = this.matchExtensionElements(query);
            if (extensionMatch && extensionMatch.confidence >= this.enhancedConfig.confidenceThreshold) {
                const duration = Date.now() - startTime;
                this.recordLearning(query, 'dom', extensionMatch.domSelector, extensionMatch.confidence, true, extensionMatch, imgW, imgH, duration);
                return extensionMatch;
            }
        }
        // Step 2: Try SoM text matching (fast path)
        const textMatch = this.matchElementByText(screenshot, query);
        if (textMatch && textMatch.confidence >= this.enhancedConfig.confidenceThreshold) {
            const duration = Date.now() - startTime;
            this.recordLearning(query, 'dom', undefined, textMatch.confidence, true, textMatch, imgW, imgH, duration);
            return {
                ...textMatch,
                method: 'dom',
                visualConfidence: textMatch.confidence,
            };
        }
        // Step 3: Fall back to visual grounding
        if (this.enhancedConfig.fallbackToVisual) {
            console.log(`[EnhancedGrounding] 📸 Falling back to visual grounding`);
            const visualResult = await this.locate(screenshot, imgW, imgH, query);
            if (visualResult.found) {
                // Validate coordinates
                if (!this.validateCoordinates(visualResult.x, visualResult.y, imgW, imgH)) {
                    console.warn(`[EnhancedGrounding] ⚠️ Visual result out of bounds: (${visualResult.x}, ${visualResult.y})`);
                    const duration = Date.now() - startTime;
                    this.recordLearning(query, 'visual', undefined, 0, false, undefined, imgW, imgH, duration, 'coordinates_out_of_bounds');
                    return {
                        found: false,
                        x: 0,
                        y: 0,
                        confidence: 0,
                        source: visualResult.source,
                        method: 'visual',
                        fallbackReason: 'coordinates_out_of_bounds',
                    };
                }
                const duration = Date.now() - startTime;
                this.recordLearning(query, 'visual', undefined, visualResult.confidence, true, visualResult, imgW, imgH, duration);
                return {
                    ...visualResult,
                    method: 'visual',
                    visualConfidence: visualResult.confidence,
                    fallbackReason: 'dom_insufficient',
                };
            }
        }
        // All methods failed
        const duration = Date.now() - startTime;
        this.recordLearning(query, 'hybrid', undefined, 0, false, undefined, imgW, imgH, duration, 'all_methods_failed');
        console.warn(`[EnhancedGrounding] ❌ Hybrid detection failed for: "${query}"`);
        return {
            found: false,
            x: 0,
            y: 0,
            confidence: 0,
            source: 'vision-fallback',
            method: 'hybrid',
            fallbackReason: 'all_methods_failed',
        };
    }
    /**
     * Record a visual interaction for learning and optimization
     */
    recordLearning(query, method, selector, confidence, success, result, viewportWidth, viewportHeight, duration, error) {
        const learning = {
            query,
            method,
            selector,
            confidence,
            timestamp: new Date().toISOString(),
            success,
            coordinates: result?.found ? { x: result.x, y: result.y } : undefined,
            viewportSize: { width: viewportWidth, height: viewportHeight },
        };
        this.learningLog.push(learning);
        // Keep learning log size manageable
        if (this.learningLog.length > this.maxLearningLogSize) {
            this.learningLog = this.learningLog.slice(-this.maxLearningLogSize);
        }
        // Log for debugging
        console.log(`[EnhancedGrounding] 📚 Learning recorded: ${method} for "${query}" (success: ${success}, confidence: ${confidence.toFixed(2)}, duration: ${duration}ms)`);
        // If successful with DOM method, store selector optimization
        if (success && method === 'dom' && selector) {
            this.selectorOptimizations.set(query, selector);
        }
    }
    /**
     * Get learning log for debugging and analysis
     */
    getLearningLog() {
        return [...this.learningLog];
    }
    /**
     * Get selector optimizations learned from successful interactions
     */
    getSelectorOptimizations() {
        return new Map(this.selectorOptimizations);
    }
    /**
     * Get learning statistics
     */
    getLearningStats() {
        if (this.learningLog.length === 0) {
            return {
                totalAttempts: 0,
                successRate: 0,
                averageConfidence: 0,
                methodBreakdown: {},
            };
        }
        const successful = this.learningLog.filter(l => l.success).length;
        const avgConfidence = this.learningLog.reduce((sum, l) => sum + l.confidence, 0) / this.learningLog.length;
        const methodBreakdown = {};
        for (const log of this.learningLog) {
            methodBreakdown[log.method] = (methodBreakdown[log.method] || 0) + 1;
        }
        return {
            totalAttempts: this.learningLog.length,
            successRate: successful / this.learningLog.length,
            averageConfidence: avgConfidence,
            methodBreakdown,
        };
    }
    /**
     * Locate with fallback: primary DOM detection with visual grounding fallback
     * This is the main entry point for enhanced grounding with intelligent fallback
     */
    async locateWithFallback(b64, imgW, imgH, query, domElements) {
        console.log(`[EnhancedGrounding] 🎯 Locate with fallback: "${query}"`);
        // Check cache first
        const ck = locateCacheKey(query, b64);
        const cached = locateCacheGet(ck);
        if (cached) {
            console.log(`[EnhancedGrounding] ⚡ Cache hit → (${cached.x}, ${cached.y})`);
            return {
                ...cached,
                method: 'dom',
            };
        }
        // Check if we have a learned selector for this query
        const learnedSelector = this.selectorOptimizations.get(query);
        if (learnedSelector && domElements) {
            const learnedElement = domElements.find(el => el.selector === learnedSelector);
            if (learnedElement) {
                const rect = learnedElement.boundingRect;
                const x = Math.round((rect.left + rect.right) / 2);
                const y = Math.round((rect.top + rect.bottom) / 2);
                if (this.validateCoordinates(x, y, imgW, imgH)) {
                    console.log(`[EnhancedGrounding] 🧠 Using learned selector: ${learnedSelector}`);
                    const result = {
                        found: true,
                        x,
                        y,
                        confidence: 0.92,
                        source: 'showui-local',
                        method: 'dom',
                        domSelector: learnedSelector,
                        extensionData: learnedElement,
                    };
                    locateCacheSet(ck, result);
                    return result;
                }
            }
        }
        // Try hybrid detection
        const result = await this.hybridDetection(b64, domElements, query, imgW, imgH);
        // Cache successful results with high confidence
        if (result.found && result.confidence >= 0.85) {
            locateCacheSet(ck, result);
        }
        return result;
    }
    /**
     * Intelligent method selection based on element type and page state
     * Determines whether to use DOM-first or visual-first approach
     */
    selectDetectionMethod(elementType, pageComplexity) {
        // For simple pages with known element types, prefer DOM
        if (pageComplexity === 'simple' && elementType && ['button', 'input', 'link'].includes(elementType)) {
            return 'dom';
        }
        // For complex pages or unknown elements, use hybrid
        if (pageComplexity === 'complex' || !elementType) {
            return 'hybrid';
        }
        // Default to hybrid for robustness
        return 'hybrid';
    }
    /**
     * Log grounding attempt for learning and debugging
     */
    logGroundingAttempt(query, method, success, confidence, duration, error) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            query,
            method,
            success,
            confidence,
            duration,
            error,
        };
        console.log(`[EnhancedGrounding] 📊 Attempt log:`, logEntry);
        // In a real implementation, this would be sent to a learning system
        // for improving future DOM selector generation and method selection
        // This is already handled by recordLearning() in hybridDetection
    }
    /**
     * Enhanced error handling with actionable messages
     */
    handleGroundingError(error, query, attemptedMethods) {
        console.error(`[EnhancedGrounding] ❌ Error during grounding: ${error.message}`);
        const fallbackReason = error.message.includes('timeout')
            ? 'timeout'
            : error.message.includes('confidence')
                ? 'low_confidence'
                : error.message.includes('not found')
                    ? 'element_not_found'
                    : 'unknown_error';
        // Log the error for learning
        this.recordLearning(query, 'hybrid', undefined, 0, false, undefined, 0, 0, 0, fallbackReason);
        return {
            found: false,
            x: 0,
            y: 0,
            confidence: 0,
            source: 'vision-fallback',
            method: 'hybrid',
            fallbackReason,
        };
    }
}
exports.EnhancedGroundingEngine = EnhancedGroundingEngine;
// ── Backward compatibility wrapper ───────────────────────────────────────────
/**
 * Factory function to create appropriate grounding engine
 * Returns EnhancedGroundingEngine if enhanced config is provided,
 * otherwise returns standard GroundingEngine for backward compatibility
 */
function createGroundingEngine(config) {
    if ('enableSoMDetection' in config || 'fallbackToVisual' in config) {
        return new EnhancedGroundingEngine(config);
    }
    return new GroundingEngine(config);
}
