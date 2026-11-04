"use client";

import React from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import WindowControls from "../WindowControls";

/**
 * EverFern v2 onboarding shell.
 * Light-gray app frame → one big rounded "screen" showing a heavily blurred
 * Swiss Alps photo, a notch at the top with the brand, and a slim bottom bar.
 * Everything inside `.ef-glass` gets the dark-glass theme (see globals.css).
 */

export const ALPS_PHOTOS = {
  lake: "photo-1587477044837-bd09e2024654",
  valley: "photo-1715936885835-397b8763d1af",
  peak: "photo-1559127218-ef65d4d2ce88",
  chalet: "photo-1520631023082-a5fe1cf21c5f",
} as const;

export type AlpsPhoto = keyof typeof ALPS_PHOTOS;

export const photoUrl = (id: string) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&q=70&w=1600`;

export const EASE = [0.22, 1, 0.36, 1] as const;

export function GlassShell({
  children,
  photo = "lake",
  blur = 26,
  progress,
  bottomLeft,
  bottomRight,
}: {
  children: React.ReactNode;
  photo?: AlpsPhoto;
  blur?: number;
  /** [current (1-based), total] — renders progress dots in the bottom bar */
  progress?: [number, number];
  bottomLeft?: React.ReactNode;
  bottomRight?: React.ReactNode;
}) {
  return (
    <div className="ef-shell">
      {/* drag strip + window controls live in the gray frame, like an OS chrome */}
      <div className="ef-shell-titlebar">
        <div className="ef-shell-controls">
          <WindowControls />
        </div>
      </div>

      <motion.div
        className="ef-screen"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: EASE }}
      >
        {/* Background photo (blurred) with gradient fallback for offline */}
        <div className="ef-screen-fallback" />
        <motion.img
          key={photo}
          src={photoUrl(ALPS_PHOTOS[photo])}
          alt=""
          aria-hidden
          draggable={false}
          className="ef-screen-photo"
          style={{ filter: `blur(${blur}px) saturate(115%)` }}
          initial={{ opacity: 0, scale: 1.18 }}
          animate={{ opacity: 1, scale: 1.12 }}
          transition={{ duration: 1.6, ease: EASE }}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
        <div className="ef-screen-tint" />

        {/* Top notch */}
        <div className="ef-notch">
          <Image
            src="/images/logos/black-logo-withoutbg.png"
            alt="EverFern"
            width={26}
            height={26}
            priority
            style={{ margin: "-4px" }}
          />
          <span className="ef-notch-word">everfern</span>
        </div>

        <div className="ef-glass ef-screen-content">{children}</div>
      </motion.div>

      {/* Bottom bar */}
      <div className="ef-bottombar">
        <div className="ef-bottombar-side">{bottomLeft}</div>
        {progress ? (
          <div className="ef-dots" aria-label={`Step ${progress[0]} of ${progress[1]}`}>
            {Array.from({ length: progress[1] }).map((_, i) => (
              <motion.span
                key={i}
                className="ef-dot"
                animate={{
                  width: i + 1 === progress[0] ? 22 : 6,
                  opacity: i + 1 <= progress[0] ? 1 : 0.35,
                }}
                transition={{ duration: 0.5, ease: EASE }}
              />
            ))}
          </div>
        ) : (
          <div />
        )}
        <div className="ef-bottombar-side ef-bottombar-right">{bottomRight}</div>
      </div>
    </div>
  );
}

/** Staggered reveal for onboarding content. */
export const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
  exit: { transition: { staggerChildren: 0.04, staggerDirection: -1 } },
};
export const rise = {
  hidden: { opacity: 0, y: 14, filter: "blur(8px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
  exit: { opacity: 0, y: -8, filter: "blur(6px)", transition: { duration: 0.35, ease: EASE } },
};

export function GlassTitle({ title, subtitle }: { title: React.ReactNode; subtitle?: React.ReactNode }) {
  return (
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <motion.h1 variants={rise} className="ef-title">
        {title}
      </motion.h1>
      {subtitle && (
        <motion.p variants={rise} className="ef-subtitle">
          {subtitle}
        </motion.p>
      )}
    </div>
  );
}

export function GlassCard({
  selected,
  onClick,
  children,
  className = "",
  style,
  disabled,
}: {
  selected?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  return (
    <motion.button
      type="button"
      variants={rise}
      whileHover={disabled ? undefined : { y: -2 }}
      whileTap={disabled ? undefined : { scale: 0.985 }}
      onClick={onClick}
      disabled={disabled}
      className={`ef-card ${selected ? "is-selected" : ""} ${className}`}
      style={style}
    >
      {children}
    </motion.button>
  );
}

export function GlassPill({
  children,
  onClick,
  variant = "dark",
  disabled,
  type = "button",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "dark" | "light" | "ghost";
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <motion.button
      type={type}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled}
      className={`ef-pill ef-pill-${variant}`}
    >
      {children}
    </motion.button>
  );
}
