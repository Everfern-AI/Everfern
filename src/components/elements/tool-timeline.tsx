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
  toolCall?: any;
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
  onStepClick?: (step: TimelineStep, index: number) => void;
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
  onStepClick,
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
          <span className="font-normal timeline-static-shimmer text-zinc-500 dark:text-zinc-400">
            {restingLabel}
          </span>
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
            const isLast = index === shown.length - 1;
            const stepText = step.chip ? `${step.verb} ${step.chip}` : step.verb;

            return (
              <React.Fragment key={`${step.verb}-${step.chip}-${index}`}>
                <div
                  onClick={(e) => {
                    if (onStepClick) {
                      e.stopPropagation();
                      onStepClick(step, index);
                    }
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: onStepClick ? "pointer" : "default",
                    padding: "1px 0",
                  }}
                  className={onStepClick ? "hover:opacity-80 transition-opacity" : ""}
                >
                  <Icon
                    size={15}
                    strokeWidth={1.75}
                    style={{ color: "var(--muted-foreground, rgba(255,255,255,0.4))", flexShrink: 0 }}
                  />
                  <span
                    style={{
                      fontSize: 14.5,
                      lineHeight: 1.5,
                      color: "var(--foreground, rgba(255,255,255,0.75))",
                      fontWeight: 400,
                    }}
                  >
                    {stepText}
                  </span>
                </div>
                {!isLast && (
                  <div
                    style={{
                      width: 1,
                      height: 14,
                      marginLeft: 7,
                      background: "var(--border, rgba(255,255,255,0.14))",
                      opacity: 0.7,
                      marginTop: 2,
                      marginBottom: 2,
                    }}
                  />
                )}
              </React.Fragment>
            );
          })}
          {stats.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2">
              {stats.map((stat, idx) => (
                <span
                  key={`${stat.file}-${idx}`}
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