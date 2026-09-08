'use client';

import { useEffect, useState } from 'react';

/**
 * Converts a raw base64 PNG screenshot to a downscaled object URL (~480px max width)
 * so full-resolution base64 payloads are not resident in the DOM.
 *
 * Falls back to the raw `data:image/...;base64,` URL when canvas APIs are
 * unavailable or decoding fails (e.g. SSR / test environments).
 */
export function useDownscaledImageUrl(
  base64: string | undefined,
  mime = 'image/png',
  maxWidth = 480,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let createdObjectUrl: string | null = null;

    const rawUrl = base64 ? `data:${mime};base64,${base64}` : null;

    const finish = (finalUrl: string | null) => {
      if (cancelled) {
        if (finalUrl && finalUrl.startsWith('blob:')) URL.revokeObjectURL(finalUrl);
        return;
      }
      setUrl(finalUrl);
    };

    const fallback = () => finish(rawUrl);

    if (!base64 || typeof window === 'undefined' || typeof document === 'undefined') {
      fallback();
      return () => { cancelled = true; };
    }

    // Guard non-browser / broken canvas environments
    const canvas = document.createElement('canvas');
    if (!canvas?.getContext?.('2d')) { fallback(); return () => { cancelled = true; }; }

    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const scale = img.naturalWidth > maxWidth ? maxWidth / img.naturalWidth : 1;
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { fallback(); return; }
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((blob) => {
          if (cancelled) return;
          if (blob) {
            createdObjectUrl = URL.createObjectURL(blob);
            finish(createdObjectUrl);
          } else {
            fallback();
          }
        }, mime === 'image/png' ? 'image/png' : 'image/jpeg', 0.82);
      } catch {
        fallback();
      }
    };
    img.onerror = () => fallback();
    img.src = rawUrl!;

    return () => {
      cancelled = true;
      if (createdObjectUrl) URL.revokeObjectURL(createdObjectUrl);
      img.onload = null;
      img.onerror = null;
    };
    // Keyed on the raw payload + mime so identical frames don't redo work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64, mime, maxWidth]);

  return url;
}
