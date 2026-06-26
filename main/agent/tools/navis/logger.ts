export type NavisEventType =
  | 'browser_launch'
  | 'thinking'
  | 'page_navigate'
  | 'element_click'
  | 'element_input'
  | 'scroll'
  | 'tab_change'
  | 'extract'
  | 'wait'
  | 'ai_decision'
  | 'step_complete'
  | 'screenshot'
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
  /** Step key into the screenshot ring-buffer — use NavisLogger.getScreenshot(key) to retrieve */
  screenshotKey?: number;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

const MAX_SCREENSHOT_BUFFER = 40;

export class NavisLogger {
  private listeners: Set<(event: NavisEvent) => void> = new Set();
  /** Ring-buffer: key = step number → base64 string. Capped at MAX_SCREENSHOT_BUFFER entries. */
  private screenshotBuffer: Map<number, string> = new Map();
  private screenshotKeys: number[] = [];

  on(listener: (event: NavisEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Retrieve a screenshot by its step key.
   * Returns undefined if the key has been evicted from the ring-buffer.
   */
  getScreenshot(key: number): string | undefined {
    return this.screenshotBuffer.get(key);
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
      case 'thinking':
        parts.push(`Thinking → ${event.detail || event.action || ''}`);
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
      case 'screenshot':
        parts.push(`Screenshot captured${event.step !== undefined ? ` (Step ${event.step})` : ''}`);
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
  thinking(step?: number, maxSteps?: number, detail?: string, metadata?: Record<string, unknown>): void { this.emit({ type: 'thinking', step, maxSteps, detail, metadata }); }
  pageNavigate(step?: number, maxSteps?: number, url?: string): void { this.emit({ type: 'page_navigate', step, maxSteps, url }); }
  elementClick(step?: number, maxSteps?: number, target?: string, selector?: string, position?: { x: number; y: number }): void { this.emit({ type: 'element_click', step, maxSteps, target, selector, position }); }
  elementInput(step?: number, maxSteps?: number, target?: string, text?: string, position?: { x: number; y: number }): void { this.emit({ type: 'element_input', step, maxSteps, target, action: text, position }); }
  scroll(step?: number, maxSteps?: number, direction?: string): void { this.emit({ type: 'scroll', step, maxSteps, action: direction }); }
  tabChange(step?: number, maxSteps?: number, detail?: string): void { this.emit({ type: 'tab_change', step, maxSteps, action: detail }); }
  extract(step?: number, maxSteps?: number, detail?: string): void { this.emit({ type: 'extract', step, maxSteps, detail }); }
  wait(step?: number, maxSteps?: number, detail?: string): void { this.emit({ type: 'wait', step, maxSteps, detail }); }
  aiDecision(step?: number, maxSteps?: number, goal?: string): void { this.emit({ type: 'ai_decision', step, maxSteps, action: goal }); }
  stepComplete(step?: number, maxSteps?: number, result?: string): void { this.emit({ type: 'step_complete', step, maxSteps, detail: result }); }
  taskComplete(success: boolean, steps?: number, detail?: string): void { this.emit({ type: 'task_complete', detail: `${success ? 'success' : 'failed'} in ${steps ?? '?'} steps — ${detail || ''}` }); }
  error(detail: string): void { this.emit({ type: 'error', detail }); }

  /**
   * Store screenshot in ring-buffer and emit an event with only the key.
   * Avoids embedding large base64 strings in every listener's event copy.
   */
  screenshot(step?: number, maxSteps?: number, base64?: string): void {
    const key = step ?? Date.now();
    if (base64) {
      this.screenshotBuffer.set(key, base64);
      this.screenshotKeys.push(key);
      // Evict oldest when over capacity
      while (this.screenshotKeys.length > MAX_SCREENSHOT_BUFFER) {
        const evicted = this.screenshotKeys.shift()!;
        this.screenshotBuffer.delete(evicted);
      }
    }
    this.emit({ type: 'screenshot', step, maxSteps, screenshotKey: key });
  }
}
