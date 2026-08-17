"use client";

import { ChevronRightIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { collapsePanel, mono, ShimmerLabel, SwapLabel } from "./surfaces";
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
  restingLabel: string;
  elapsed?: string;
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
  className,
}: ReasoningPanelProps) {
  return (
    <Collapsible
      data-slot="reasoning-panel"
      open={open}
      onOpenChange={onOpenChange}
      className={cn("w-full max-w-full my-2 select-none", className)}
    >
      <CollapsibleTrigger className="group/trigger text-foreground/55 hover:text-foreground/90 flex items-center gap-1.5 py-1 text-[13.5px] transition-[color,scale] outline-none active:scale-[0.98]">
        <SwapLabel active={streaming ? 0 : 1} className="text-start">
          <>
            <ShimmerLabel
              active={streaming}
              className="relative inline-block leading-none font-normal"
            >
              Thinking
            </ShimmerLabel>
            {elapsed !== undefined && (
              <span className={cn(mono, "text-foreground/30 tabular-nums")}>
                {elapsed}
              </span>
            )}
          </>
          <ShimmerLabel className="font-normal">
            {restingLabel}
          </ShimmerLabel>
        </SwapLabel>
        <ChevronRightIcon className="size-3.5 shrink-0 opacity-60 transition-transform duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] group-data-open/trigger:rotate-90 group-data-panel-open/trigger:rotate-90 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className={cn(collapsePanel, "outline-none")}>
        <div className="flex flex-col gap-4 pt-3 pb-3">
          {take(steps, visibleSteps).map((step, i, shown) => {
            const active = streaming && i === shown.length - 1;
            return (
              <p
                key={step.title}
                className={cn(
                  "fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-foreground/50 text-[13px] leading-relaxed",
                  active && "text-foreground/60"
                )}
                style={{ animationDelay: `${i * 40}ms` }}
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
