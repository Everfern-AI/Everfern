"use client";

import React from "react";
import { ChevronRightIcon, type LucideIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { collapsePanel, ShimmerLabel, SwapLabel } from "./surfaces";
import { take } from "./range";

export interface TimelineStep {
  verb: string;
  chip: string;
  icon: LucideIcon;
}

export interface TimelineStat {
  file: string;
  added?: number;
  removed?: number;
}

export interface ToolTimelineProps {
  steps: readonly TimelineStep[];
  visibleSteps: number;
  streaming: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  restingLabel: string;
  activeLabel: string;
  stats: TimelineStat[];
  className?: string;
}

export function ToolTimeline({
  steps,
  visibleSteps,
  streaming,
  open,
  onOpenChange,
  restingLabel,
  activeLabel,
  stats,
  className,
}: ToolTimelineProps) {
  return (
    <Collapsible
      data-slot="tool-timeline"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full max-w-full my-2.5 select-none", className)}
      style={{ marginLeft: 0, paddingLeft: 0 }}
    >
      <CollapsibleTrigger
        className="group/trigger text-foreground/60 hover:text-foreground flex items-center gap-2 rounded-md py-1 px-0 text-[13.5px] transition-colors outline-none cursor-pointer"
        style={{ margin: 0 }}
      >
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
        <SwapLabel
          active={streaming ? 0 : 1}
          className="text-start tabular-nums"
        >
          <ShimmerLabel
            active={streaming}
            className="relative inline-block leading-none font-normal"
          >
            {activeLabel}
          </ShimmerLabel>
          <ShimmerLabel className="font-normal">
            {restingLabel}
          </ShimmerLabel>
        </SwapLabel>
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div
          style={{
            paddingLeft: 22,
            paddingTop: 10,
            paddingBottom: 6,
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {take(steps, visibleSteps).map((step, index, shown) => {
            const Icon = step.icon;
            const active = streaming && index === shown.length - 1;
            const isLast = index === shown.length - 1;

            return (
              <div
                key={`${step.verb}-${step.chip}-${index}`}
                className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-foreground/70 flex items-start gap-2.5 text-[13px] duration-200"
              >
                {/* Icon column with vertical connecting line */}
                <div className="flex flex-col items-center shrink-0 w-4 self-stretch pt-0.5">
                  <div className="flex items-center justify-center size-4 shrink-0 z-10">
                    <Icon className={cn("size-3.5 shrink-0 transition-colors", active ? "text-foreground/90" : "text-foreground/50")} />
                  </div>
                  {!isLast && (
                    <div className="w-[1.5px] flex-1 my-1 bg-zinc-300 dark:bg-zinc-700/60 rounded-full min-h-[14px]" />
                  )}
                </div>

                <div className={cn("flex items-baseline gap-1.5 min-w-0 flex-1 flex-wrap pt-0.5", !isLast ? "pb-2.5" : "pb-0.5")}>
                  <ShimmerLabel
                    active={active}
                    className="relative inline-block leading-none font-semibold text-foreground/90 shrink-0 text-[13px]"
                  >
                    {step.verb}
                  </ShimmerLabel>
                  {step.chip && (
                    <span className={cn("text-[13px] leading-tight break-words font-normal", active ? "text-foreground/85" : "text-foreground/70")}>
                      {step.chip}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          {stats.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {stats.map((stat) => (
                <span
                  key={stat.file}
                  className="bg-foreground/[0.06] text-foreground/80 inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-[11px]"
                >
                  <span>{stat.file}</span>
                  {stat.added !== undefined && (
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      +{stat.added}
                    </span>
                  )}
                  {stat.removed !== undefined && (
                    <span className="text-red-600 dark:text-red-400 font-semibold">
                      −{stat.removed}
                    </span>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default ToolTimeline;