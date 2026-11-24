"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Search, X, ArrowRight, SearchX, Square, CircleStop } from "lucide-react";
import { NativeCursor, useNativeCursor, sleep, pace, typeInto } from "./native-cursor";

/**
 * EverFern Search: the worker's web_search tool as an app.
 * A search page in the familiar shape (wordmark, one search box, a list of
 * results with site, address, title and snippet), in EverFern's own colours.
 * When the AI calls web_search, the cursor clicks the box, types the query,
 * presses Return, the results land and the cursor reads down the top hits.
 * The user can search here too; that runs the same engine without the replay.
 * Stop ends whatever is running at once: the request in main returns, the
 * cursor lets go, queued AI searches are dropped and the box is the user's again.
 */

export type SearchHit = { title: string; url: string; snippet: string };
type StartEv = { id: string; type: "start"; query: string };
type ResultEv = { id: string; type: "result"; query: string; results: SearchHit[]; error?: string; cancelled?: boolean };
type CancelEv = { id: string; type: "cancelled"; query: string };
type SearchEv = StartEv | ResultEv | CancelEv;

const api = () => (typeof window !== "undefined" ? (window as any).electronAPI?.workers : undefined);

/* ── Event bus ──
 * The tool fires 'start' the moment the AI calls it, which can be before the
 * Search window has mounted, so events are kept here at module level and the
 * app picks them up when it appears. */

const STALE_MS = 90_000;
const pendingStarts: Array<StartEv & { at: number }> = [];
const results = new Map<string, ResultEv>();
const waiters = new Map<string, (r: ResultEv) => void>();
let consumer: (() => void) | null = null;
let busOn = false;

function ensureBus() {
  if (busOn || typeof window === "undefined") return;
  const w = api();
  if (!w?.onSearchEvent) return;
  busOn = true;
  w.onSearchEvent((ev: SearchEv) => {
    if (!ev || !ev.id) return;
    if (ev.type === "start" && typeof ev.query === "string") {
      pendingStarts.push({ ...ev, at: Date.now() });
      if (pendingStarts.length > 20) pendingStarts.shift();
      consumer?.();
      return;
    }
    if (ev.type === "cancelled") {
      // Stopped in main (by this app or another window): its replay ends now.
      const i = pendingStarts.findIndex((p) => p.id === ev.id);
      if (i >= 0) pendingStarts.splice(i, 1);
      waiters.get(ev.id)?.({ id: ev.id, type: "result", query: ev.query, results: [], cancelled: true });
      return;
    }
    if (ev.type === "result") {
      remember(ev.query, ev.results ?? []);
      const fn = waiters.get(ev.id);
      if (fn) fn(ev);
      else {
        results.set(ev.id, ev);
        if (results.size > 40) results.delete(results.keys().next().value as string);
      }
    }
  });
}

const awaitResult = (id: string, ms = 120_000) => new Promise<ResultEv | null>((resolve) => {
  const have = results.get(id);
  if (have) { results.delete(id); resolve(have); return; }
  const t = setTimeout(() => { waiters.delete(id); resolve(null); }, ms);
  waiters.set(id, (r) => { clearTimeout(t); waiters.delete(id); resolve(r); });
});

/* ── Last search, for the 3D-stack preview ── */

export const lastSearch: { query: string; hits: SearchHit[] } = { query: "", hits: [] };
const lastSubs = new Set<() => void>();
function remember(query: string, hits: SearchHit[]) {
  lastSearch.query = query;
  lastSearch.hits = hits;
  lastSubs.forEach((f) => f());
}
export function useLastSearch() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    lastSubs.add(f);
    return () => { lastSubs.delete(f); };
  }, []);
  return lastSearch;
}

