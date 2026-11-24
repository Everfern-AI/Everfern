"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  ChartBarIcon, 
  CircleStackIcon, 
  ExclamationTriangleIcon, 
  CheckCircleIcon,
  ChevronRightIcon
} from '@heroicons/react/24/outline';

export interface SurfaceComponent {
  id: string;
  type: 'metric' | 'card' | 'button' | 'text' | 'form' | 'progress';
  props: any;
}

export interface SurfaceData {
  surfaceId: string;
  catalogId?: string;
  components: SurfaceComponent[];
}

export const SurfaceCanvas: React.FC<{ data: SurfaceData; onAction?: (id: string, value: any) => void }> = ({ data, onAction }) => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="everfern-surface-canvas p-4 my-2 rounded-2xl border border-white/20 bg-white/5 backdrop-blur-xl shadow-2xl overflow-hidden"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.components.map((comp) => (
          <SurfaceItem key={comp.id} component={comp} onAction={onAction} />
        ))}
      </div>
    </motion.div>
  );
};

const SurfaceItem: React.FC<{ component: SurfaceComponent; onAction?: (id: string, value: any) => void }> = ({ component, onAction }) => {
  const { type, props } = component;

  switch (type) {
    case 'metric':
      return (
        <div className="p-4 rounded-xl bg-black/10 border border-white/5 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400r">
            {props.icon === 'data' && <CircleStackIcon className="w-4 h-4" />}
            {props.icon === 'chart' && <ChartBarIcon className="w-4 h-4" />}
            {props.label}
          </div>
          <div className="text-2xl font-bold text-white tracking-tight">
            {props.value}
            <span className="text-sm font-normal text-zinc-500 ml-1">{props.unit}</span>
          </div>
          {props.trend && (
            <div className={`text-xs ${props.trend > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {props.trend > 0 ? '+' : ''}{props.trend}% from baseline
            </div>
          )}
        </div>
      );

    case 'card':
      return (
        <div className="col-span-full p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
          <h4 className="text-sm font-bold text-white mb-2">{props.title}</h4>
          <p className="text-sm text-zinc-400 leading-relaxed">{props.description}</p>
        </div>
      );

    case 'button':
      return (
        <button 
          onClick={() => onAction?.(component.id, props.actionValue)}
          className="flex items-center justify-between w-full p-4 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20 active:scale-[0.98] transition-all group"
        >
          <span className="text-sm font-semibold text-white">{props.label}</span>
          <ChevronRightIcon className="w-4 h-4 text-zinc-500 group-hover:text-white transition-colors" />
        </button>
      );

    case 'progress':
      const pct = Math.min(Math.max(props.value || 0, 0), 100);
      return (
        <div className="col-span-full space-y-2">
          <div className="flex justify-between text-xs font-medium text-zinc-400">
            <span>{props.label}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
            />
          </div>
        </div>
      );

    default:
      return null;
  }
};
export default SurfaceCanvas;
