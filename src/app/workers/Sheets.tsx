"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Search, X, Plus, Download, Check, Star } from "lucide-react";
import { AppLogo, AppLogoCluster } from "@/components/AppLogo";
import { APPS, APP_SECTIONS, type AppDef } from "@/lib/apps";
import { WORKER_TEMPLATES, type WorkerTemplate } from "@/lib/worker-templates";

const EASE = [0.16, 1, 0.3, 1] as const;
const CUSTOM_KEY = "everfern_custom_apps";

/** The sheet frame appears first, then its content fills in. */
const sheetMotion = {
  initial: { opacity: 0, y: 24, scale: 0.98, x: "-50%" },
  animate: { opacity: 1, y: 0, scale: 1, x: "-50%", transition: { duration: 0.45, ease: EASE } },
  exit: { opacity: 0, y: 16, scale: 0.98, x: "-50%", transition: { duration: 0.22, ease: EASE } },
};
const fill = {
  hidden: {},
  show: { transition: { delayChildren: 0.18, staggerChildren: 0.05 } },
};
const rowIn = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE } },
};

/** Make saved custom apps resolvable by id (AppLogo, prompt card) before the sheet opens. */
export function registerCustomApps() {
  try {
    (JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]") as AppDef[]).forEach((a) => (APPS[a.id] = a));
  } catch { /* ignore */ }
}

function useCustomApps() {
  const [apps, setApps] = useState<AppDef[]>([]);
  useEffect(() => {
    try {
      const list: AppDef[] = JSON.parse(localStorage.getItem(CUSTOM_KEY) || "[]");
      setApps(list);
      list.forEach((a) => (APPS[a.id] = a));
    } catch { /* ignore */ }
  }, []);
  const add = (a: AppDef) => {
    APPS[a.id] = a;
    setApps((prev) => {
      const next = [...prev.filter((p) => p.id !== a.id), a];
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
      return next;
    });
  };
  return { apps, add };
}

function toDomain(raw: string) {
  const s = raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

function SheetHead({ title, query, setQuery, placeholder, onClose }: {
  title: string; query: string; setQuery: (q: string) => void; placeholder: string; onClose: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => ref.current?.focus(), 250); return () => clearTimeout(t); }, []);
  return (
    <div className="wk-sheet-head">
      <h2 className="wk-sheet-title">{title}</h2>
      <label className="wk-search">
        <Search size={14} />
        <input ref={ref} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} />
      </label>
      <button className="wk-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
    </div>
  );
}

