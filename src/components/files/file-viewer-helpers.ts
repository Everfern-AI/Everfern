// Pure helpers extracted from FileViewerModal during the NR-PERF fix-wave.
// No React/DOM imports allowed here: these are unit-tested in a plain node
// environment and shared across the file viewers.

// ── NR-PERF-02: bound how much file text the renderer ever handles ──
// Mirrors the 50k truncation pattern used by TerminalView in ToolDetailSidePanel.
export const MAX_VIEWER_CHARS = 50000;
export const MAX_RENDER_LINES = 2000;

export interface ContentTruncation {
    totalLines: number;
    truncatedLines: number;
    charLimited: boolean;
}

export interface CappedContent extends ContentTruncation {
    text: string;
}

function countLines(text: string): number {
    let lines = 1;
    for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) lines++;
    }
    return lines;
}

export function capViewerContent(content: string, maxChars: number = MAX_VIEWER_CHARS): CappedContent {
    const totalLines = countLines(content);
    if (content.length <= maxChars) {
        return { text: content, totalLines, truncatedLines: 0, charLimited: false };
    }
    const hardCut = content.substring(0, maxChars);
    const lastNewline = hardCut.lastIndexOf('\n');
    // Prefer cutting on a line boundary so highlighted rows stay intact.
    const cut = lastNewline > 0 ? hardCut.substring(0, lastNewline) : hardCut;
    return {
        text: cut,
        totalLines,
        truncatedLines: Math.max(0, totalLines - countLines(cut)),
        charLimited: true,
    };
}

export function sliceRenderLines(lines: string[], maxLines: number = MAX_RENDER_LINES): { lines: string[]; hiddenLines: number } {
    if (lines.length <= maxLines) return { lines, hiddenLines: 0 };
    return { lines: lines.slice(0, maxLines), hiddenLines: lines.length - maxLines };
}

// ── NR-PERF-03: chunked base64 → Uint8Array ──────────────────────────
// Replaces the previous whole-file atob + boxed-array loop that transiently
// allocated ~800MB for a 100MB PDF. No ArrayBuffer-returning read API exists
// in preload yet, so this converts the base64 data URL in bounded chunks.
export const MAX_PDF_PREVIEW_BYTES = 64 * 1024 * 1024;

export function chunkedBase64ToUint8Array(base64: string, chunkSize: number = 32768): Uint8Array {
    if (chunkSize <= 0 || chunkSize % 4 !== 0) {
        throw new Error('chunkSize must be a positive multiple of 4');
    }
    let clean = base64;
    const commaIndex = clean.indexOf(',');
    if (commaIndex > 0 && clean.slice(0, 5).toLowerCase() === 'data:') {
        clean = clean.slice(commaIndex + 1);
    }
    clean = clean.replace(/\s+/g, '');
    if (clean.length === 0) return new Uint8Array(0);
    if (clean.length % 4 !== 0) throw new Error('Invalid base64 payload length');
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    const totalBytes = (clean.length / 4) * 3 - padding;
    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (let i = 0; i < clean.length; i += chunkSize) {
        const chunk = clean.substring(i, Math.min(i + chunkSize, clean.length));
        const decoded = atob(chunk);
        for (let j = 0; j < decoded.length; j++) {
            out[offset + j] = decoded.charCodeAt(j);
        }
        offset += decoded.length;
    }
    return out;
}

// ── NR-PERF-08: CSV/TSV parse extracted from ExcelViewer ────────────
// Parsed once per (filename, content) via useMemo instead of char-by-char
// on every render. Behavior is byte-for-byte the original parser.
export function parseDelimitedContent(filename: string, content: string | null): string[][] {
    if (!content) return [];
    if (!(filename.endsWith('.csv') || filename.endsWith('.tsv') || content.includes(',') || content.includes('\t'))) {
        return [];
    }
    const delimiter = filename.endsWith('.tsv') ? '\t' : ',';
    return content
        .split('\n')
        .map(row => {
            const cells: string[] = [];
            let insideQuote = false;
            let currentCell = '';
            for (let i = 0; i < row.length; i++) {
                const char = row[i];
                if (char === '"') insideQuote = !insideQuote;
                else if (char === delimiter && !insideQuote) {
                    cells.push(currentCell.replace(/^"|"$/g, '').trim());
                    currentCell = '';
                } else {
                    currentCell += char;
                }
            }
            cells.push(currentCell.replace(/^"|"$/g, '').trim());
            return cells;
        })
        .filter(row => row.length > 1 || (row[0] && row[0] !== ''));
}
