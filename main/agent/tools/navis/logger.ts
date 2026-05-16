export type NavisEventType =
  | 'browser_launch'
  | 'page_navigate'
  | 'element_click'
  | 'element_input'
  | 'scroll'
  | 'tab_change'
  | 'extract'
  | 'wait'
  | 'ai_decision'
  | 'step_complete'
  | 'task_complete'
  | 'error';

export interface NavisEvent {
  type: NavisEventType;
  step?: number;
  maxSteps?: number;
  action?: string;
  target?: string;
  selector?: string;
  position?: { x: number; y: number };
  url?: string;
  detail?: string;
  timestamp: number;
}

export class NavisLogger {
  private listeners: Set<(event: NavisEvent) => void> = new Set();

  on(listener: (event: NavisEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: Omit<NavisEvent, 'timestamp'>): void {
    const full: NavisEvent = { ...event, timestamp: Date.now() };
    const parts: string[] = [];

    if (event.step !== undefined && event.maxSteps !== undefined) {
      parts.push(`[Navis] Step ${event.step}/${event.maxSteps}`);
    } else {
      parts.push('[Navis]');
    }

    switch (event.type) {
      case 'browser_launch':
        parts.push(`Browser launched → ${event.detail || ''}`);
        break;
      case 'page_navigate':
        parts.push(`Navigating to ${event.url || event.action || '...'}`);
        break;
      case 'element_click':
        parts.push(`Clicked ${event.target ? `"${event.target}"` : 'element'}${event.position ? ` at (${event.position.x}, ${event.position.y})` : ''}`);
        break;
      case 'element_input':
        parts.push(`Typed into ${event.target ? `"${event.target}"` : 'input'} → "${event.action || ''}"`);
        break;
      case 'scroll':
        parts.push(`Scrolled ${event.action || 'down'}`);
        break;
      case 'tab_change':
        parts.push(`Tab changed → ${event.action || ''}`);
        break;
      case 'extract':
        parts.push(`Extracted content → ${event.detail || ''}`);
        break;
      case 'wait':
        parts.push(`Waiting ${event.detail || ''}`);
        break;
      case 'ai_decision':
        parts.push(`AI decided → ${event.action || ''}`);
        break;
      case 'step_complete':
        parts.push(`Step complete → ${event.detail || ''}`);
        break;
      case 'task_complete':
        parts.push(`Task complete — ${event.detail || ''}`);
        break;
      case 'error':
        parts.push(`Error: ${event.detail || ''}`);
        break;
    }

    console.log(parts.join(' — '));

    this.listeners.forEach((listener) => {
      try { listener(full); } catch {}
    });
  }

  browserLaunch(detail?: string): void { this.emit({ type: 'browser_launch', detail }); }
  pageNavigate(step?: number, maxSteps?: number, url?: string): void { this.emit({ type: 'page_navigate', step, maxSteps, url }); }
  elementClick(step?: number, maxSteps?: number, target?: string, selector?: string, position?: { x: number; y: number }): void { this.emit({ type: 'element_click', step, maxSteps, target, selector, position }); }
  elementInput(step?: number, maxSteps?: number, target?: string, text?: string): void { this.emit({ type: 'element_input', step, maxSteps, target, action: text }); }
  scroll(step?: number, maxSteps?: number, direction?: string): void { this.emit({ type: 'scroll', step, maxSteps, action: direction }); }
  tabChange(step?: number, maxSteps?: number, detail?: string): void { this.emit({ type: 'tab_change', step, maxSteps, action: detail }); }
  extract(step?: number, maxSteps?: number, detail?: string): void { this.emit({ type: 'extract', step, maxSteps, detail }); }
  wait(step?: number, maxSteps?: number, detail?: string): void { this.emit({ type: 'wait', step, maxSteps, detail }); }
  aiDecision(step?: number, maxSteps?: number, goal?: string): void { this.emit({ type: 'ai_decision', step, maxSteps, action: goal }); }
  stepComplete(step?: number, maxSteps?: number, result?: string): void { this.emit({ type: 'step_complete', step, maxSteps, detail: result }); }
  taskComplete(success: boolean, steps?: number, detail?: string): void { this.emit({ type: 'task_complete', detail: `${success ? 'success' : 'failed'} in ${steps ?? '?'} steps — ${detail || ''}` }); }
  error(detail: string): void { this.emit({ type: 'error', detail }); }
}