/* ── Helpers ── */

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
function crumbOf(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean).slice(0, 3).map((p) => decodeURIComponent(p).slice(0, 28));
    return { origin: `${u.protocol}//${u.hostname}`, parts };
  } catch { return { origin: url, parts: [] as string[] }; }
}
function siteName(host: string) {
  const base = host.split(".").slice(-2, -1)[0] || host;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
const openUrl = (url: string) => window.dispatchEvent(new CustomEvent("everfern:worker-open-url", { detail: { url } }));

/** EverFern Search: the EverFern logo (the same mark as the boot pill) and the wordmark in EverFern's ink. */
export function SearchMark({ size = 64, word = true }: { size?: number; word?: boolean }) {
  return (
    <span className="wk-sr-mark" style={{ fontSize: size }} aria-label="EverFern Search">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="wk-sr-logo" src="/images/logos/everfern-withoutbg.png" alt="" draggable={false} />
      {word && <span className="wk-sr-word">EverFern<span className="wk-sr-word-sub">Search</span></span>}
    </span>
  );
}

function Favicon({ url }: { url: string }) {
  const host = hostOf(url);
  const [bad, setBad] = useState(false);
  return (
    <span className="wk-sr-fav" aria-hidden="true">
      {bad
        ? <b>{host.charAt(0).toUpperCase()}</b>
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`} alt="" width={18} height={18} onError={() => setBad(true)} />}
    </span>
  );
}

/* ── The app ── */

type View = "home" | "results";

export function SearchApp({ workerId: _workerId }: { workerId?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const cursor = useNativeCursor(rootRef);

  const [view, setView] = useState<View>(lastSearch.query ? "results" : "home");
  const [value, setValue] = useState(lastSearch.query);
  const [query, setQuery] = useState(lastSearch.query);
  const [hits, setHits] = useState<SearchHit[]>(lastSearch.hits);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [reading, setReading] = useState(-1);
  const aiRef = useRef(false);
  const alive = useRef(true);
  /** Bumped by Stop: anything started under an older generation drops its result. */
  const gen = useRef(0);
  /** What is in flight, so Stop can end it in main too. */
  const running = useRef<{ id: string; query: string } | null>(null);
  const [stopped, setStopped] = useState(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const show = (q: string, list: SearchHit[], err: string | null, ms: number | null) => {
    setQuery(q); setHits(list); setError(err); setTook(ms); setLoading(false); setView("results"); setStopped(false);
    listRef.current?.scrollTo({ top: 0 });
  };

  /* The user's own search: same engine, no replay. */
  const submit = async (raw?: string) => {
    const q = (raw ?? value).trim();
    if (q.length < 2 || aiRef.current) return;
    const w = api();
    setValue(q); setQuery(q); setView("results"); setLoading(true); setError(null); setHits([]); setStopped(false);
    if (!w?.searchQuery) { show(q, [], "Search runs in the EverFern desktop app.", null); return; }
    const my = ++gen.current;
    const id = `app-${Date.now().toString(36)}-${my}`;
    running.current = { id, query: q };
    const t0 = performance.now();
    try {
      const r = await w.searchQuery(q, id);
      if (!alive.current || my !== gen.current || r?.cancelled) return;
      running.current = null;
      const list: SearchHit[] = r?.results ?? [];
      remember(q, list);
      show(q, list, r?.error ?? null, performance.now() - t0);
    } catch (e) {
      if (alive.current && my === gen.current) { running.current = null; show(q, [], e instanceof Error ? e.message : String(e), null); }
    }
  };

  /**
   * Stop: ends the search now. The request in main returns at once (the AI's tool
   * call gets "stopped by the user"), queued AI searches are dropped, the cursor
   * lets go and the page shows what was asked with a way to run it again.
   */
  const stop = useCallback(() => {
    const w = api();
    gen.current++;
    const cur = running.current;
    running.current = null;
    // Queued AI searches are cancelled too, so their tool calls return instead of waiting.
    const queued = pendingStarts.splice(0, pendingStarts.length);
    if (cur) void w?.searchCancel?.(cur.id);
    for (const q of queued) void w?.searchCancel?.(q.id);
    if (cur) waiters.get(cur.id)?.({ id: cur.id, type: "result", query: cur.query, results: [], cancelled: true });
    aiRef.current = false;
    setAiBusy(false); setReading(-1); setLoading(false); setStopped(true); setError(null); setHits([]);
    cursor.hide();
    inputRef.current?.focus();
  }, [cursor]);

  /* AI replay: click the box, type, Return, results, read the top hits. */
  const replay = async (ev: StartEv) => {
    const q = ev.query;
    const my = gen.current;
    const over = () => !alive.current || my !== gen.current;
    running.current = { id: ev.id, query: q };
    const short = q.length > 46 ? `${q.slice(0, 46)}…` : q;
    cursor.say("Move", `Searching ${short}`);
    await cursor.moveTo(inputRef.current, "Click", { at: "left", dwell: 520 });
    if (over()) return;
    await cursor.click();
    if (over()) return;
    inputRef.current?.focus();
    setValue("");
    await sleep(pace(120));
    cursor.say("Type");
    await typeInto(q, setValue, "", 200, over);
    if (over()) return;
    await sleep(pace(200));
    cursor.say("Return");
    const t0 = performance.now();
    setQuery(q); setView("results"); setLoading(true); setError(null); setHits([]); setStopped(false);
    const r = await awaitResult(ev.id);
    if (over() || r?.cancelled) return;
    running.current = null;
    if (!r) { show(q, [], "The search did not come back in time.", null); return; }
    show(q, r.results ?? [], r.error ?? null, Math.max(80, performance.now() - t0));
    await sleep(pace(260));
    // Read down the first few results like a person scanning the page.
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".wk-sr-title") ?? []).slice(0, 3);
    for (let i = 0; i < items.length && !over(); i++) {
      items[i].scrollIntoView({ block: "nearest", behavior: "smooth" });
      setReading(i);
      cursor.say("Read", `Reading ${hostOf(r.results[i]?.url ?? "")}`);
      await cursor.moveTo(items[i], "Read", { at: "left", dwell: 820 });
    }
    setReading(-1);
  };

  const replayRef = useRef(replay); replayRef.current = replay;
  const busyRef = useRef(false);
  const drain = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      while (pendingStarts.length && alive.current) {
        const ev = pendingStarts.shift()!;
        if (Date.now() - ev.at > STALE_MS) continue;
        aiRef.current = true; setAiBusy(true); setStopped(false);
        try { await replayRef.current(ev); } catch { /* keep going */ }
      }
    } finally {
      busyRef.current = false;
      aiRef.current = false;
      if (alive.current) { setAiBusy(false); setReading(-1); cursor.hide(); }
    }
  }, [cursor]);

  useEffect(() => {
    ensureBus();
    const run = () => { void drain(); };
    consumer = run;
    run();
    return () => { if (consumer === run) consumer = null; };
  }, [drain]);

  const box = (big: boolean) => (
    <form
      className={`wk-sr-box${big ? " is-big" : ""}`}
      role="search"
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <Search size={big ? 18 : 17} className="wk-sr-box-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { if (!aiRef.current) setValue(e.target.value); }}
        readOnly={aiBusy}
        placeholder={big ? "Search the web" : ""}
        aria-label="Search the web"
        spellCheck={false}
        autoComplete="off"
      />
      {value && !aiBusy && (
        <button type="button" className="wk-sr-clear" aria-label="Clear" onClick={() => { setValue(""); inputRef.current?.focus(); }}>
          <X size={17} />
        </button>
      )}
      {(loading || aiBusy) ? (
        <button type="button" className="wk-sr-stop" onClick={stop} title="Stop this search" aria-label="Stop search">
          <Square size={10} fill="currentColor" /><span>Stop</span>
        </button>
      ) : !big && (
        <button type="submit" className="wk-sr-go" aria-label="Search">
          <Search size={17} />
        </button>
      )}
    </form>
  );

  return (
    <div ref={rootRef} className={`wk-sr${aiBusy ? " is-ai" : ""}`} data-worker-app="websearch">
      {view === "home" ? (
        <div className="wk-sr-home">
          <SearchMark size={68} />
          {box(true)}
          <div className="wk-sr-home-btns">
            <button type="button" onClick={() => void submit()} disabled={aiBusy}>EverFern Search</button>
            <button type="button" disabled={aiBusy || value.trim().length < 2} onClick={async () => {
              await submit();
              const top = lastSearch.query === value.trim() ? lastSearch.hits[0] : undefined;
              if (top) openUrl(top.url);
            }}>Open top result</button>
          </div>
          <p className="wk-sr-home-note">Your worker searches here. Every query it runs shows up on this page.</p>
        </div>
      ) : (
        <>
          <header className="wk-sr-top">
            <button type="button" className="wk-sr-top-mark" onClick={() => { if (!aiBusy) { setView("home"); setValue(""); } }} aria-label="EverFern Search home">
              <SearchMark size={22} />
            </button>
            {box(false)}
          </header>
          <nav className="wk-sr-tabs" aria-label="Result type">
            <span className="is-on"><Search size={13} /> All</span>
          </nav>
          <div className="wk-sr-list" ref={listRef}>
            {loading && (
              <div className="wk-sr-skel" aria-label="Searching">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="wk-sr-skel-item">
                    <span className="a" /><span className="b" /><span className="c" /><span className="d" />
                  </div>
                ))}
              </div>
            )}
            {!loading && hits.length > 0 && (
              <p className="wk-sr-stats">
                About {hits.length} result{hits.length === 1 ? "" : "s"}{took !== null ? ` (${(took / 1000).toFixed(2)} seconds)` : ""}
              </p>
            )}
            {!loading && hits.map((h, i) => {
              const host = hostOf(h.url);
              const c = crumbOf(h.url);
              return (
                <article key={`${h.url}-${i}`} className={`wk-sr-item${reading === i ? " is-reading" : ""}`}>
                  <a className="wk-sr-site" href={h.url} onClick={(e) => { e.preventDefault(); openUrl(h.url); }} tabIndex={-1}>
                    <Favicon url={h.url} />
                    <span className="wk-sr-site-text">
                      <span className="wk-sr-site-name">{siteName(host)}</span>
                      <span className="wk-sr-crumb">{c.origin}{c.parts.map((p, j) => <span key={j}> › {p}</span>)}</span>
                    </span>
                  </a>
                  <a className="wk-sr-title" href={h.url} onClick={(e) => { e.preventDefault(); openUrl(h.url); }}>
                    {h.title || host}
                  </a>
                  {h.snippet && <p className="wk-sr-snippet">{h.snippet}</p>}
                </article>
              );
            })}
            {!loading && !hits.length && stopped && (
              <div className="wk-sr-empty">
                <CircleStop size={26} aria-hidden="true" />
                <p>Stopped the search for <b>{query}</b>.</p>
                {!aiBusy && query.trim().length >= 2 && (
                  <button type="button" onClick={() => void submit(query)}>Search again <ArrowRight size={13} /></button>
                )}
              </div>
            )}
            {!loading && !hits.length && !stopped && (
              <div className="wk-sr-empty">
                <SearchX size={26} aria-hidden="true" />
                <p>{error ? error : <>No results for <b>{query}</b>.</>}</p>
                {!error && <ul><li>Check the spelling.</li><li>Try fewer or more general words.</li></ul>}
                {error && !aiBusy && (
                  <button type="button" onClick={() => void submit(query)}>Try again <ArrowRight size={13} /></button>
                )}
              </div>
            )}
          </div>
        </>
      )}
      <NativeCursor cur={cursor.cur} />
    </div>
  );
}

/** Search in the 3D stack: the last query and its top titles. */
export function SearchThumb() {
  const s = useLastSearch();
  return (
    <div className="wk-thumb-search">
      {s.query ? (
        <>
          <div className="wk-thumb-search-bar"><SearchMark size={9} word={false} /><span className="q">{s.query}</span></div>
          {s.hits.slice(0, 3).map((h, i) => (
            <div key={i} className="wk-thumb-search-hit">
              <span className="u">{hostOf(h.url)}</span>
              <span className="t">{h.title}</span>
            </div>
          ))}
        </>
      ) : (
        <div className="wk-thumb-search-home"><SearchMark size={16} /><span className="pill" /></div>
      )}
    </div>
  );
}
