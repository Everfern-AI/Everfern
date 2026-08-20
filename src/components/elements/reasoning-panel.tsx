"use client";

import React from "react";
import { History, ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { take } from "./range";

export interface ReasoningStep {
  title: string;
  body: string;
}

export interface ReasoningPanelProps {
  steps: readonly ReasoningStep[];
  visibleSteps: number;
  streaming: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restingLabel?: string;
  elapsed?: string;
  summary?: string;
  className?: string;
}

export function ReasoningPanel({
  steps,
  visibleSteps,
  streaming,
  open,
  onOpenChange,
  restingLabel,
  elapsed,
  summary,
  className,
}: ReasoningPanelProps) {
  // Derive concise summary from summary prop, first step title, or first step body
  const displaySummary = React.useMemo(() => {
    if (summary && summary.trim()) return summary.trim();
    if (steps && steps.length > 0) {
      const first = steps[0];
      const text = first.title && first.title !== "Reasoning" && first.title !== "Thought"
        ? first.title
        : first.body;
      if (text) {
        // Strip markdown headers/bullets
        const clean = text.replace(/^[#*\-\d.:\s]+/, "").trim();
        // Take first sentence or up to 90 chars
        const firstSentence = clean.split(/[.\n]/)[0]?.trim();
        if (firstSentence && firstSentence.length > 5) {
          return firstSentence.endsWith(".") ? firstSentence : `${firstSentence}.`;
        }
      }
    }
    return "";
  }, [summary, steps]);

  const headerLabel = streaming
    ? "Thinking..."
    : restingLabel || "Thought";

  return (
    <Collapsible
      data-slot="reasoning-panel"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full max-w-full my-2 select-none", className)}
    >
      {/* Top line: Thought for 36s (collapsible trigger) */}
      <CollapsibleTrigger className="group/trigger text-foreground/45 hover:text-foreground/75 flex items-center gap-1.5 py-0.5 text-[14px] transition-colors outline-none cursor-pointer">
        <span className="font-normal text-foreground/45">
          {headerLabel}
        </span>
        {elapsed !== undefined && streaming && (
          <span className="text-foreground/30 tabular-nums text-xs ml-1">
            {elapsed}
          </span>
        )}
      </CollapsibleTrigger>

      {/* Second line: Clock/History icon + summary sentence (Image 1 style) */}
      {displaySummary && !streaming && (
        <div
          onClick={() => onOpenChange(!open)}
          className="flex items-center gap-2.5 mt-2 cursor-pointer text-[14.5px] leading-relaxed text-foreground/90 hover:text-foreground transition-colors"
        >
          <History
            size={15}
            strokeWidth={1.75}
            className="text-foreground/40 shrink-0"
          />
          <span className="font-normal">
            {displaySummary}
          </span>
        </div>
      )}

      {/* Collapsible reasoning thoughts */}
      <CollapsibleContent className="outline-none">
        <div className="flex flex-col gap-2 pt-2.5 pb-2 pl-4 border-l border-border/20 ml-2 my-2">
          {take(steps, visibleSteps).map((step, i, shown) => {
            const active = streaming && i === shown.length - 1;
            return (
              <p
                key={`${step.title}-${i}`}
                className={cn(
                  "text-foreground/55 text-[13.5px] leading-relaxed m-0",
                  active && "text-foreground/80"
                )}
              >
                {step.body || step.title}
              </p>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default ReasoningPanel;
