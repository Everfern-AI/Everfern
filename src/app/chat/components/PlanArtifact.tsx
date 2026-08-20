"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDownIcon,
  PlayIcon,
  PencilIcon,
  ListBulletIcon,
  CheckCircleIcon,
  CircleStackIcon,
} from "@heroicons/react/24/outline";
import { CheckCircleIcon as CheckCircleSolidIcon } from "@heroicons/react/24/solid";

interface PlanStep {
  id: string;
  title: string;
  description?: string;
  status?: "pending" | "in_progress" | "completed";
}

interface PlanArtifactProps {
  title?: string;
  description?: string;
  steps?: PlanStep[];
  meta?: {
    estimatedTime?: string;
    tools?: string[];
    complexity?: "low" | "medium" | "high";
  };
  onApprove?: () => void;
  onEdit?: () => void;
  className?: string;
  defaultExpanded?: boolean;
  variant?: "card" | "panel" | "flat";
}

/**
 * Muted minimal plan artifact card
 * Soft grey tones, clean typography, subtle depth
 */
export function PlanArtifact({
  title = "Execution Plan",
  description,
  steps = [],
  meta,
  onApprove,
  onEdit,
  className,
  defaultExpanded = true,
  variant = "card",
}: PlanArtifactProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hoveredStep, setHoveredStep] = useState<string | null>(null);

  const isPanel = variant === "panel" || variant === "flat";
  const completedSteps = steps.filter((s) => s.status === "completed").length;
  const progress = steps.length > 0 ? (completedSteps / steps.length) * 100 : 0;

  const complexityColor = {
    low: "bg-stone-400",
    medium: "bg-stone-500",
    high: "bg-stone-600",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
      className={[
        "w-full",
        isPanel
          ? "bg-transparent border-0 rounded-none"
          : "bg-stone-50/80 dark:bg-stone-900/40 border border-stone-200/60 dark:border-stone-800/60 rounded-2xl backdrop-blur-sm",
        "overflow-hidden",
        className,
      ].join(" ")}
    >
      {/* Header */}
      <div
        onClick={() => setExpanded(!expanded)}
        className={[
          "flex items-center gap-3",
          isPanel ? "px-0 py-2.5" : "px-5 py-4",
          "cursor-pointer",
          "transition-colors duration-200",
          "hover:bg-stone-100/50 dark:hover:bg-stone-800/30",
          "border-b border-stone-200/50 dark:border-stone-800/50",
        ].join(" ")}
      >
        {/* Icon */}
        <div
          className={[
            isPanel ? "w-8 h-8 rounded-lg" : "w-10 h-10 rounded-xl",
            "bg-stone-200/60 dark:bg-stone-800/60",
            "flex items-center justify-center",
            "flex-shrink-0",
          ].join(" ")}
        >
          <ListBulletIcon className={isPanel ? "w-4 h-4 text-stone-500 dark:text-stone-400" : "w-5 h-5 text-stone-500 dark:text-stone-400"} />
        </div>

        {/* Title section */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-stone-700 dark:text-stone-300 truncate">
            {title}
          </h3>
          {steps.length > 0 && (
            <p className="text-xs text-stone-400 dark:text-stone-500 mt-0.5">
              {completedSteps} of {steps.length} steps completed
            </p>
          )}
        </div>

        {/* Meta badges */}
        <div className="flex items-center gap-2">
          {meta?.complexity && (
            <span
              className={[
                "w-2 h-2 rounded-full",
                complexityColor[meta.complexity],
              ].join(" ")}
              title={`Complexity: ${meta.complexity}`}
            />
          )}
          <ChevronDownIcon
            className={[
              "w-4 h-4 text-stone-400",
              "transition-transform duration-200",
              expanded ? "rotate-180" : "",
            ].join(" ")}
          />
        </div>
      </div>

      {/* Progress bar */}
      {steps.length > 0 && (
        <div className="h-0.5 bg-stone-200/50 dark:bg-stone-800/50">
          <motion.div
            className="h-full bg-stone-400 dark:bg-stone-500"
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5, ease: "easeOut" }}
          />
        </div>
      )}

      {/* Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className={isPanel ? "px-0 py-3 space-y-3" : "px-5 py-4 space-y-4"}>
              {/* Description */}
              {description && (
                <p className="text-sm text-stone-500 dark:text-stone-400 leading-relaxed">
                  {description}
                </p>
              )}

              {/* Steps */}
              {steps.length > 0 && (
                <div className="space-y-1">
                  {steps.map((step, index) => {
                    const isCompleted = step.status === "completed";
                    const isInProgress = step.status === "in_progress";
                    const isHovered = hoveredStep === step.id;
                    const hasUniqueDesc = Boolean(step.description && step.description.trim() !== step.title.trim());

                    return (
                      <motion.div
                        key={step.id}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        onMouseEnter={() => setHoveredStep(step.id)}
                        onMouseLeave={() => setHoveredStep(null)}
                        className={[
                          "group flex items-start gap-3",
                          isPanel ? "py-2 px-2 -mx-2" : "py-2.5 px-3 -mx-3",
                          "rounded-lg",
                          "transition-colors duration-150",
                          isHovered ? "bg-stone-100/60 dark:bg-stone-800/40" : "",
                        ].join(" ")}
                      >
                        {/* Step indicator */}
                        <div className="flex-shrink-0 mt-0.5">
                          {isCompleted ? (
                            <CheckCircleSolidIcon className="w-5 h-5 text-stone-400 dark:text-stone-500" />
                          ) : isInProgress ? (
                            <div
                              className={[
                                "w-5 h-5 rounded-full",
                                "border-2 border-stone-400 dark:border-stone-500",
                                "flex items-center justify-center",
                              ].join(" ")}
                            >
                              <span className="text-[10px] font-medium text-stone-500 dark:text-stone-400">
                                {index + 1}
                              </span>
                            </div>
                          ) : (
                            <div
                              className={[
                                "w-5 h-5 rounded-full",
                                "border border-stone-300 dark:border-stone-700",
                                "flex items-center justify-center",
                              ].join(" ")}
                            >
                              <span className="text-[10px] font-medium text-stone-400 dark:text-stone-500">
                                {index + 1}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Step content */}
                        <div className="flex-1 min-w-0">
                          <p
                            className={[
                              "text-sm leading-relaxed break-words",
                              isCompleted
                                ? "text-stone-400 dark:text-stone-500 line-through"
                                : isInProgress
                                ? "text-stone-700 dark:text-stone-300 font-medium"
                                : "text-stone-600 dark:text-stone-400",
                            ].join(" ")}
                            style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}
                          >
                            {step.title}
                          </p>
                          {hasUniqueDesc && (
                            <p 
                              className="text-xs text-stone-400 dark:text-stone-500 mt-0.5 leading-relaxed break-words"
                              style={{ wordWrap: 'break-word', overflowWrap: 'break-word' }}
                            >
                              {step.description}
                            </p>
                          )}
                        </div>

                        {/* Status indicator */}
                        {isInProgress && (
                          <div className="flex-shrink-0 self-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-stone-400 dark:bg-stone-500 animate-pulse" />
                          </div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}

              {/* Meta info */}
              {meta && (meta.estimatedTime || meta.tools) && (
                <div
                  className={[
                    "flex items-center gap-4",
                    "pt-3",
                    "border-t border-stone-200/50 dark:border-stone-800/50",
                  ].join(" ")}
                >
                  {meta.estimatedTime && (
                    <div className="flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500">
                      <CircleStackIcon className="w-3.5 h-3.5" />
                      <span>{meta.estimatedTime}</span>
                    </div>
                  )}
                  {meta.tools && meta.tools.length > 0 && (
                    <div className="flex items-center gap-1.5">
                      {meta.tools.slice(0, 3).map((tool, i) => (
                        <span
                          key={i}
                          className={[
                            "text-[10px]",
                            "px-2 py-0.5",
                            "rounded-full",
                            "bg-stone-200/60 dark:bg-stone-800/60",
                            "text-stone-500 dark:text-stone-400",
                          ].join(" ")}
                        >
                          {tool}
                        </span>
                      ))}
                      {meta.tools.length > 3 && (
                        <span className="text-[10px] text-stone-400 dark:text-stone-500">
                          +{meta.tools.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              {(onApprove || onEdit) && (
                <div
                  className={[
                    "flex items-center gap-2",
                    "pt-3",
                    "border-t border-stone-200/50 dark:border-stone-800/50",
                  ].join(" ")}
                >
                  {onEdit && (
                    <button
                      onClick={onEdit}
                      className={[
                        "flex items-center justify-center gap-1.5",
                        "flex-1",
                        "px-4 py-2",
                        "rounded-lg",
                        "text-xs font-medium",
                        "text-stone-500 dark:text-stone-400",
                        "bg-transparent",
                        "border border-stone-200/60 dark:border-stone-700/60",
                        "hover:bg-stone-100 dark:hover:bg-stone-800",
                        "transition-colors duration-150",
                      ].join(" ")}
                    >
                      <PencilIcon className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )}
                  {onApprove && (
                    <button
                      onClick={onApprove}
                      className={[
                        "flex items-center justify-center gap-1.5",
                        onEdit ? "flex-[2]" : "flex-1",
                        "px-4 py-2",
                        "rounded-lg",
                        "text-xs font-medium",
                        "text-stone-800 dark:text-stone-200",
                        "bg-stone-200/80 dark:bg-stone-700/80",
                        "hover:bg-stone-300 dark:hover:bg-stone-600",
                        "transition-colors duration-150",
                      ].join(" ")}
                    >
                      <PlayIcon className="w-3.5 h-3.5" />
                      Approve & Execute
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Compact plan artifact for inline display
 */
export function PlanArtifactCompact({
  title = "Execution Plan",
  stepCount = 0,
  completedCount = 0,
  onClick,
  className,
}: {
  title?: string;
  stepCount?: number;
  completedCount?: number;
  onClick?: () => void;
  className?: string;
}) {
  const progress = stepCount > 0 ? (completedCount / stepCount) * 100 : 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
      onClick={onClick}
      className={[
        "w-full",
        "flex items-center gap-3",
        "px-4 py-3",
        "bg-stone-50/60 dark:bg-stone-900/30",
        "border border-stone-200/40 dark:border-stone-800/40",
        "rounded-xl",
        "text-left",
        "transition-colors duration-150",
        "hover:bg-stone-100/60 dark:hover:bg-stone-800/40",
        className,
      ].join(" ")}
    >
      <div
        className={[
          "w-8 h-8",
          "rounded-lg",
          "bg-stone-200/60 dark:bg-stone-800/60",
          "flex items-center justify-center",
          "flex-shrink-0",
        ].join(" ")}
      >
        <ListBulletIcon className="w-4 h-4 text-stone-500 dark:text-stone-400" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-300 truncate">
          {title}
        </p>
        <p className="text-xs text-stone-400 dark:text-stone-500">
          {completedCount} of {stepCount} steps
        </p>
      </div>

      {progress > 0 && (
        <div className="w-12 h-1 bg-stone-200 dark:bg-stone-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-stone-400 dark:bg-stone-500 rounded-full"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      <ChevronDownIcon className="w-4 h-4 text-stone-400 -rotate-90" />
    </motion.button>
  );
}

export default PlanArtifact;