export function AppsSheet({
  installed, onToggle, onClose, canInstall,
}: {
  installed: string[]; onToggle: (id: string) => void; onClose: () => void; canInstall: boolean;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [site, setSite] = useState("");
  const custom = useCustomApps();
  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const base = [
      ...(custom.apps.length ? [{ id: "custom", title: "Your apps", apps: custom.apps.map((a) => a.id) }] : []),
      ...APP_SECTIONS,
    ];
    if (!q) return base;
    return base
      .map((s) => ({ ...s, apps: s.apps.filter((id) => APPS[id] && (APPS[id].name.toLowerCase().includes(q) || APPS[id].domain?.includes(q))) }))
      .filter((s) => s.apps.length);
  }, [q, custom.apps]);

  const domain = toDomain(site);
  const addSite = () => {
    if (!domain) return;
    const name = domain.split(".").slice(-2, -1)[0] ?? domain;
    const app: AppDef = {
      id: `custom:${domain}`, name: name.charAt(0).toUpperCase() + name.slice(1), domain,
      blurb: `Custom app for ${domain}`, rating: 5, ratings: 0,
    };
    custom.add(app);
    if (canInstall && !installed.includes(app.id)) onToggle(app.id);
    setSite(""); setAdding(false);
  };

  return (
    <motion.section className="wk-sheet wk-glass" {...sheetMotion} role="dialog" aria-label="Apps">
      <SheetHead title="Apps" query={query} setQuery={setQuery} placeholder="Browse apps..." onClose={onClose} />
      <motion.div className="wk-sheet-body" variants={fill} initial="hidden" animate="show">
        {!q && (
          <motion.div className="wk-custom" variants={rowIn}>
            {adding ? (
              <>
                <input
                  autoFocus value={site} onChange={(e) => setSite(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") addSite(); if (e.key === "Escape") setAdding(false); }}
                  placeholder="Website the worker should use, e.g. app.acme.com"
                />
                {domain && <AppLogo app={{ id: "preview", name: domain, domain, blurb: "", rating: 0, ratings: 0 }} size={30} />}
                <button className="wk-gpill is-sm is-white" onClick={addSite} disabled={!domain}>Add</button>
                <button className="wk-gpill is-sm" onClick={() => setAdding(false)}>Cancel</button>
              </>
            ) : (
              <>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="wk-custom-title">Custom apps</div>
                  <div className="wk-custom-sub">Add any website or internal tool and give it to your workers.</div>
                </div>
                <button className="wk-gpill is-sm" onClick={() => setAdding(true)}><Plus size={14} /> Create app</button>
              </>
            )}
          </motion.div>
        )}

        {sections.map((s) => (
          <motion.div key={s.id} variants={rowIn}>
            <div className="wk-sec">{s.title}</div>
            <div className="wk-apps">
              {s.apps.map((id) => {
                const a = APPS[id];
                if (!a) return null;
                const on = installed.includes(id);
                return (
                  <div className="wk-app" key={id}>
                    <AppLogo app={a} size={30} />
                    <div style={{ minWidth: 0 }}>
                      <div className="wk-app-name">{a.name}</div>
                      <div className="wk-app-meta">
                        <Star size={10} fill="currentColor" strokeWidth={0} /> {a.rating.toFixed(1)} · {a.ratings} {a.ratings === 1 ? "rating" : "ratings"}
                      </div>
                    </div>
                    <button
                      className={`wk-app-btn${on ? " is-on" : ""}`}
                      onClick={() => onToggle(id)}
                      disabled={!canInstall}
                      title={!canInstall ? "Open a worker to add apps" : on ? `Remove ${a.name}` : `Add ${a.name}`}
                      aria-pressed={on}
                    >
                      {on ? <Check size={14} strokeWidth={2.6} /> : <Download size={13} />}
                    </button>
                  </div>
                );
              })}
            </div>
          </motion.div>
        ))}
        {!sections.length && <div className="wk-empty">No apps match &ldquo;{query}&rdquo;. Add it as a custom app instead.</div>}
      </motion.div>
    </motion.section>
  );
}

export function TemplateCard({ t, onPick }: { t: WorkerTemplate; onPick: (t: WorkerTemplate) => void }) {
  return (
    <motion.button type="button" className="wk-card wk-tpl" variants={rowIn} onClick={() => onPick(t)}>
      <AppLogoCluster apps={t.apps} />
      <div className="wk-tpl-title">{t.title}</div>
      <div className="wk-tpl-desc">{t.description}</div>
    </motion.button>
  );
}

export function TemplatesSheet({ onPick, onClose }: { onPick: (t: WorkerTemplate) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = WORKER_TEMPLATES.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.apps.some((a) => APPS[a]?.name.toLowerCase().includes(q)),
  );
  return (
    <motion.section className="wk-sheet wk-glass" {...sheetMotion} role="dialog" aria-label="Templates">
      <SheetHead title="Templates" query={query} setQuery={setQuery} placeholder="Search templates..." onClose={onClose} />
      <motion.div className="wk-sheet-body" variants={fill} initial="hidden" animate="show">
        <div className="wk-tpl-row" style={{ marginTop: 8 }}>
          {list.map((t) => <TemplateCard key={t.id} t={t} onPick={onPick} />)}
        </div>
        {!list.length && <div className="wk-empty">No templates match &ldquo;{query}&rdquo;.</div>}
      </motion.div>
    </motion.section>
  );
}
