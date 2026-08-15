"use client";

import { useEffect } from "react";

/**
 * Loads Material Symbols Outlined asynchronously so it never blocks
 * the initial paint (avoids grey screen on Mac / slow connections).
 * Must be a Client Component because it uses useEffect.
 */
export function MaterialSymbolsLoader() {
  useEffect(() => {
    if (document.getElementById("material-symbols-stylesheet")) return;
    const link = document.createElement("link");
    link.id = "material-symbols-stylesheet";
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap";
    document.head.appendChild(link);
  }, []);

  return null;
}
