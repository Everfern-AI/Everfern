'use client';

// CU-STRM-06: full-size base64 images (screenshots can be megabytes) were
// rendered inline for tiny 32–40px chips. This component lazily decodes the
// data URL off the critical path, downscales it once via canvas to a small
// cached thumbnail, and only then paints. The zoom modal keeps full-size.

import React, { useEffect, useState } from 'react';

const THUMB_MAX_DIM = 80; // 2x for the 40px chips; covers 32px chips too
const CACHE_CAP = 300;

const thumbCache = new Map<string, string>();
let cacheSize = 0;

function drawThumb(src: string): Promise<string> {
    return new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
            try {
                const scale = Math.min(1, THUMB_MAX_DIM / Math.max(img.width, img.height));
                const w = Math.max(1, Math.round(img.width * scale));
                const h = Math.max(1, Math.round(img.height * scale));
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(src); return; }
                ctx.drawImage(img, 0, 0, w, h);
                const thumb = canvas.toDataURL('image/webp', 0.8);
                resolve(thumb.startsWith('data:image/webp') ? thumb : canvas.toDataURL('image/png'));
            } catch {
                resolve(src);
            }
        };
        img.onerror = () => resolve(src);
        img.src = src;
    });
}

async function getThumb(src: string): Promise<string> {
    const cached = thumbCache.get(src);
    if (cached) {
        // LRU refresh
        thumbCache.delete(src);
        thumbCache.set(src, cached);
        return cached;
    }
    const thumb = await drawThumb(src);
    if (cacheSize >= CACHE_CAP) {
        const oldest = thumbCache.keys().next().value;
        if (oldest !== undefined) {
            thumbCache.delete(oldest);
            cacheSize--;
        }
    }
    thumbCache.set(src, thumb);
    cacheSize++;
    return thumb;
}

export const __strm06TestHooks = { thumbCache, drawThumb, getThumb, THUMB_MAX_DIM, CACHE_CAP };

export default function LazyBase64Thumb({
    base64,
    size,
    borderRadius,
    style,
}: {
    base64: string;
    size: number;
    borderRadius?: number;
    style?: React.CSSProperties;
}) {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getThumb(base64).then((thumb) => {
            if (!cancelled) setSrc(thumb);
        });
        return () => { cancelled = true; };
    }, [base64]);

    return (
        <div
            style={{
                width: size,
                height: size,
                borderRadius: borderRadius ?? 6,
                backgroundImage: `url(${src ?? base64})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                flexShrink: 0,
                ...style,
            }}
        />
    );
}
