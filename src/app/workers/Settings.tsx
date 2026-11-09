"use client";

import React, { useEffect, useState } from "react";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { motion } from "framer-motion";
import { User, LayoutGrid, CreditCard, Sparkles, Server, CircleHelp, LogOut, KeyRound, Bell, X, Check, ExternalLink } from "lucide-react";
import { AppLogoCluster } from "@/components/AppLogo";
import { ModelTab, MachineTab } from "./ModelSettings";
import type { Worker } from '@/lib/workers';

/**
 * Settings: a light page that slides over the worker's screen.
 * Top row of icon tabs, then a segmented control for sub-pages.
 */

const SESSION_KEY = "everfern_cloud_session";
const NOTIFY_KEY = "everfern_notify_prefs";
const EASE = [0.16, 1, 0.3, 1] as const;

type Tab = "account" | "worker" | "model" | "machine" | "subscription" | "help";
export type SettingsSection = Tab | 'notifications';
type WorkerLite = { id: string; name: string; tier: string; apps: string[]; status: string };

function readSession(): { user?: { email?: string; name?: string; full_name?: string; fullName?: string; plan?: string } } | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`st-toggle${on ? " is-on" : ""}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

function Segments<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; icon: React.ElementType }[] }) {
  return (
    <div className="st-seg" role="tablist">
      {items.map(({ id, label, icon: Icon }) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? "is-on" : ""} onClick={() => onChange(id)}>
          <Icon size={12} /> {label}
        </button>
      ))}
    </div>
  );
}

function AccountTab({ initialSection = 'account' }: { initialSection?: 'account' | 'notifications' }) {
  const [sub, setSub] = useState<"account" | "passwords" | "notifications">(initialSection);
  useEffect(() => setSub(initialSection), [initialSection]);
  const [session, setSession] = useState<ReturnType<typeof readSession>>(null);
  const [prefs, setPrefs] = useState({ email: false, push: false });
  const [saved, setSaved] = useState(true);
  const [name, setName] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    const s = readSession();
    setSession(s);
    setName(s?.user?.fullName ?? s?.user?.full_name ?? s?.user?.name ?? "");
    try { setPrefs({ email: false, push: false, ...JSON.parse(localStorage.getItem(NOTIFY_KEY) || "{}") }); } catch { /* defaults */ }
  }, []);

  const email = session?.user?.email;
  const set = (p: Partial<typeof prefs>) => { setPrefs((x) => ({ ...x, ...p })); setSaved(false); };
  const save = () => {
    try {
      const current = readSession();
      if (current?.user) {
        const next = { ...current, user: { ...current.user, name: name.trim(), full_name: name.trim(), fullName: name.trim() } };
        localStorage.setItem(SESSION_KEY, JSON.stringify(next));
        setSession(next);
      }
      localStorage.setItem(NOTIFY_KEY, JSON.stringify(prefs));
      setSaveError("");
    } catch { setSaveError("Couldn’t save changes on this device. Please try again."); return; }
    if (prefs.push && typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    setSaved(true);
  };

  return (
    <>
      <Segments value={sub} onChange={setSub} items={[
        { id: "account", label: "Account", icon: User },
        { id: "passwords", label: "Password manager", icon: KeyRound },
        { id: "notifications", label: "Notifications", icon: Bell },
      ]} />
      {sub === "account" && (
        <div className="st-list">
          <div className="st-row">
            <div><div className="st-label">Name</div><div className="st-help">Shown to your workers when they write to you.</div></div>
            <input className="st-input" aria-label="Your name" value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} placeholder="Your name" />
          </div>
          <div className="st-row">
            <div><div className="st-label">Email</div><div className="st-help">{email ?? "Not signed in. Sign in to sync workers across devices."}</div></div>
            {!email && <a className="st-btn" href="/auth">Sign in</a>}
          </div>
        </div>
      )}
      {sub === "passwords" && (
        <div className="st-list">
          <div className="st-row">
            <div>
              <div className="st-label">Keep your sign-ins</div>
              <div className="st-help">Cloud workers keep separate browser profiles and a cookie backup on this computer, so replacing a VM keeps their sign-ins. Your local VM also keeps an encrypted cookie backup outside the VM. Sites may still ask you to sign in again when a session expires.</div>
            </div>
          </div>
        </div>
      )}
      {sub === "notifications" && (
        <div className="st-list">
          <div className="st-row">
            <div><div className="st-label">Email</div><div className="st-help">{email ? `Notifications will be sent to: ${email}` : "Sign in to get email notifications."}</div></div>
            <Toggle label="Email notifications" on={prefs.email && !!email} onChange={(v) => email && set({ email: v })} />
          </div>
          <div className="st-row">
            <div><div className="st-label">Push notifications</div><div className="st-help">When a worker finishes or needs you.</div></div>
            <Toggle label="Push notifications" on={prefs.push} onChange={(v) => set({ push: v })} />
          </div>
        </div>
      )}
      {sub !== "passwords" && (
        <div className="st-actions">
          {saveError && <p role="alert">{saveError}</p>}
          <button className="st-save" onClick={save} disabled={saved}><Check size={13} /> {saved ? "Saved" : "Save changes"}</button>
        </div>
      )}
    </>
  );
}

function WorkerTab({ workers }: { workers: WorkerLite[] }) {
  return (
    <div className="st-list">
      {!workers.length && <div className="st-row"><div className="st-help">No workers yet.</div></div>}
      {workers.map((w) => (
        <div className="st-row" key={w.id}>
          <div><div className="st-label">{w.name}</div><div className="st-help">{w.status} · {w.tier}</div></div>
          <AppLogoCluster apps={w.apps.slice(0, 5)} size={22} />
        </div>
      ))}
    </div>
  );
}

function SubscriptionTab() {
  const plan = readSession()?.user?.plan ?? "Free";
  return (
    <div className="st-list">
      <div className="st-row">
        <div><div className="st-label">Current plan</div><div className="st-help">{plan}. Local models are always free; EverFern Cloud uses credits.</div></div>
        <a className="st-btn" href="https://everfern.app/pricing" target="_blank" rel="noreferrer">Manage <ExternalLink size={12} /></a>
      </div>
    </div>
  );
}

function HelpTab() {
  const links = [
    { label: "Discord community", help: "Ask questions, share workers and get help from the team.", href: "https://discord.gg/4zR2jk799a" },
    { label: "Contact support", help: "preetham.rangu@gmail.com. We usually reply within a day.", href: "mailto:preetham.rangu@gmail.com" },
    { label: "Documentation", help: "Guides for creating and teaching workers.", href: "https://everfern.app/docs" },
    { label: "Report a bug", help: "Open an issue on GitHub.", href: "https://github.com/everfern/everfern/issues" },
  ];
  return (
    <div className="st-list">
      {links.map((l) => (
        <div className="st-row" key={l.label}>
          <div><div className="st-label">{l.label}</div><div className="st-help">{l.help}</div></div>
          <a className="st-btn" href={l.href} target="_blank" rel="noreferrer">Open <ExternalLink size={12} /></a>
        </div>
      ))}
    </div>
  );
}

export function SettingsSheet({ workers, onSaveWorker, onClose, onLogout, initialTab = 'account' }: { workers: Worker[]; onSaveWorker: (worker: Worker) => void; onClose: () => void; onLogout: () => void; initialTab?: SettingsSection }) {
  const dialogRef = useDialogFocus();
  const [tab, setTab] = useState<Tab>(initialTab === 'notifications' ? 'account' : initialTab);
  useEffect(() => setTab(initialTab === 'notifications' ? 'account' : initialTab), [initialTab]);
  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "account", label: "Account", icon: User },
    { id: "worker", label: "Worker", icon: LayoutGrid },
    { id: "model", label: "AI model", icon: Sparkles },
    { id: "machine", label: "Machine", icon: Server },
    { id: "subscription", label: "Subscription", icon: CreditCard },
    { id: "help", label: "Help & Support", icon: CircleHelp },
  ];
  return (
    <motion.section
      ref={dialogRef} tabIndex={-1} className="st" role="dialog" aria-modal="true" aria-label="Settings"
      initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.2, ease: EASE } }}
    >
      <button className="st-close" onClick={onClose} aria-label="Close settings"><X size={14} /></button>
      <nav className="st-tabs">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            <Icon size={15} /> <span>{label}</span>
          </button>
        ))}
        <button className="is-logout" onClick={onLogout}><LogOut size={15} /> <span>Logout</span></button>
      </nav>
      <div className="st-body">
        {tab === "account" && <AccountTab initialSection={initialTab === 'notifications' ? 'notifications' : 'account'} />}
        {tab === "worker" && <WorkerTab workers={workers} />}
        {tab === "model" && <ModelTab />}
        {tab === "machine" && <MachineTab workers={workers} onSaveWorker={onSaveWorker} />}
        {tab === "subscription" && <SubscriptionTab />}
        {tab === "help" && <HelpTab />}
      </div>
    </motion.section>
  );
}

export function logoutLocal() {
  localStorage.removeItem(SESSION_KEY);
}
