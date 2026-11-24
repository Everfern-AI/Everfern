import { useEffect, useRef, useState } from "react";

/**
 * Turns bursty streamed text into a fast, steady typing reveal.
 *
 * Chunks arrive from the model in uneven bursts. This reveals them frame by
 * frame at a quick base speed, and speeds up whenever the reveal falls
 * behind, so the text always feels live but never lags far behind the
 * model. When streaming stops, the full text is shown at once.
 */
const BASE_CHARS_PER_SEC = 420;
const MAX_LAG_MS = 220;

export function useSmoothText(target: string, active: boolean): string {
    const [shown, setShown] = useState(target);
    const shownLenRef = useRef(target.length);
    const targetRef = useRef(target);
    const rafRef = useRef<number | null>(null);
    const lastTsRef = useRef<number | null>(null);
    const shownTextRef = useRef(target);

    targetRef.current = target;

    useEffect(() => {
        const reduceMotion =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        // Not streaming, or the text was replaced rather than extended: show it as is.
        const shownSoFar = target.slice(0, shownLenRef.current);
        if (!active || reduceMotion || shownLenRef.current > target.length || shownTextRef.current !== shownSoFar) {
            shownLenRef.current = target.length;
            shownTextRef.current = target;
            setShown(target);
            return;
        }
        if (rafRef.current !== null) return; // a reveal loop is already running

        const tick = (ts: number) => {
            const full = targetRef.current;
            const last = lastTsRef.current ?? ts;
            const dt = Math.min(64, ts - last);
            lastTsRef.current = ts;

            const backlog = full.length - shownLenRef.current;
            if (backlog <= 0) {
                rafRef.current = null;
                lastTsRef.current = null;
                return;
            }
            const step = Math.max(
                1,
                Math.round((BASE_CHARS_PER_SEC * dt) / 1000),
                Math.ceil((backlog * dt) / MAX_LAG_MS),
            );
            let next = Math.min(full.length, shownLenRef.current + step);
            // Do not stop inside a surrogate pair (emoji and other astral characters).
            const code = full.charCodeAt(next - 1);
            if (code >= 0xd800 && code <= 0xdbff && next < full.length) next += 1;
            shownLenRef.current = next;
            shownTextRef.current = full.slice(0, next);
            setShown(shownTextRef.current);
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [target, active]);

    useEffect(() => () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    }, []);

    return shown;
}
