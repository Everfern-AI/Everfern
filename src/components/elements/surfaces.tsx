"use client";

import React from "react";
import { cn } from "@/lib/utils";

export const collapsePanel = "overflow-hidden transition-all data-[state=closed]:animate-collapse data-[state=open]:animate-expand";
export const mono = "font-mono text-xs";
export const paper = "bg-card text-card-foreground border border-border shadow-sm";
export const field = "bg-muted/50 border border-border";
export const floating = "bg-popover text-popover-foreground border border-border shadow-md";

export function ShimmerLabel({
  active,
  children,
  className,
}: {
  active?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-medium bg-gradient-to-r from-zinc-500 via-zinc-400 to-zinc-600 dark:from-zinc-400 dark:via-zinc-200 dark:to-zinc-400 bg-clip-text text-transparent inline-block tracking-tight",
        className
      )}
    >
      {children}
    </span>
  );
}

export function SwapLabel({
  active,
  children,
  className,
}: {
  active: number;
  children: [React.ReactNode, React.ReactNode];
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {children[active] ?? children[0]}
    </span>
  );
}
