"use client";

import React from "react";

/**
 * The lens behind every `.lg-glass` surface (see docs/LIQUID-GLASS.md).
 *
 * Glassmorphism only blurs what is behind a panel. Liquid Glass bends it: near the edges
 * the backdrop is pulled inward, the way light refracts through the rounded rim of a thick
 * piece of glass, while the middle stays undistorted and readable.
 *
 * The displacement map is drawn in the surface's own box (objectBoundingBox), so the same
 * filter fits a 22px cursor orb and a 360px plan card: red moves pixels horizontally, green
 * vertically, and 50% grey (no shift) fills the middle.
 */
const edgeMap = (axis: "x" | "y") => {
  const horizontal = axis === "x";
  const ch = (v: number) => (horizontal ? `rgb(${v},0,0)` : `rgb(0,${v},0)`);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' preserveAspectRatio='none'>` +
    `<linearGradient id='g' x1='0' y1='0' x2='${horizontal ? 1 : 0}' y2='${horizontal ? 0 : 1}'>` +
    `<stop offset='0' stop-color='${ch(255)}'/><stop offset='0.16' stop-color='${ch(128)}'/>` +
    `<stop offset='0.84' stop-color='${ch(128)}'/><stop offset='1' stop-color='${ch(0)}'/>` +
    `</linearGradient><rect width='100' height='100' fill='url(#g)'/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

export function LiquidGlassDefs() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
      <defs>
        <filter id="ef-lg" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
          <feImage href={edgeMap("x")} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="mx" />
          <feImage href={edgeMap("y")} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="my" />
          <feComposite in="mx" in2="my" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="0.06" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  );
}
