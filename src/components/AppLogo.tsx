"use client";

import React, { useState } from "react";
import {
  Folder, Mail, Globe, Search, Sheet, FileText, Presentation, FileType2, Image as ImageIcon,
  Music, PenTool, Calendar, HardDrive, Megaphone, SquareTerminal, type LucideIcon,
} from "lucide-react";
import { APPS, type AppDef, type AppTile } from "@/lib/apps";

/**
 * App icon: local tile → logo.dev → initials.
 *
 * logo.dev is hot-linked (their terms forbid caching or copying the images) with the
 * publishable token. `fallback=404` makes unknown domains fail so we can show initials
 * instead of logo.dev's generic monogram. A plain <img> keeps it working in the static
 * export. Attribution for the free plan lives on the landing site footer.
 */

const TOKEN = process.env.NEXT_PUBLIC_LOGO_DEV_TOKEN;

const ICONS: Record<AppTile["icon"], LucideIcon> = {
  folder: Folder, mail: Mail, globe: Globe, search: Search, sheet: Sheet, doc: FileText,
  slides: Presentation, pdf: FileType2, image: ImageIcon, music: Music, pen: PenTool,
  calendar: Calendar, drive: HardDrive, megaphone: Megaphone, terminal: SquareTerminal,
};

export function logoUrl(domain: string, px: number) {
  if (!TOKEN) return null;
  const size = Math.min(800, Math.max(32, Math.round(px * 2))); // 2× for retina
  return `https://img.logo.dev/${domain}?token=${TOKEN}&size=${size}&format=png&fallback=404`;
}

export function AppLogo({
  app,
  size = 30,
  radius,
  className,
  style,
}: {
  app: AppDef | string;
  size?: number;
  radius?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const def = typeof app === "string" ? APPS[app] : app;
  const [failed, setFailed] = useState(false);
  const r = radius ?? Math.round(size * 0.28);
  const box: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: r,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.18), inset 0 0 0 0.5px rgba(255,255,255,0.18)",
    ...style,
  };

  if (!def) return <span className={className} style={{ ...box, background: "rgba(255,255,255,0.12)" }} />;

  if (def.tile) {
    const Icon = ICONS[def.tile.icon];
    return (
      <span className={className} style={{ ...box, background: def.tile.bg, color: def.tile.fg ?? "#fff" }} aria-label={def.name} role="img">
        <Icon size={Math.round(size * 0.54)} strokeWidth={2} />
      </span>
    );
  }

  const src = def.domain ? logoUrl(def.domain, size) : null;
  if (src && !failed) {
    return (
      <span className={className} style={{ ...box, background: "#fff" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={def.name}
          width={size}
          height={size}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{ ...box, background: "rgba(255,255,255,0.16)", color: "#fff", fontSize: Math.round(size * 0.42), fontWeight: 600 }}
      aria-label={def.name}
      role="img"
    >
      {def.name.charAt(0).toUpperCase()}
    </span>
  );
}

/** Overlapping cluster of app icons, as on template cards. */
export function AppLogoCluster({ apps, size = 30 }: { apps: string[]; size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      {apps.map((id, i) => (
        <AppLogo
          key={id}
          app={id}
          size={size}
          style={{ marginLeft: i ? -6 : 0, zIndex: apps.length - i, boxShadow: "0 0 0 2px rgba(40,48,56,0.55), 0 2px 6px rgba(0,0,0,0.25)" }}
        />
      ))}
    </span>
  );
}
