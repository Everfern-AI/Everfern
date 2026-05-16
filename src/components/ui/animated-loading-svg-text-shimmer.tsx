import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, Search, Globe, FileText, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';

// ---------------------------------------------------------------------------
// Loader Component - Animated SVG Path Loader
// ---------------------------------------------------------------------------

let cachedPathLength = 0;
let stylesInjected = false;

const LOADER_KEYFRAMES = `
  @keyframes drawStroke {
    0% {
      stroke-dashoffset: var(--path-length);
      animation-timing-function: ease-in-out;
    }
    100% {
      stroke-dashoffset: 0;
      animation-timing-function: ease-in-out;
    }
  }
`;

interface LoaderProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

const Loader = React.forwardRef<SVGSVGElement, LoaderProps>(
  ({ className, size = 64, strokeWidth = 2, ...props }, ref) => {
    const pathRef = useRef<SVGPathElement>(null);
    const [pathLength, setPathLength] = useState<number>(cachedPathLength);

    useEffect(() => {
      if (typeof window !== 'undefined' && !stylesInjected) {
        stylesInjected = true;
        const style = document.createElement('style');
        style.innerHTML = LOADER_KEYFRAMES;
        document.head.appendChild(style);
      }

      if (!cachedPathLength && pathRef.current) {
        cachedPathLength = pathRef.current.getTotalLength();
        setPathLength(cachedPathLength);
      }
    }, []);

    const isReady = pathLength > 0;

    return (
      <svg
        ref={ref}
        role="status"
        aria-label="Loading..."
        viewBox="0 0 19 19"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        className={cn("text-current", className)}
        {...props}
      >
        <path
          ref={pathRef}
          d="M4.43431 2.42415C-0.789139 6.90104 1.21472 15.2022 8.434 15.9242C15.5762 16.6384 18.8649 9.23035 15.9332 4.5183C14.1316 1.62255 8.43695 0.0528911 7.51841 3.33733C6.48107 7.04659 15.2699 15.0195 17.4343 16.9241"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={isReady ? {
            strokeDasharray: pathLength,
            '--path-length': pathLength,
          } as React.CSSProperties : undefined}
          className={cn(
            "transition-opacity duration-300",
            isReady
              // alternate makes the draw reverse back on each cycle
              ? "opacity-100 [animation:drawStroke_1.25s_ease-in-out_infinite_alternate]"
              : "opacity-0"
          )}
        />
      </svg>
    );
  }
);

Loader.displayName = "Loader";

// ---------------------------------------------------------------------------
// Loading Breadcrumb Component - Animated Loading State with Shimmer Text
// ---------------------------------------------------------------------------

interface LoadingBreadcrumbProps {
  text?: string;
  className?: string;
}

export function LoadingBreadcrumb({
  text = "Thinking",
  className
}: LoadingBreadcrumbProps) {
  return (
      <>
      <style>{`
        @keyframes textShimmer {
          0% {
            background-position: -200% center;
          }
          100% {
            background-position: 200% center;
          }
        }
      `}</style>

      <div className={cn(
        "flex items-center gap-2 text-[15px] font-medium tracking-wide",
        className
      )}>
        <Loader
          size={18}
          strokeWidth={2.5}
          className="text-zinc-600 dark:text-zinc-200"
        />

        <span
          className="bg-clip-text text-transparent shimmer-text"
          style={{
            backgroundSize: "200% auto",
            animation: "textShimmer 2.5s linear infinite"
          }}
        >
          {text}
        </span>

        <ChevronRight size={16} className="text-zinc-400 dark:text-zinc-500" />
      </div>

      <style>{`
        .shimmer-text {
          background-image: linear-gradient(
            90deg,
            rgb(113 113 122) 0%,
            rgb(113 113 122) 35%,
            rgb(255 255 255) 50%,
            rgb(113 113 122) 65%,
            rgb(113 113 122) 100%
          );
        }
        .dark .shimmer-text {
          background-image: linear-gradient(
            90deg,
            rgb(161 161 170) 0%,
            rgb(161 161 170) 35%,
            rgb(255 255 255) 50%,
            rgb(161 161 170) 65%,
            rgb(161 161 170) 100%
          );
        }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------------------
// Tool Calling Animation - Collapsible Search/Tool Execution Display
// ---------------------------------------------------------------------------

interface ToolQuery {
  id: string;
  text: string;
  status: 'searching' | 'complete';
}

interface ToolResult {
  id: string;
  title: string;
  source: string;
  icon: 'web' | 'file' | 'search';
}

interface ToolCallingAnimationProps {
  title?: string;
  queries?: ToolQuery[];
  results?: ToolResult[];
  isExpanded?: boolean;
  onToggle?: () => void;
  className?: string;
}

export function ToolCallingAnimation({
  title = "Gathering information",
  queries = [],
  results = [],
  isExpanded = true,
  onToggle,
  className
}: ToolCallingAnimationProps) {
  const [internalExpanded, setInternalExpanded] = useState(isExpanded);

  const expanded = onToggle !== undefined ? isExpanded : internalExpanded;
  const handleToggle = () => {
    if (onToggle) {
      onToggle();
    } else {
      setInternalExpanded(!internalExpanded);
    }
  };

  const getIcon = (iconType: 'web' | 'file' | 'search') => {
    switch (iconType) {
      case 'web':
        return <Globe size={14} className="text-blue-500" />;
      case 'file':
        return <FileText size={14} className="text-purple-500" />;
      case 'search':
        return <Search size={14} className="text-emerald-500" />;
    }
  };

  return (
    <div className={cn(
      "rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 overflow-hidden",
      className
    )}>
      {/* Header */}
      <button
        onClick={handleToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
      >
        <Globe size={16} className="text-zinc-500 dark:text-zinc-400" />
        <span className="flex-1 text-left text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {title}
        </span>
        <motion.div
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <ChevronDown size={16} className="text-zinc-400" />
        </motion.div>
      </button>

      {/* Expandable Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3 border-t border-zinc-100 dark:border-zinc-800 pt-3">
              {/* Queries */}
              {queries.length > 0 && (
                <div className="space-y-2">
                  {queries.map((query, index) => (
                    <motion.div
                      key={query.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center gap-2 text-sm"
                    >
                      {query.status === 'searching' ? (
                        <Loader size={14} strokeWidth={2} className="text-zinc-400" />
                      ) : (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      )}
                      <Search size={12} className="text-zinc-400" />
                      <span className="text-zinc-600 dark:text-zinc-400 text-xs">
                        {query.text}
                      </span>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Results */}
              {results.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  {results.map((result, index) => (
                    <motion.div
                      key={result.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 + index * 0.1 }}
                      className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group"
                    >
                      <div className="mt-0.5">
                        {getIcon(result.icon)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300 truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-100">
                          {result.title}
                        </div>
                        <div className="text-[10px] text-zinc-500 dark:text-zinc-500 truncate mt-0.5">
                          {result.source}
                        </div>
                      </div>
                      <CheckCircle2 size={12} className="text-emerald-500 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Show more indicator */}
              {results.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="text-[10px] text-zinc-400 dark:text-zinc-600 text-center pt-1"
                >
                  +{results.length} more
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { Loader };
