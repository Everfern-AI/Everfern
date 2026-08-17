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
    <>
      <span
        className={cn(
          "font-medium inline-block tracking-tight transition-all duration-200",
          active
            ? "timeline-shimmer-active bg-clip-text text-transparent"
            : "text-foreground/85 font-normal",
          className
        )}
      >
        {children}
      </span>
      <style>{`
        @keyframes timelineTextShimmer {
          0% {
            background-position: 200% center;
          }
          100% {
            background-position: -200% center;
          }
        }
        .timeline-shimmer-active {
          background-size: 200% auto;
          animation: timelineTextShimmer 2.4s linear infinite;
          background-image: linear-gradient(
            90deg,
            rgba(100, 116, 139, 0.8) 0%,
            rgba(100, 116, 139, 0.8) 30%,
            rgba(15, 23, 42, 1) 50%,
            rgba(100, 116, 139, 0.8) 70%,
            rgba(100, 116, 139, 0.8) 100%
          );
        }
        .dark .timeline-shimmer-active {
          background-image: linear-gradient(
            90deg,
            rgba(161, 161, 170, 0.75) 0%,
            rgba(161, 161, 170, 0.75) 30%,
            rgba(255, 255, 255, 1) 50%,
            rgba(161, 161, 170, 0.75) 70%,
            rgba(161, 161, 170, 0.75) 100%
          );
        }
        .timeline-static-shimmer {
          background-size: 100% auto;
          background-image: linear-gradient(
            90deg,
            rgba(100, 116, 139, 0.75) 0%,
            rgba(148, 163, 184, 0.95) 50%,
            rgba(100, 116, 139, 0.75) 100%
          );
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
        }
        .dark .timeline-static-shimmer {
          background-size: 100% auto;
          background-image: linear-gradient(
            90deg,
            rgba(140, 140, 150, 0.7) 0%,
            rgba(215, 215, 225, 0.95) 50%,
            rgba(140, 140, 150, 0.7) 100%
          );
          background-clip: text;
          -webkit-background-clip: text;
          color: transparent;
        }
      `}</style>
    </>
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
