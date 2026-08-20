"use client";

import React, { useState, type ComponentProps } from "react";
import { Search, ChevronDown, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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
  defaultExpanded?: boolean;
  className?: string;
}

function take<T>(array: readonly T[], n: number): T[] {
  return array.slice(0, n);
}

export function WebSearch({
  query,
  results = [],
  visibleResults = results.length,
  searching = false,
  cycle = 0,
  defaultExpanded = false,
  className,
  ...props
}: WebSearchProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const displayedResults = take(results, visibleResults ?? results.length);
  const hasResults = displayedResults.length > 0;

  return (
    <div
      data-slot="web-search"
      className={cn("flex w-full max-w-full flex-col gap-1 my-1", className)}
      {...props}
    >
      <div
        onClick={() => hasResults && setIsExpanded((prev) => !prev)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: hasResults ? "pointer" : "default",
          padding: "2px 0",
        }}
        className={hasResults ? "hover:opacity-80 transition-opacity" : ""}
      >
        <Search
          size={15}
          strokeWidth={1.75}
          style={{ color: "var(--muted-foreground, rgba(255,255,255,0.4))", flexShrink: 0 }}
        />
        <span
          style={{
            fontSize: 14.5,
            lineHeight: 1.5,
            color: "var(--foreground, rgba(255,255,255,0.85))",
            fontWeight: 400,
          }}
        >
          {query}
        </span>
        {searching ? (
          <span
            style={{
              fontSize: 13,
              color: "var(--muted-foreground, rgba(255,255,255,0.45))",
              marginLeft: 4,
            }}
          >
            searching...
          </span>
        ) : hasResults ? (
          <span
            style={{
              fontSize: 13,
              color: "var(--muted-foreground, rgba(255,255,255,0.45))",
              marginLeft: 4,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span>({results.length} {results.length === 1 ? "source" : "sources"})</span>
            <ChevronDown
              size={12}
              className={cn("transition-transform duration-200 opacity-60", isExpanded && "rotate-180")}
            />
          </span>
        ) : null}
      </div>

      {/* Expanded Sources List */}
      <AnimatePresence initial={false}>
        {hasResults && isExpanded && (
          <motion.div
            key={`results-${cycle}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden pl-6 border-l border-border/20 ml-2 my-1"
          >
            <div className="flex flex-col gap-1.5 pt-1 pb-1">
              {displayedResults.map((result, idx) => {
                const cleanDomain = (result.domain || "")
                  .replace(/^https?:\/\//i, "")
                  .replace(/^www\./i, "")
                  .split("/")[0];
                const destinationUrl =
                  result.url ||
                  (result.domain.startsWith("http") ? result.domain : `https://${result.domain}`);

                return (
                  <a
                    key={`${cycle}-${result.domain}-${idx}`}
                    href={destinationUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 py-0.5 text-[13px] text-foreground/60 hover:text-foreground hover:underline transition-colors no-underline"
                  >
                    <span className="truncate max-w-md">{result.title || cleanDomain}</span>
                    <span className="text-[11px] text-foreground/35 font-mono">({cleanDomain})</span>
                    <ExternalLink size={11} className="opacity-30" />
                  </a>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default WebSearch;
