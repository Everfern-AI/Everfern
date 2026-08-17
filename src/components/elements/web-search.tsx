"use client";

import React, { type ComponentProps } from "react";
import { SearchIcon, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export interface WebSearchResult {
  title: string;
  domain: string;
  url?: string;
  snippet?: string;
}

export interface WebSearchProps extends Omit<ComponentProps<"div">, "children" | "results"> {
  query: string;
  results: readonly WebSearchResult[];
  visibleResults?: number;
  searching?: boolean;
  cycle?: number;
  className?: string;
}

function take<T>(array: readonly T[], n: number): T[] {
  return array.slice(0, n);
}

function ShimmerLabel({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn("font-medium", className)}
      style={{
        backgroundImage: "linear-gradient(90deg, var(--color-text-tertiary) 0%, var(--color-text-primary) 50%, var(--color-text-tertiary) 100%)",
        backgroundSize: "200% 100%",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        WebkitTextFillColor: "transparent",
        animation: "efShimmerLineAnim 2.2s linear infinite",
        display: "inline-block",
      }}
    >
      {children}
    </span>
  );
}

export function WebSearch({
  query,
  results = [],
  visibleResults = results.length,
  searching = false,
  cycle = 0,
  className,
  ...props
}: WebSearchProps) {
  const displayedResults = take(results, visibleResults ?? results.length);

  return (
    <div
      data-slot="web-search"
      className={cn("flex w-full max-w-lg flex-col gap-2.5 my-2", className)}
      {...props}
    >
      <style>{`
        @keyframes efShimmerLineAnim {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>

      {/* Query Pill */}
      <div className="flex items-center gap-2">
        <span
          className="text-foreground/75 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-xs border"
          style={{
            backgroundColor: "var(--color-bg-subtle)",
            borderColor: "var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <SearchIcon className="size-3 shrink-0 opacity-60" />
          <span className="truncate max-w-sm">{query}</span>
        </span>
      </div>

      {/* Status Label */}
      <div className="text-xs px-0.5" style={{ color: "var(--color-text-tertiary)" }}>
        {searching ? (
          <ShimmerLabel className="relative inline-block leading-none">
            Searching the web...
          </ShimmerLabel>
        ) : (
          <span className="fade-in animate-in duration-300">
            Read {results.length} {results.length === 1 ? "source" : "sources"}
          </span>
        )}
      </div>

      {/* Result cards */}
      {displayedResults.length > 0 && (
        <div key={cycle} className="flex flex-col gap-1">
          {displayedResults.map((result, idx) => {
            const domainLetter = (result.domain || result.title || "W").charAt(0).toUpperCase();

            return (
              <a
                key={`${cycle}-${result.domain}-${idx}`}
                href={result.url || (result.domain.startsWith("http") ? result.domain : `https://${result.domain}`)}
                target="_blank"
                rel="noreferrer"
                className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 transition-colors duration-200 group no-underline"
                style={{
                  color: "inherit",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-subtle)")}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
              >
                <span
                  className="flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold border"
                  style={{
                    backgroundColor: "var(--color-bg-subtle)",
                    borderColor: "var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {domainLetter}
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-[13px] group-hover:underline"
                  style={{ color: "var(--color-text-primary)" }}
                >
                  {result.title || result.domain}
                </span>
                <span
                  className="font-mono text-[11px] shrink-0 opacity-60 flex items-center gap-1"
                  style={{ color: "var(--color-text-tertiary)" }}
                >
                  {result.domain}
                  <ExternalLink className="size-3 opacity-40 group-hover:opacity-100" />
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default WebSearch;
