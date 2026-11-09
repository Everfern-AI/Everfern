"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, X, Plus, Download, Check, Star, ArrowLeft, ChevronRight, MessageSquarePlus } from "lucide-react";
import { useDialogFocus } from "@/lib/use-dialog-focus";
import { AppLogo, AppLogoCluster } from "@/components/AppLogo";
import { APPS, APP_SECTIONS, type AppDef, type AppReview } from "@/lib/apps";
import { WORKER_TEMPLATES, type WorkerTemplate } from "@/lib/worker-templates";

const EASE = [0.16, 1, 0.3, 1] as const;
const CUSTOM_KEY = "everfern_custom_apps";

/** The sheet frame appears first, then its content fills in. */
const sheetMotion = {
  initial: { opacity: 0, y: 12, scale: 0.985, x: "-50%" },
  animate: { opacity: 1, y: 0, scale: 1, x: "-50%", transition: { type: "spring" as const, duration: 0.35, bounce: 0 } },
  exit: { opacity: 0, y: 12, scale: 0.985, x: "-50%", transition: { duration: 0.22, ease: EASE } },
};
const fill = {
  hidden: {},
  show: { transition: { staggerChildren: 0.025 } },
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
    const next = [...apps.filter((p) => p.id !== a.id), a];
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
    APPS[a.id] = a;
    setApps(next);
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
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);
  return (
    <div className="wk-sheet-head">
      <h2 className="wk-sheet-title">{title}</h2>
      <label className="wk-search">
        <Search size={14} />
        <input ref={ref} type="search" aria-label={placeholder.replace("...", "")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} />
      </label>
      <button className="wk-x" onClick={onClose} aria-label="Close"><X size={16} /></button>
    </div>
  );
}

