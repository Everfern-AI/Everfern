'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PlusIcon, TrashIcon, ClockIcon, PlayIcon } from '@heroicons/react/24/outline';

interface ScheduledTask {
  id: string;
  name?: string;
  description: string;
  cron: string;
  prompt: string;
  enabled: boolean;
  nextRun?: string;
  endsAt?: string;
}

interface ScheduledTasksPanelProps {
  projectId?: string;
  onAddTask: () => void;
  refreshTrigger?: number;
}

export default function ScheduledTasksPanel({ projectId, onAddTask, refreshTrigger }: ScheduledTasksPanelProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchTasks = async () => {
    try {
      const result = await (window as any).electronAPI.scheduledTasks.list(projectId);
      setTasks(result);
    } catch (err) {
      console.error('Failed to fetch scheduled tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
    // Refresh every 30 seconds to update nextRun timers if any
    const interval = setInterval(fetchTasks, 30000);
    return () => clearInterval(interval);
  }, [projectId, refreshTrigger]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this scheduled task?')) return;
    try {
      await (window as any).electronAPI.scheduledTasks.delete(id);
      setTasks(tasks.filter(t => t.id !== id));
    } catch (err) {
      console.error('Failed to delete task:', err);
    }
  };

  return (
    <div style={{ backgroundColor: "#ffffff", border: "1px solid #e8e6d9", borderRadius: 12, overflow: "hidden", boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 20px",
          backgroundColor: "#111111",
          border: "none",
          cursor: "pointer",
          transition: "background-color 0.2s"
        }}
        className="hover:bg-gray-900"
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ClockIcon className="w-5 h-5 text-white/80" />
          <span style={{ fontSize: 14, fontWeight: 600, color: "#ffffff", fontFamily: 'var(--font-sans)', letterSpacing: '0.01em' }}>Scheduled Tasks</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            onClick={(e) => { e.stopPropagation(); onAddTask(); }}
            style={{ padding: 6, borderRadius: 8, transition: 'background 0.2s', backgroundColor: 'rgba(255,255,255,0.1)' }}
            className="hover:bg-white/20"
          >
            <PlusIcon className="w-5 h-5 text-white" />
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s", opacity: 0.8 }}><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: "hidden" }}
          >
            <div style={{ padding: "16px 20px 20px" }} className="flex flex-col gap-4">
              {loading ? (
                <div className="py-6 text-center">
                  <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                </div>
              ) : tasks.length === 0 ? (
                <p style={{ fontSize: 13, color: "#9ca3af", margin: 0, fontStyle: "italic", lineHeight: 1.6, paddingTop: 4 }}>
                  No scheduled tasks. Click the plus icon to create one.
                </p>
              ) : (
                tasks.map(task => (
                  <div
                    key={task.id}
                    className="group relative bg-gray-50/50 hover:bg-gray-100/50 border border-gray-100 rounded-xl p-4 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-gray-700 truncate">{task.name || task.description}</h4>
                        {task.name && <p className="text-[11px] text-gray-500 truncate mt-1.5">{task.description}</p>}
                        <div className="flex items-center gap-2 mt-2.5 text-xs text-gray-500">
                          <ClockIcon className="w-3.5 h-3.5 flex-shrink-0" />
                          <span>{task.cron}</span>
                          {task.endsAt && (
                            <span className="ml-1.5 px-2 py-0.5 bg-gray-200 text-[9px] rounded uppercase font-bold text-gray-600">
                              Ends {new Date(task.endsAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, task.id)}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-gray-400 hover:text-red-500 transition-all flex-shrink-0"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                    {task.nextRun && (
                      <div className="mt-3 pt-3 border-t border-gray-100/50 flex items-center gap-2 text-[10px] uppercase tracking-wider font-semibold text-indigo-400">
                        <PlayIcon className="w-3 h-3 flex-shrink-0" />
                        <span>Next Run: {new Date(task.nextRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
