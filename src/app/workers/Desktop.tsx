"use client";

import React, { useRef } from "react";
import { motion, AnimatePresence, useDragControls } from "framer-motion";
import { Expand, Minimize2, Minus, X, Lock } from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { APPS } from "@/lib/apps";

/**
 * The worker's computer: floating app windows over the wallpaper, and minimized
 * windows as thumbnails along the left edge. Today the windows are placeholders for
 * what the worker's VM shows; the live VM stream replaces the body in phase 3.
 */

export type Win = { app: string; min: boolean; max: boolean; z: number };

const EASE = [0.16, 1, 0.3, 1] as const;

export function windowsForApps(apps: string[]): Win[] {
  const web = apps.filter((a) => APPS[a]?.domain || ["gads", "gsheets", "gmail", "gdocs"].includes(a));
  const open = web[0] ?? apps.find((a) => a !== "files") ?? apps[0];
  return apps.map((app, i) => ({ app, min: app !== open, max: false, z: app === open ? 10 : i }));
}

const SIGN_IN: Record<string, string> = {
  gads: "adstransparency.google.com",
  gsheets: "docs.google.com/spreadsheets",
  gmail: "mail.google.com",
  gdocs: "docs.google.com",
  gcal: "calendar.google.com",
  gdrive: "drive.google.com",
  gslides: "docs.google.com/presentation",
};

function WindowBody({ app }: { app: string }) {
  const def = APPS[app];
  if (!def) return null;
  const url = def.domain ? `${def.domain}/login` : SIGN_IN[app];
  if (url) {
    return (
      <>
        <div className="wk-url"><Lock size={11} /> https://{url}</div>
        <div className="wk-win-body">
          <AppLogo app={app} size={52} />
          <h3 className="wk-win-h">Sign in to {def.name}</h3>
          <p className="wk-win-p">
            The first time this worker needs {def.name}, it pauses here and asks you to take over and sign in.
            The session stays on this worker&apos;s computer.
          </p>
        </div>
      </>
    );
  }
  return (
    <div className="wk-win-body">
      <AppLogo app={app} size={52} />
      <h3 className="wk-win-h">{def.name}</h3>
      <p className="wk-win-p">{def.blurb}. Ready when the worker needs it.</p>
    </div>
  );
}

function AppWindow({
  win, index, bounds, onFocus, onMin, onMax, onClose,
}: {
  win: Win; index: number; bounds: React.RefObject<HTMLDivElement | null>;
  onFocus: () => void; onMin: () => void; onMax: () => void; onClose: () => void;
}) {
  const drag = useDragControls();
  const def = APPS[win.app];
  const pos = win.max
    ? { left: "2%", top: 52, width: "96%", height: "calc(100% - 140px)" }
    : { left: `${20 + index * 2}%`, top: 70 + index * 18, width: "min(760px, 58%)", height: "min(520px, calc(100% - 200px))" };
  return (
    <motion.div
      className="wk-win"
      style={{ ...pos, zIndex: win.z }}
      drag={!win.max}
      dragControls={drag}
      dragListener={false}
      dragMomentum={false}
      dragConstraints={bounds}
      dragElastic={0.04}
      onPointerDown={onFocus}
      initial={{ opacity: 0, scale: 0.94, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: EASE } }}
      exit={{ opacity: 0, scale: 0.9, x: -120, transition: { duration: 0.28, ease: EASE } }}
    >
      <div className="wk-win-bar" onPointerDown={(e) => drag.start(e)} onDoubleClick={onMax}>
        <AppLogo app={win.app} size={16} radius={5} />
        <span style={{ marginRight: "auto" }}>{def?.name}</span>
        <button className="wk-win-btn" aria-label="Minimize" onPointerDown={(e) => e.stopPropagation()} onClick={onMin}><Minus size={14} /></button>
        <button className="wk-win-btn" aria-label={win.max ? "Restore" : "Expand"} onPointerDown={(e) => e.stopPropagation()} onClick={onMax}>
          {win.max ? <Minimize2 size={13} /> : <Expand size={13} />}
        </button>
        <button className="wk-win-btn" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}><X size={14} /></button>
      </div>
      <WindowBody app={win.app} />
    </motion.div>
  );
}

export function WorkerDesktop({
  wins, setWins, hideThumbs,
}: {
  wins: Win[]; setWins: (fn: (w: Win[]) => Win[]) => void; hideThumbs?: boolean;
}) {
  const bounds = useRef<HTMLDivElement>(null);
  const topZ = () => Math.max(0, ...wins.map((w) => w.z)) + 1;
  const patch = (app: string, p: Partial<Win>) => setWins((ws) => ws.map((w) => (w.app === app ? { ...w, ...p } : w)));
  const open = wins.filter((w) => !w.min);
  const minimized = wins.filter((w) => w.min);

  return (
    <div className="wk-desk" ref={bounds}>
      <AnimatePresence>
        {open.map((w, i) => (
          <AppWindow
            key={w.app}
            win={w}
            index={i}
            bounds={bounds}
            onFocus={() => w.z < topZ() - 1 && patch(w.app, { z: topZ() })}
            onMin={() => patch(w.app, { min: true, max: false })}
            onMax={() => patch(w.app, { max: !w.max, z: topZ() })}
            onClose={() => setWins((ws) => ws.filter((x) => x.app !== w.app))}
          />
        ))}
      </AnimatePresence>

      {!hideThumbs && (
        <div className="wk-thumbs">
          <AnimatePresence>
            {minimized.map((w) => (
              <motion.button
                key={w.app}
                className="wk-thumb"
                onClick={() => patch(w.app, { min: false, z: topZ() })}
                initial={{ opacity: 0, x: -24, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1, transition: { duration: 0.4, ease: EASE } }}
                exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
                layout
                title={`Open ${APPS[w.app]?.name}`}
              >
                <span className="wk-thumb-box">
                  <span className="wk-thumb-bar" />
                  <span style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <AppLogo app={w.app} size={26} />
                  </span>
                </span>
                <span className="wk-thumb-label">{APPS[w.app]?.name}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
