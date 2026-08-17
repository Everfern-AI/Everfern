"use client";

import React, { type ComponentProps } from "react";
import { ChevronDownIcon, FileCode, FolderIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileTreeNode {
  path: string;
  name: string;
  depth: number;
  kind: "folder" | "file";
  additions?: number;
  deletions?: number;
}

export interface FileTreeProps extends Omit<
  ComponentProps<"div">,
  "children" | "nodes" | "visibleCount" | "totalAdditions" | "totalDeletions"
> {
  nodes: readonly FileTreeNode[];
  visibleCount?: number;
  totalAdditions: number;
  totalDeletions: number;
  className?: string;
  onFileClick?: (node: FileTreeNode) => void;
}

function take<T>(array: readonly T[], n: number): T[] {
  return array.slice(0, n);
}

export function FileTree({
  nodes,
  visibleCount = nodes.length,
  totalAdditions,
  totalDeletions,
  className,
  onFileClick,
  ...props
}: FileTreeProps) {
  const boundedCount = Math.max(0, Math.min(nodes.length, visibleCount));
  const displayedNodes = take(nodes, boundedCount);
  const fileCount = nodes.filter((n) => n.kind === "file").length;

  return (
    <div
      data-slot="file-tree"
      className={cn(
        "flex w-full max-w-lg flex-col gap-2 rounded-2xl p-3.5 border shadow-sm select-none my-2",
        className
      )}
      style={{
        backgroundColor: "var(--color-bg-surface, var(--color-bg-base))",
        borderColor: "var(--color-border)",
      }}
      {...props}
    >
      {/* Header Summary */}
      <div className="flex items-baseline justify-between px-1">
        <span className="text-[13px] font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {fileCount} {fileCount === 1 ? "file" : "files"} changed
        </span>
        <span className="font-mono text-xs tabular-nums flex items-center gap-1.5">
          {totalAdditions > 0 && (
            <span style={{ color: "var(--color-success, #10b981)" }}>
              +{totalAdditions}
            </span>
          )}
          {totalDeletions > 0 && (
            <span style={{ color: "var(--color-error, #ef4444)" }}>
              −{totalDeletions}
            </span>
          )}
        </span>
      </div>

      {/* Tree rows */}
      <div className="flex flex-col gap-0.5">
        {displayedNodes.map((node) => {
          const isFile = node.kind === "file";

          return (
            <div
              key={node.path}
              onClick={() => {
                if (isFile && onFileClick) {
                  onFileClick(node);
                }
              }}
              className={cn(
                "fade-in slide-in-from-left-1 animate-in fill-mode-both flex items-center gap-2 rounded-lg px-1.5 py-1 text-[13px] transition-colors duration-150",
                isFile && onFileClick && "cursor-pointer hover:opacity-85"
              )}
              style={{
                paddingInlineStart: `${0.25 + node.depth * 0.9}rem`,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-bg-subtle)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {!isFile ? (
                <>
                  <ChevronDownIcon
                    className="size-3 shrink-0 opacity-40"
                    style={{ color: "var(--color-text-tertiary)" }}
                  />
                  <FolderIcon
                    className="size-3.5 shrink-0 opacity-70"
                    style={{ color: "var(--color-text-secondary)" }}
                  />
                  <span
                    className="font-medium min-w-0 flex-1 truncate text-[12.5px]"
                    style={{ color: "var(--color-text-secondary)" }}
                  >
                    {node.name}
                  </span>
                </>
              ) : (
                <>
                  <FileCode
                    className="ms-3 size-3.5 shrink-0 opacity-60"
                    style={{ color: "var(--color-text-tertiary)" }}
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-[12.5px]"
                    style={{ color: "var(--color-text-primary)" }}
                  >
                    {node.name}
                  </span>
                  <span className="font-mono text-[11px] shrink-0 tabular-nums flex items-center gap-1">
                    {node.additions !== undefined && node.additions > 0 && (
                      <span style={{ color: "var(--color-success, #10b981)" }}>
                        +{node.additions}
                      </span>
                    )}
                    {node.deletions !== undefined && node.deletions > 0 && (
                      <span style={{ color: "var(--color-error, #ef4444)" }}>
                        −{node.deletions}
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default FileTree;
