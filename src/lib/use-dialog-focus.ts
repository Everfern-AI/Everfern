"use client";

import { useLayoutEffect, useRef } from "react";

const dialogs: HTMLElement[] = [];

/** Keep keyboard navigation in a sheet and return focus to its opener. */
export function useDialogFocus<T extends HTMLElement = HTMLElement>(enabled = true, onClose?: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const wasEnabled = useRef(false);
  const openerRef = useRef<HTMLElement | null>(null);
  // Capture before a descendant's autoFocus runs during commit.
  if (enabled && !wasEnabled.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasEnabled.current = enabled;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || !enabled) return;
    const opener = openerRef.current;
    dialogs.push(root);
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]',
    )).filter(el => el.getClientRects().length && !el.closest('[inert]'));
    (root.querySelector<HTMLElement>('input[type="search"]') ?? controls()[0] ?? root).focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (dialogs.at(-1) !== root) return;
      if (event.key === "Escape" && closeRef.current) {
        event.preventDefault(); event.stopImmediatePropagation(); closeRef.current(); return;
      }
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); root.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", trap, true);
    return () => {
      document.removeEventListener("keydown", trap, true);
      const wasTop = dialogs.at(-1) === root;
      const index = dialogs.indexOf(root);
      if (index >= 0) dialogs.splice(index, 1);
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [enabled]);
  return ref;
}
