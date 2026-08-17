"use client";

import React, { type ComponentProps } from "react";
import { PreviewCard } from "@base-ui/react/preview-card";
import { cn } from "@/lib/utils";
import { floating, mono } from "./surfaces";

export interface Source {
  domain: string;
  title: string;
  snippet: string;
}

export interface CitationProps {
  index: number;
  source: Source;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Citation({ index, source, open, onOpenChange }: CitationProps) {
  return (
    <PreviewCard.Root open={open} onOpenChange={onOpenChange}>
      <PreviewCard.Trigger
        delay={0}
        render={<button type="button" />}
        className={cn(
          "mx-0.5 inline-flex h-3.5 min-w-3.5 translate-y-[-1px] cursor-default items-center justify-center rounded px-0.5 align-middle font-mono text-[9px] font-normal tabular-nums transition-colors",
          open
            ? "bg-foreground/15 text-foreground/70"
            : "bg-foreground/[0.04] text-foreground/30 hover:text-foreground/50",
        )}
      >
        {index + 1}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="top" sideOffset={6}>
          <PreviewCard.Popup
            className={cn(
              floating,
              "z-50 w-56 origin-(--transform-origin) rounded-xl p-3 outline-none shadow-sm",
              "transition-[opacity,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
              "data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-foreground/25 text-[9px] font-normal">
                {source.domain}
              </span>
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug font-normal text-foreground/70">
              {source.title}
            </p>
            <p className="text-foreground/35 mt-1 text-[12px] leading-relaxed">
              {source.snippet}
            </p>
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}

export interface InlineCitationProps extends ComponentProps<"p"> {
  sources: Source[];
  openIndex: number | null;
  onOpenIndexChange: (index: number | null) => void;
  children?: React.ReactNode;
}

export function InlineCitation({
  sources,
  openIndex,
  onOpenIndexChange,
  className,
  children,
  ...props
}: InlineCitationProps) {
  return (
    <p
      data-slot="inline-citation"
      className={cn(
        "text-foreground/90 max-w-sm text-sm leading-relaxed",
        className,
      )}
      {...props}
    >
      {children ? (
        children
      ) : (
        <>
          Optimistic updates keep the thread responsive while the server confirms
          the write
          {sources[0] && (
            <Citation
              index={0}
              source={sources[0]}
              open={openIndex === 0}
              onOpenChange={(open) => onOpenIndexChange(open ? 0 : null)}
            />
          )}
          . The store already exposes a consistent snapshot for every subscriber
          {sources[1] && (
            <Citation
              index={1}
              source={sources[1]}
              open={openIndex === 1}
              onOpenChange={(open) => onOpenIndexChange(open ? 1 : null)}
            />
          )}
          , so no extra reconciliation pass is needed.
        </>
      )}
    </p>
  );
}

export default InlineCitation;
