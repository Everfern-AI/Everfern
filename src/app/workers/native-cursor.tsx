"use client";

import React, { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * The AI's cursor inside a native app (Files, Terminal). The app tells it which
 * element to go to; it glides there, shows a short verb chip ("Right-click",
 * "Type", "Return") and a ping on each click. No pixel coordinates from the AI:
 * targets are found in the app's own DOM by data attributes.
 */

export type NativeCursorState = { x: number; y: number; verb: string; label: string; ping: number } | null;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Faster when the user prefers less motion: same steps, shorter pauses. */
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
export const pace = (ms: number) => (reduced() ? Math.round(ms * 0.35) : ms);

export function useNativeCursor(rootRef: React.RefObject<HTMLElement | null>) {
  const [cur, setCur] = useState<NativeCursorState>(null);
  const last = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const label = useRef("");

  const pointOf = (target: Element | { x: number; y: number } | null, at: "center" | "left" = "center") => {
    const root = rootRef.current;
    if (!root || !target) return last.current;
    const r = root.getBoundingClientRect();
    if (!(target instanceof Element)) return target;
    const t = target.getBoundingClientRect();
    // Fields are clicked near where text starts; everything else dead centre.
    const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const px = at === "left" && field ? t.left + Math.min(18, t.width / 2) : t.left + t.width / 2;
    return { x: (px - r.left) / Math.max(1, r.width), y: (t.top + t.height / 2 - r.top) / Math.max(1, r.height) };
  };

  /** Glide to a target. `target` is an element or a 0-1 point inside the app. */
  const moveTo = useCallback(async (target: Element | { x: number; y: number } | null, verb: string, opts?: { at?: "center" | "left"; dwell?: number }) => {
    const p = pointOf(target, opts?.at);
    last.current = p;
    setCur((c) => ({ x: p.x, y: p.y, verb, label: label.current, ping: c?.ping ?? 0 }));
    await sleep(pace(opts?.dwell ?? 560));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A click (or right-click / double-click) where the cursor is. */
  const click = useCallback(async (verb = "Click", times = 1) => {
    for (let i = 0; i < times; i++) {
      setCur((c) => (c ? { ...c, verb, ping: c.ping + 1 } : c));
      await sleep(pace(times > 1 ? 130 : 220));
    }
  }, []);

  const say = useCallback((verb: string, text?: string) => {
    if (text !== undefined) label.current = text;
    setCur((c) => (c ? { ...c, verb, label: label.current } : { ...last.current, verb, label: label.current, ping: 0 }));
  }, []);

  const hide = useCallback(() => { label.current = ""; setCur(null); }, []);

  return { cur, moveTo, click, say, hide };
}

/**
 * The AI's cursor, shared by every window: a liquid-glass orb whose centre is the exact spot,
 * pressing in and springing back on each click, and a glass pill saying what it's doing.
 * `pressDelay` lets the press land when a gliding cursor arrives, not when it sets off.
 */
/** Where the pill goes: the side of the cursor with more room, and no wider than that room. */
export function pillSide(x: number, width: number) {
  const gap = 22 + 10; // orb offset plus a margin from the window edge
  const right = width - x - gap, left = x - gap;
  const flip = right < 260 && left > right;
  return { flip, room: Math.max(120, Math.floor(flip ? left : right)) };
}

/** "Navigating to https://www.google.com/travel/flights?..." reads as "Navigating to google.com". */
export const shortLabel = (s: string) => s.replace(/\bhttps?:\/\/(?:www\.)?([^/\s?#]+)\S*/gi, "$1");

export function AiPointer({ press, label, flip, room, pressDelay = 0 }: { press: number; label?: string; flip?: boolean; room?: number; pressDelay?: number }) {
  const delay = { "--ai-press-delay": `${pressDelay}s` } as React.CSSProperties;
  const text = label ? shortLabel(label) : "";
  return (
    <>
      {press > 0 && <span className="wk-ai-ping" key={`ping-${press}`} style={delay} />}
      <span className={`wk-ai-orb lg-glass${press > 0 ? " is-pressing" : ""}`} key={`orb-${press}`} style={delay}>
        <span className="wk-ai-orb-dot" />
      </span>
      <AnimatePresence mode="popLayout" initial={false}>
        {text && (
          <motion.span
            key={text}
            className={`wk-ai-bubble lg-glass${flip ? " is-left" : ""}`}
            style={room ? ({ "--ai-room": `${room}px` } as React.CSSProperties) : undefined}
            title={label}
            initial={{ opacity: 0, x: flip ? 8 : -8, scale: 0.94, filter: "blur(4px)" }}
            animate={{ opacity: 1, x: 0, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.94, filter: "blur(4px)" }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
          >
            <span className="wk-ai-spin" aria-hidden="true" />
            <span className="wk-ai-text">{text}</span>
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

export function NativeCursor({ cur }: { cur: NativeCursorState }) {
  // Without a running step the pill names the gesture ("Click", "Type") instead.
  const label = cur ? cur.label || cur.verb : "";
  return (
    <AnimatePresence>
      {cur && (
        <motion.div className="wk-ai wk-native-ai" key="native-ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
          <motion.div
            className="wk-ai-cursor"
            initial={false}
            animate={{ left: `${cur.x * 100}%`, top: `${cur.y * 100}%` }}
            transition={{ type: "spring", bounce: 0, duration: 0.45 }}
          >
            <AiPointer press={cur.ping} label={label} flip={cur.x > 0.6} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Type `text` into a setter one character at a time, then hand over the rest at once. */
export async function typeInto(text: string, set: (v: string) => void, prefix = "", cap = 360, cancelled?: () => boolean) {
  const shown = text.slice(0, cap);
  for (let i = 1; i <= shown.length; i++) {
    if (cancelled?.()) return;
    set(prefix + shown.slice(0, i));
    const ch = shown[i - 1];
    await sleep(pace(ch === " " ? 55 : ch === "\n" ? 120 : 26 + Math.random() * 30));
  }
  if (text.length > cap) set(prefix + text);
}

export const shq = (v: string) => "'" + v.replace(/'/g, "'\\''") + "'";
