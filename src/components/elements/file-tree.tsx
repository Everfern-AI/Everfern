"use client";

import React, { type ComponentProps } from "react";
import { FileCode, Folder } from "lucide-react";
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
      className={cn("flex w-full max-w-full flex-col gap-1.5 my-2 select-none", className)}
      {...props}
    >
      {/* Header Summary */}
      <div className="flex items-baseline justify-between py-0.5">
        <span className="text-[13.5px] font-medium text-foreground/75">
          {fileCount} {fileCount === 1 ? "file" : "files"} changed
        </span>
        <span className="font-mono text-xs tabular-nums flex items-center gap-1.5">
          {totalAdditions > 0 && (
            <span className="text-emerald-500 font-medium">+{totalAdditions}</span>
          )}
          {totalDeletions > 0 && (
            <span className="text-red-400 font-medium">−{totalDeletions}</span>
          )}
        </span>
      </div>

      {/* Tree rows */}
      <div className="flex flex-col gap-0.5 pl-2 border-l border-border/25 ml-1">
        {displayedNodes.map((node, idx) => {
          const isFile = node.kind === "file";

          return (
            <div
              key={`${node.kind}-${node.path}-${idx}`}
              onClick={() => {
                if (isFile && onFileClick) {
                  onFileClick(node);
                }
              }}
              className={cn(
                "flex items-center gap-2 py-0.5 text-[13px] transition-colors",
                isFile && onFileClick ? "cursor-pointer hover:opacity-80" : ""
              )}
              style={{
                paddingInlineStart: `${node.depth * 0.75}rem`,
              }}
            >
              {!isFile ? (
                <>
                  <Folder className="size-3.5 shrink-0 text-foreground/40" />
                  <span className="font-medium text-foreground/60 text-[12.5px] truncate">
                    {node.name}
                  </span>
                </>
              ) : (
                <>
                  <FileCode className="size-3.5 shrink-0 text-foreground/45" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground/80">
                    {node.name}
                  </span>
                  <span className="font-mono text-[11px] shrink-0 tabular-nums flex items-center gap-1">
                    {node.additions !== undefined && node.additions > 0 && (
                      <span className="text-emerald-500">+{node.additions}</span>
                    )}
                    {node.deletions !== undefined && node.deletions > 0 && (
                      <span className="text-red-400">−{node.deletions}</span>
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