export function AppProductPage({
  app,
  installed,
  onToggle,
  onBack,
  onClose,
  canInstall,
}: {
  app: AppDef;
  installed: boolean;
  onToggle: () => void;
  onBack: () => void;
  onClose: () => void;
  canInstall: boolean;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, []);
  const storageKey = `everfern_user_reviews_${app.id}`;
  const [reviews, setReviews] = useState<AppReview[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved) ? saved.filter((review): review is AppReview =>
        !!review && typeof review.id === "string" && typeof review.author === "string" &&
        typeof review.comment === "string" && Number.isFinite(review.rating) && review.rating >= 1 && review.rating <= 5,
      ) : [];
    } catch {
      return [];
    }
  });
  const [userRating, setUserRating] = useState(5);
  const [userName, setUserName] = useState("");
  const [userComment, setUserComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [reviewError, setReviewError] = useState("");

  const handleSubmitReview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userComment.trim()) return;
    const newRev: AppReview = {
      id: `rev-${Date.now()}`,
      author: userName.trim() || "You",
      rating: userRating,
      date: "Just now",
      comment: userComment.trim(),
    };
    const next = [newRev, ...reviews];
    setReviewError("");
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch { setReviewError("Couldn’t save this review on your device. Please try again."); return; }
    setReviews(next);
    setUserComment("");
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 3000);
  };

  return (
    <div className="wk-store-product flex flex-col h-full w-full overflow-hidden text-white">
      {/* Header */}
      <div className="wk-store-product-head flex items-center justify-between px-5 py-3.5 border-b border-white/10 shrink-0">
        <button
          ref={backRef}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/15 border border-white/10 text-xs text-white/80 hover:text-white transition cursor-pointer"
          onClick={onBack}
          aria-label="Back to all apps"
        >
          <ArrowLeft size={13} />
          <span>All Apps</span>
        </button>
        <span className="text-xs font-semibold tracking-wide text-white/70 uppercase">{app.name}</span>
        <button
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition cursor-pointer"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div className="wk-store-product-body flex-1 overflow-y-auto p-5 space-y-4">
        {/* Hero Card */}
        <div className="wk-store-card wk-store-hero flex items-center gap-4 p-5 rounded-2xl">
          <div className="shrink-0">
            <AppLogo app={app} size={64} radius={16} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-white">{app.name}</h1>
            <div className="flex items-center gap-2 text-xs text-white/50 mt-0.5">
              <span>{app.developer ?? "EverFern Partner"}</span>
              <span>·</span>
              <span className="text-white/70 font-medium">{app.category ?? "Productivity"}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              {reviews.length > 0 ? (
                <>
                  <div className="flex items-center text-amber-400 gap-0.5">
                    {Array.from({ length: 5 }, (_, i) => {
                      const avg = reviews.reduce((a, b) => a + b.rating, 0) / reviews.length;
                      return <Star key={i} size={12} fill={i < Math.round(avg) ? "currentColor" : "none"} strokeWidth={1.5} />;
                    })}
                  </div>
                  <span className="text-xs font-semibold text-white/90">{(reviews.reduce((a, b) => a + b.rating, 0) / reviews.length).toFixed(1)}</span>
                  <span className="text-xs text-white/40">({reviews.length} {reviews.length === 1 ? "review" : "reviews"})</span>
                </>
              ) : (
                <span className="text-xs text-white/40">No reviews yet</span>
              )}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1.5">
            <button
              className={`wk-store-install flex items-center gap-2 px-5 py-2.5 rounded-full font-medium text-xs transition cursor-pointer shadow-lg active:scale-95 ${
                installed
                  ? "bg-white/10 hover:bg-white/20 text-white border border-white/15"
                  : "bg-white hover:bg-white/90 text-black font-semibold"
              } disabled:opacity-40 disabled:cursor-not-allowed`}
              onClick={onToggle}
              disabled={!canInstall}
            >
              {installed ? (
                <>
                  <Check size={14} strokeWidth={2.8} />
                  <span>Installed</span>
                </>
              ) : (
                <>
                  <Download size={14} strokeWidth={2.8} />
                  <span>Install app</span>
                </>
              )}
            </button>
            {!canInstall && <span className="text-[11px] text-white/40">Open a worker first</span>}
          </div>
        </div>

        {/* Description section */}
        <div className="wk-store-card p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-semibold text-white">What this app is about</h3>
          <p className="text-xs text-white/75 leading-relaxed font-normal">{app.description ?? app.blurb}</p>

          {app.features && app.features.length > 0 && (
            <div className="pt-2 border-t border-white/10 mt-3 space-y-2">
              <h4 className="text-xs font-semibold text-white/80">Key Capabilities with EverFern Worker</h4>
              <ul className="space-y-1.5">
                {app.features.map((feat, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-white/70">
                    <Check size={13} className="text-emerald-400 mt-0.5 shrink-0" strokeWidth={2.5} />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Leave a review section */}
        <div className="wk-store-card p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-semibold text-white">Leave a review</h3>
          <p className="wk-store-note">Reviews are saved on this device.</p>
          <form className="wk-store-review-form space-y-3" onSubmit={handleSubmitReview}>
            <div className="flex items-center gap-3 text-xs text-white/70">
              <span>Your rating:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={`p-1 transition cursor-pointer ${s <= userRating ? "text-amber-400" : "text-white/20 hover:text-white/40"}`}
                    onClick={() => setUserRating(s)}
                    aria-label={`${s} ${s === 1 ? "star" : "stars"}`}
                    aria-pressed={userRating === s}
                  >
                    <Star size={16} fill={s <= userRating ? "currentColor" : "none"} strokeWidth={1.5} />
                  </button>
                ))}
              </div>
            </div>
            <input
              type="text"
              aria-label="Your name (optional)" placeholder="Your name (optional)"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30"
            />
            <textarea
              aria-label="Your review" placeholder="Share how this app helps your AI worker complete tasks..."
              value={userComment}
              onChange={(e) => setUserComment(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 resize-none"
              rows={3}
              required
            />
            {reviewError && <p role="alert" className="wk-store-error">{reviewError}</p>}
            <div className="flex items-center justify-between pt-1">
              {submitted ? (
                <span role="status" className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                  <Check size={14} /> Saved on this device
                </span>
              ) : <span />}
              <button
                type="submit"
                className="px-5 py-2 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                disabled={!userComment.trim()}
              >
                Submit Review
              </button>
            </div>
          </form>
        </div>

        {/* Community Reviews */}
        <div className="wk-store-card p-5 rounded-2xl space-y-3">
          <h3 className="text-sm font-semibold text-white">Reviews on this device</h3>
          {reviews.length === 0 ? (
            <p className="text-xs text-white/40 py-2">No reviews yet. Be the first to leave one!</p>
          ) : (
            <div className="space-y-3">
              {reviews.map((r) => (
                <div key={r.id} className="p-3.5 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-white/90">{r.author}</span>
                    <span className="text-[11px] text-white/40">{r.date}</span>
                  </div>
                  <div className="flex items-center text-amber-400 gap-0.5 py-0.5">
                    {Array.from({ length: 5 }, (_, i) => (
                      <Star key={i} size={11} fill={i < r.rating ? "currentColor" : "none"} strokeWidth={1.5} />
                    ))}
                  </div>
                  <p className="text-xs text-white/70 leading-relaxed">{r.comment}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
  const [customError, setCustomError] = useState("");
  const [selectedApp, setSelectedApp] = useState<AppDef | null>(null);
  const dialogRef = useDialogFocus();
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
    try { custom.add(app); }
    catch { setCustomError("Couldn’t save this app on your device. Please try again."); return; }
    setCustomError("");
    if (canInstall && !installed.includes(app.id)) onToggle(app.id);
    setSite(""); setAdding(false);
  };

  return (
    <motion.section ref={dialogRef} tabIndex={-1} className="wk-sheet wk-glass wk-market" {...sheetMotion} role="dialog" aria-modal="true" aria-label="Apps">
      {selectedApp ? (
        <AppProductPage
          app={selectedApp}
          installed={installed.includes(selectedApp.id)}
          onToggle={() => onToggle(selectedApp.id)}
          onBack={() => { setSelectedApp(null); }}
          onClose={onClose}
          canInstall={canInstall}
        />
      ) : (
        <>
          <SheetHead title="Apps" query={query} setQuery={setQuery} placeholder="Browse apps..." onClose={onClose} />
          <motion.div className="wk-sheet-body" variants={fill} initial="hidden" animate="show">
            {!canInstall && <p className="wk-market-hint">Open a worker to download apps.</p>}
            {customError && <p role="alert" className="wk-store-error">{customError}</p>}

            {!q && (
              <motion.div className="wk-custom" variants={rowIn}>
                {adding ? (
                  <>
                    <input
                      aria-label="Custom app website" autoFocus value={site} onChange={(e) => setSite(e.target.value)}
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
                      <div className="wk-custom-title">Custom Apps</div>
                      <div className="wk-custom-sub">Create your own apps and provide them to your worker.</div>
                    </div>
                    <button className="wk-gpill is-sm" onClick={() => setAdding(true)}><Plus size={14} /> Create app</button>
                  </>
                )}
              </motion.div>
            )}

            {sections.map((s) => (
              <motion.div className="wk-market-section" key={s.id} variants={rowIn}>
                <div className="wk-sec">{s.title}</div>
                <div className="wk-apps">
                  {s.apps.map((id) => {
                    const a = APPS[id];
                    if (!a) return null;
                    const on = installed.includes(id);
                    return (
                      <div
                        className="wk-app is-clickable"
                        key={id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setSelectedApp(a)}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedApp(a); } }}
                        title={`View ${a.name} details & download`}
                      >
                        <AppLogo app={a} size={44} radius={11} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div className="wk-app-name">{a.name}</div>
                          <div className="wk-app-meta">
                            <span className="wk-app-cat-badge">{a.category ?? "Productivity"}</span>
                            <span className="wk-app-blurb-text">{a.blurb}</span>
                          </div>
                        </div>
                        <div className="wk-app-item-right">
                          {on && <span className="wk-app-installed-chip" aria-label="Installed" title="Installed"><Check size={13} strokeWidth={2.6} /></span>}
                          <span className="wk-app-chevron"><ChevronRight size={17} /></span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            ))}
            {!sections.length && <div className="wk-empty"><p>No apps match &ldquo;{query}&rdquo;.</p><button className="wk-gpill is-sm" onClick={() => { setSite(query); setQuery(""); setAdding(true); }}><Plus size={14} /> Create a custom app</button></div>}
          </motion.div>
        </>
      )}
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
  const dialogRef = useDialogFocus();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const list = WORKER_TEMPLATES.filter(
    (t) => !q || t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.apps.some((a) => APPS[a]?.name.toLowerCase().includes(q)),
  );
  return (
    <motion.section ref={dialogRef} tabIndex={-1} className="wk-sheet wk-glass" {...sheetMotion} role="dialog" aria-modal="true" aria-label="Templates">
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
