'use client';

/**
 * Pill-Based Narrative Timeline Component
 *
 * Displays a task-oriented timeline with tool pills representing individual tool executions.
 * Each task is displayed as a section with inline tool pills. Clicking a pill opens the
 * Tool Detail Side Panel showing parameters, results, and errors.
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
 */

import React, { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { NarrativeTimeline, Task, ToolPill, ExecutionStatus } from '../../main/agent/runner/pill-narrative/types';
import ToolDetailSidePanel from './ToolDetailSidePanel';

/**
 * Props for the PillNarrativeTimelineComponent
 */
export interface PillNarrativeTimelineComponentProps {
  /** The narrative timeline to display */
  timeline: NarrativeTimeline | null;

  /** Whether the timeline is currently running */
  isRunning: boolean;

  /** Callback when a pill is clicked */
  onPillClick?: (pillId: string, pill: ToolPill) => void;

  /** Callback when a task is expanded/collapsed */
  onTaskExpand?: (taskId: string, isExpanded: boolean) => void;

  /** Display variant (main timeline or sidebar) */
  variant?: 'main' | 'sidebar';

  /** Whether to auto-collapse completed tasks */
  autoCollapse?: boolean;
}

/**
 * Status color mapping
 */
const STATUS_COLORS: Record<ExecutionStatus, string> = {
  pending: 'bg-gray-100 text-gray-700 border-gray-300',
  'in-progress': 'bg-blue-100 text-blue-700 border-blue-300 animate-pulse',
  completed: 'bg-green-100 text-green-700 border-green-300',
  failed: 'bg-red-100 text-red-700 border-red-300',
  skipped: 'bg-yellow-100 text-yellow-700 border-yellow-300',
};

/**
 * Status icon mapping
 */
const STATUS_ICONS: Record<ExecutionStatus, string> = {
  pending: '⏳',
  'in-progress': '⚙️',
  completed: '✅',
  failed: '❌',
  skipped: '⊘',
};

/**
 * Tool pill component
 */
const GlobeDotIcon = ({ isRunning, color }: { isRunning: boolean; color: string }) => {
  return (
    <div className="w-7 h-7 flex items-center justify-center relative flex-shrink-0">
      <motion.div
        className="absolute w-7 h-7 rounded-full"
        style={{
          backgroundColor: `${color}14`, // 8% opacity
          border: `1px solid ${color}26`, // 15% opacity
        }}
        animate={isRunning ? { scale: [1, 1.35, 1], opacity: [0.6, 0.2, 0.6] } : { scale: [1, 1.15, 1], opacity: [0.4, 0.15, 0.4] }}
        transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
      />
      <div
        className="w-2.5 h-2.5 rounded-full relative z-10"
        style={{
          backgroundColor: color,
          border: "1.5px solid #ffffff",
          boxShadow: `0 0 8px ${color}cc`,
        }}
      />
    </div>
  );
};

interface ParsedFact {
  timestamp?: string;
  content: string;
  tags: string[];
}

const TAG_COLORS: Record<string, { bg: string, text: string, border: string }> = {
  identity: { bg: 'rgba(16, 185, 129, 0.08)', text: '#059669', border: 'rgba(16, 185, 129, 0.2)' },
  preference: { bg: 'rgba(59, 130, 246, 0.08)', text: '#2563eb', border: 'rgba(59, 130, 246, 0.2)' },
  habit: { bg: 'rgba(245, 158, 11, 0.08)', text: '#d97706', border: 'rgba(245, 158, 11, 0.2)' },
  travel: { bg: 'rgba(139, 92, 246, 0.08)', text: '#7c3aed', border: 'rgba(139, 92, 246, 0.2)' },
  payment: { bg: 'rgba(236, 72, 153, 0.08)', text: '#db2777', border: 'rgba(236, 72, 153, 0.2)' },
  work: { bg: 'rgba(6, 182, 212, 0.08)', text: '#0891b2', border: 'rgba(6, 182, 212, 0.2)' },
  contact: { bg: 'rgba(14, 165, 233, 0.08)', text: '#0284c7', border: 'rgba(14, 165, 233, 0.2)' },
  fact: { bg: 'rgba(107, 114, 128, 0.08)', text: 'var(--color-text-secondary)', border: 'rgba(107, 114, 128, 0.2)' },
};

const formatTimestamp = (ts?: string): string => {
  if (!ts) return "Recently";
  try {
    const date = new Date(ts);
    if (isNaN(date.getTime())) return ts;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
};

const deduceTags = (content: string, existingTags: string[] = []): string[] => {
  const tags = new Set<string>(existingTags.map(t => t.toLowerCase()));
  const lower = content.toLowerCase();

  if (lower.includes('name') || lower.includes('called') || lower.includes('username')) {
    tags.add('identity');
  }
  if (lower.includes('like') || lower.includes('dislike') || lower.includes('love') || lower.includes('hate') || lower.includes('prefer') || lower.includes('favorite')) {
    tags.add('preference');
  }
  if (lower.includes('always') || lower.includes('usually') || lower.includes('often') || lower.includes('every') || lower.includes('habit')) {
    tags.add('habit');
  }
  if (lower.includes('flight') || lower.includes('airline') || lower.includes('travel') || lower.includes('seat') || lower.includes('hotel')) {
    tags.add('travel');
  }
  if (lower.includes('card') || lower.includes('visa') || lower.includes('billing') || lower.includes('payment') || lower.includes('stripe')) {
    tags.add('payment');
  }
  if (lower.includes('work') || lower.includes('company') || lower.includes('office') || lower.includes('job') || lower.includes('profession')) {
    tags.add('work');
  }
  if (lower.includes('email') || lower.includes('phone') || lower.includes('contact') || lower.includes('address')) {
    tags.add('contact');
  }

  if (tags.size === 0) {
    tags.add('fact');
  }

  return Array.from(tags);
};

const parseFacts = (output: string): ParsedFact[] => {
  if (!output) return [];

  try {
    const clean = output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(clean);
    
    if (parsed && Array.isArray(parsed.newMemories)) {
      return parsed.newMemories.map((m: any) => {
        const content = m.fact || m.content || JSON.stringify(m);
        const tags = m.type ? [m.type] : m.category ? [m.category] : [];
        return {
          timestamp: m.timestamp || m.created,
          content,
          tags: deduceTags(content, tags)
        };
      });
    }
    
    if (parsed && (parsed.fact || parsed.content)) {
      const content = parsed.fact || parsed.content;
      const tags = parsed.type ? [parsed.type] : parsed.category ? [parsed.category] : [];
      const ts = parsed.timestamp || parsed.created || parsed.metadata?.created;
      return [{ timestamp: ts, content, tags: deduceTags(content, tags) }];
    }
  } catch (e) {}

  const lines = output.split('\n');
  const facts: ParsedFact[] = [];
  let currentTimestamp: string | undefined = undefined;

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const timeMatch = line.match(/^\((2\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\)$/i) || 
                       line.match(/^\((2\d{3}-\d{2}-\d{2})\)$/);
    if (timeMatch) {
      currentTimestamp = timeMatch[1];
      continue;
    }

    const inlineTimeMatch = line.match(/^\((.*?)\)\s*[-:]?\s*(.*)/);
    if (inlineTimeMatch) {
      const ts = inlineTimeMatch[1];
      const content = inlineTimeMatch[2].replace(/^-\s*/, '').trim();
      facts.push({ timestamp: ts, content, tags: deduceTags(content) });
      continue;
    }

    if (line.startsWith('-')) {
      const content = line.slice(1).trim();
      facts.push({ timestamp: currentTimestamp, content, tags: deduceTags(content) });
      continue;
    }

    if (line.toLowerCase().startsWith('found matches:')) continue;
    if (line.toLowerCase().startsWith('no facts') || line.toLowerCase().startsWith('no memory')) continue;

    const cleanContent = line.replace(/^-\s*/, '').trim();
    if (cleanContent.length > 3) {
      facts.push({ timestamp: currentTimestamp, content: cleanContent, tags: deduceTags(cleanContent) });
    }
  }

  return facts;
};

function MemoryTimelineCard({
  pill,
  onClick,
}: {
  pill: ToolPill;
  onClick: (pill: ToolPill) => void;
}) {
  const isRunning = pill.status === 'in-progress';
  const isError = pill.status === 'failed';
  
  const tname = (pill.toolName || pill.label || "").toLowerCase();
  const isRecall = tname.includes('recall') || tname.includes('search');
  const isSave = tname.includes('remember') || tname.includes('save') || tname.includes('consolidator');
  const isUpdate = tname.includes('update') || tname.includes('profile') || tname.includes('preference');
  
  let opLabel = "Memory Access";
  let themeColor = "#10b981"; // Unified EverFern emerald green brand theme
  let cardClass = "bg-emerald-50/10 border-emerald-100/70 hover:border-gray-300 hover:shadow-sm";
  let badgeClass = "bg-emerald-100 text-emerald-700";
  
  if (isSave) {
    opLabel = "Memory Retained";
  } else if (isUpdate) {
    opLabel = "Memory Updated";
  } else if (isRecall) {
    opLabel = "Memory Recalled";
  }
  
  if (isError) {
    opLabel = "Memory Access Failed";
    themeColor = "#ef4444";
    cardClass = "bg-red-50/15 border-red-150/70 hover:border-gray-300 hover:shadow-sm";
    badgeClass = "bg-red-100 text-red-700";
  }

  if (isRunning) {
    cardClass = "bg-emerald-50/20 border-emerald-200 animate-pulse";
  }

  const query = pill.parameters?.query || pill.parameters?.fact || pill.parameters?.content || pill.parameters?.preference || pill.parameters?.taskName || '';
  
  let previewText = "";
  if (pill.result) {
    const output = typeof pill.result === 'string' ? pill.result : ((pill.result as any).output || '');
    try {
      const clean = output.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed && Array.isArray(parsed.newMemories)) {
        previewText = parsed.newMemories.map((m: any) => m.fact || m.content).join(", ");
      } else if (parsed && parsed.fact) {
        previewText = parsed.fact;
      }
    } catch {
      previewText = output.replace(/^Found matches:\s*/i, '').trim();
      if (previewText.toLowerCase().startsWith('no ') || previewText.toLowerCase().startsWith('no facts')) {
        previewText = "No memory records matched this context.";
      } else {
        previewText = previewText.split(/\n---\n|\n---\s*\n/)[0].trim();
        const srcMatch = previewText.match(/^\[(.*?)\]\s*\[(.*?)\]/);
        if (srcMatch) {
          previewText = previewText.slice(srcMatch[0].length).trim();
        }
      }
    }
  }

  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 5 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 30 }}
      onClick={(e) => {
        setExpanded(!expanded);
        e.stopPropagation();
      }}
      className={`w-full max-w-[620px] rounded-xl border p-3 cursor-pointer shadow-sm transition-all duration-200 ${cardClass}`}
    >
      <div className="flex items-center gap-3">
        <GlobeDotIcon isRunning={isRunning} color={themeColor} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-gray-800">
              {isRunning ? "Accessing EverFern Memory..." : opLabel}
            </span>
            {!isRunning && (
              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${badgeClass}`}>
                {pill.toolName}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClick(pill);
            }}
            className="px-2 py-1 bg-black/5 hover:bg-black/10 rounded text-[10px] font-semibold text-gray-600 transition-colors"
          >
            Trace
          </button>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} className="text-gray-400">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden mt-2 pt-2 border-t border-gray-100 flex flex-col gap-1.5"
          >
            {query && (
              <div className="text-[11px] text-gray-500">
                <span className="font-semibold">Query:</span> <code className="font-mono text-gray-700 break-all">{String(query)}</code>
              </div>
            )}
            
            {previewText && (() => {
              const parsedFacts = parseFacts((pill.result as any)?.output || (typeof pill.result === 'string' ? pill.result : ''));
              return (
                <div className={`flex flex-col gap-1.5 ${query ? 'mt-1' : ''}`}>
                  {parsedFacts.length > 0 ? (
                    parsedFacts.map((fact, fIdx) => {
                      const formattedTime = formatTimestamp(fact.timestamp);
                      return (
                        <div key={fIdx} className={`flex items-start justify-between gap-4 py-1 ${fIdx > 0 ? 'border-t border-gray-50' : ''}`}>
                          <p className="text-xs text-gray-700 leading-normal flex-1">
                            {fact.content}
                          </p>
                          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5">
                            {fact.tags.map((tag) => (
                              <span key={tag} className="text-[8.5px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200/50 uppercase tracking-wide">
                                {tag}
                              </span>
                            ))}
                            <span className="text-[9.5px] text-gray-400 whitespace-nowrap">
                              {formattedTime}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <p className="text-xs text-gray-700 leading-normal">
                      {previewText}
                    </p>
                  )}
                </div>
              );
            })()}

            {isError && pill.error && (
              <div className="border-t border-gray-50 pt-1.5 mt-1">
                <span className="text-[9px] font-bold text-red-400 uppercase tracking-wider font-sans">Failure Output</span>
                <p className="text-xs text-red-700 font-mono break-all mt-0.5">{String(pill.error)}</p>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PillComponent({
  pill,
  onClick,
}: {
  pill: ToolPill;
  onClick: (pill: ToolPill) => void;
}) {
  const statusColor = STATUS_COLORS[pill.status];
  const statusIcon = STATUS_ICONS[pill.status];

  const n = (pill.toolName || pill.label || "").toLowerCase();
  const isMemory = n === 'fern' || n === 'recall_fact' || n === 'remember_fact' || n === 'update_profile' || n.includes('fern') || n.includes('memory') || n.includes('consolidator') || n.includes('confirm_preference') || n.includes('recall') || n.includes('remember');

  if (isMemory) {
    return <MemoryTimelineCard pill={pill} onClick={onClick} />;
  }

  const displayLabel = pill.label || pill.toolName;
  const displayIcon = pill.icon || '⚙️';

  return (
    <motion.button
      onClick={() => onClick(pill)}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all hover:shadow-md cursor-pointer ${statusColor}`}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      title={`${displayLabel} - ${pill.status}`}
    >
      <span className="text-sm">{displayIcon}</span>
      <span className="text-xs font-medium">{displayLabel}</span>
      <span className="text-xs opacity-75">{statusIcon}</span>
    </motion.button>
  );
}

