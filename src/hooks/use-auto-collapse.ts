import { useState, useEffect, useRef } from 'react';

/**
 * Custom hook for auto-collapsing components when they transition from live to complete state.
 * 
 * This hook manages the expanded/collapsed state of components like ReasoningBranch and MissionTimeline,
 * automatically collapsing them when the live state transitions from true to false (completion).
 * 
 * @param isLive - Boolean indicating if the component is currently in a live/active state
 * @param autoCollapseEnabled - Boolean flag to enable/disable auto-collapse behavior
 * @param duration - Optional duration in milliseconds (for future use)
 * @returns Tuple of [expanded, setExpanded] for managing component state
 * 
 * @example
 * ```tsx
 * const [expanded, setExpanded] = useAutoCollapse(isLive, true);
 * ```
 */
export function useAutoCollapse(
  isLive: boolean,
  autoCollapseEnabled: boolean,
  duration?: number
): [boolean, (expanded: boolean) => void] {
  const [expanded, setExpanded] = useState(false);
  const prevIsLive = useRef(isLive);

  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    // Detect transition from live (true) to complete (false)
    if (prevIsLive.current && !isLive && autoCollapseEnabled) {
      if (duration && duration > 0) {
        timer = setTimeout(() => {
          setExpanded(false);
        }, duration);
      } else {
        setExpanded(false); // Auto-collapse immediately
      }
    }
    
    // Update previous state for next comparison
    prevIsLive.current = isLive;

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isLive, autoCollapseEnabled, duration]);

  return [expanded, setExpanded];
}
