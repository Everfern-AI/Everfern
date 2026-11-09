"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "@/lib/use-dialog-focus";

export function ConfirmDialog({ title, description, confirmLabel = "Delete", onConfirm, onClose }: {
  title: string; description: string; confirmLabel?: string;
  onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ref = useDialogFocus(true, () => { if (!busy) onClose(); });
  const confirm = async () => {
    setBusy(true); setError("");
    try { await onConfirm(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn’t complete this action. Please try again."); }
    finally { setBusy(false); }
  };
  return createPortal(<div className="ef-confirm-backdrop" onClick={() => !busy && onClose()}>
    <section ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="ef-confirm-title" aria-describedby="ef-confirm-description" className="ef-confirm" onClick={event => event.stopPropagation()}>
      <h2 id="ef-confirm-title">{title}</h2><p id="ef-confirm-description">{description}</p>
      {error && <p role="alert">{error}</p>}
      <div><button disabled={busy} onClick={onClose}>Cancel</button><button className="is-destructive" disabled={busy} onClick={confirm}>{busy ? "Working…" : confirmLabel}</button></div>
    </section>
  </div>, document.body);
}