/**
 * Task section component
 */
function TaskSection({
  task,
  isCollapsed,
  onToggleCollapse,
  onPillClick,
}: {
  task: Task;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onPillClick: (pill: ToolPill) => void;
}) {
  const statusColor = STATUS_COLORS[task.status];
  const statusIcon = STATUS_ICONS[task.status];

  // Calculate progress
  const completedPills = task.pills.filter((p) => p.status === 'completed').length;
  const failedPills = task.pills.filter((p) => p.status === 'failed').length;
  const totalPills = task.pills.length;
  const progressPercent = totalPills > 0 ? (completedPills / totalPills) * 100 : 0;

  return (
    <motion.div
      className="border border-gray-200 rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
    >
      {/* Task Header */}
      <button
        onClick={onToggleCollapse}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 flex-1 text-left">
          {/* Collapse/Expand Icon */}
          <motion.div
            animate={{ rotate: isCollapsed ? 0 : 90 }}
            transition={{ duration: 0.2 }}
            className="text-gray-400"
          >
            ▶
          </motion.div>

          {/* Task Title and Status */}
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">{task.title}</h3>
            {task.description && (
              <p className="text-xs text-gray-500 mt-1">{task.description}</p>
            )}
          </div>

          {/* Status Badge */}
          <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
            <span>{statusIcon}</span>
            <span>{task.status}</span>
          </div>
        </div>
      </button>

      {/* Progress Bar */}
      {totalPills > 0 && (
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-600">
              {completedPills}/{totalPills} completed
            </span>
            {failedPills > 0 && (
              <span className="text-xs text-red-600">{failedPills} failed</span>
            )}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <motion.div
              className="bg-green-500 h-full"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
        </div>
      )}

      {/* Pills Section */}
      <AnimatePresence>
        {!isCollapsed && (
          <motion.div
            className="px-4 py-3 border-t border-gray-100 bg-gray-50"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="flex flex-wrap gap-2">
              {task.pills.map((pill) => (
                <PillComponent
                  key={pill.id}
                  pill={pill}
                  onClick={onPillClick}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Main PillNarrativeTimelineComponent
 */
export default function PillNarrativeTimeline({
  timeline,
  isRunning,
  onPillClick,
  onTaskExpand,
  variant = 'main',
  autoCollapse = false,
}: PillNarrativeTimelineComponentProps) {
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());
  const [selectedPill, setSelectedPill] = useState<ToolPill | null>(null);
  const [showSidePanel, setShowSidePanel] = useState(false);

  // Handle task collapse/expand
  const handleToggleCollapse = useCallback(
    (taskId: string) => {
      setCollapsedTasks((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) {
          next.delete(taskId);
        } else {
          next.add(taskId);
        }
        onTaskExpand?.(taskId, !next.has(taskId));
        return next;
      });
    },
    [onTaskExpand]
  );

  // Handle pill click
  const handlePillClick = useCallback(
    (pill: ToolPill) => {
      setSelectedPill(pill);
      setShowSidePanel(true);
      onPillClick?.(pill.id, pill);
    },
    [onPillClick]
  );

  // Auto-collapse completed tasks
  const displayTasks = useMemo(() => {
    if (!timeline) return [];

    return timeline.tasks.map((task) => {
      const isCompleted = task.status === 'completed';
      const shouldCollapse = autoCollapse && isCompleted;

      if (shouldCollapse && !collapsedTasks.has(task.id)) {
        setCollapsedTasks((prev) => new Set(prev).add(task.id));
      }

      return task;
    });
  }, [timeline, autoCollapse, collapsedTasks]);

  if (!timeline) {
    return (
      <div className="flex items-center justify-center py-8 text-gray-500">
        <p>No timeline data available</p>
      </div>
    );
  }

  const mainStatusIcon = STATUS_ICONS[timeline.status];
  const mainStatusColor = STATUS_COLORS[timeline.status];

  return (
    <div className={`flex flex-col gap-4 ${variant === 'sidebar' ? 'max-h-96 overflow-y-auto' : ''}`}>
      {/* Timeline Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">Execution Timeline</h2>
          {isRunning && (
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          )}
        </div>
        <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${mainStatusColor}`}>
          <span>{mainStatusIcon}</span>
          <span>{timeline.status}</span>
        </div>
      </div>

      {/* Tasks List */}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {displayTasks.length > 0 ? (
            displayTasks.map((task) => (
              <TaskSection
                key={task.id}
                task={task}
                isCollapsed={collapsedTasks.has(task.id)}
                onToggleCollapse={() => handleToggleCollapse(task.id)}
                onPillClick={handlePillClick}
              />
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>No tasks in timeline</p>
            </div>
          )}
        </AnimatePresence>
      </div>

      {/* Tool Detail Side Panel */}
      {selectedPill && (
        <ToolDetailSidePanel
          isOpen={showSidePanel}
          toolCall={{
            id: selectedPill.id,
            toolName: selectedPill.toolName,
            args: selectedPill.parameters || {},
            output: selectedPill.result || '',
            agentName: 'Agent',
          }}
          onClose={() => {
            setShowSidePanel(false);
            setSelectedPill(null);
          }}
          conversationId=""
        />
      )}
    </div>
  );
}
