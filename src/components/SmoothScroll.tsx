"use client";

import { useEffect } from "react";

/**
 * App-wide smooth wheel scrolling.
 *
 * The desktop app scrolls inside nested panels (chat, settings, side panes), not the
 * window, so a window-level Lenis would do nothing. Instead one wheel listener finds the
 * nearest panel that can scroll in the wheel's direction and eases it toward a target.
 *
 * Opt out on any element with `data-native-scroll`. Text inputs, code editors and
 * terminals keep native scrolling. Horizontal scroll, pinch-zoom and reduced motion
 * are left alone. Programmatic scrolls (auto-scroll to the latest message) win: if
 * something else moves a panel mid-animation, the animation stops.
 */

const NATIVE = "textarea, select, [data-native-scroll], .monaco-editor, .cm-editor, .xterm";
const LERP = 0.14; // fraction of the remaining distance covered per frame (60fps)
const WHEEL_MULTIPLIER = 1;

type Anim = { target: number; pos: number; read: number };

export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const anims = new Map<Element, Anim>();
    let raf = 0;
    let lastT = 0;

    const maxY = (el: Element) => el.scrollHeight - el.clientHeight;

    const canScroll = (el: Element) => {
      if (maxY(el) <= 1) return false;
      if (el === document.scrollingElement) return true;
      const oy = getComputedStyle(el).overflowY;
      return oy === "auto" || oy === "scroll" || oy === "overlay";
    };

    const setTop = (el: Element, top: number) => {
      // "instant" overrides any CSS scroll-behavior: smooth on the panel
      el.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    };

    const tick = (t: number) => {
      const dt = lastT ? Math.min(64, t - lastT) : 16.7;
      lastT = t;
      const k = 1 - Math.pow(1 - LERP, dt / 16.7); // frame-rate independent easing

      anims.forEach((a, el) => {
        if (!el.isConnected || Math.abs(el.scrollTop - a.read) > 1.5) {
          anims.delete(el); // removed, or scrolled by someone else
          return;
        }
        a.target = Math.max(0, Math.min(maxY(el), a.target));
        a.pos += (a.target - a.pos) * k;
        if (Math.abs(a.target - a.pos) < 0.5) {
          setTop(el, a.target);
          anims.delete(el);
          return;
        }
        setTop(el, a.pos);
        a.read = el.scrollTop;
      });

      if (anims.size) raf = requestAnimationFrame(tick);
      else { raf = 0; lastT = 0; }
    };

    const onWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const dy = e.deltaY * unit * WHEEL_MULTIPLIER;
      if (!dy) return;

      let node: Element | null = e.target instanceof Element ? e.target : (e.target as Node | null)?.parentElement ?? null;
      if (!node || node.closest(NATIVE)) return;

      for (; node; node = node.parentElement) {
        if (!canScroll(node)) continue;
        const a = anims.get(node);
        const from = a ? a.target : node.scrollTop;
        const max = maxY(node);

        if ((dy < 0 && from > 0.5) || (dy > 0 && from < max - 0.5)) {
          e.preventDefault();
          const target = Math.max(0, Math.min(max, from + dy));
          if (a) a.target = target;
          else anims.set(node, { target, pos: node.scrollTop, read: node.scrollTop });
          if (!raf) raf = requestAnimationFrame(tick);
          return;
        }

        // At its edge: chain to the parent unless the panel forbids it
        const ob = getComputedStyle(node).overscrollBehaviorY;
        if (ob === "contain" || ob === "none") return;
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
