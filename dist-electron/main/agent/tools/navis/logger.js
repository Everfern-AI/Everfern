"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NavisLogger = void 0;
class NavisLogger {
    listeners = new Set();
    on(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(event) {
        const full = { ...event, timestamp: Date.now() };
        const parts = [];
        if (event.step !== undefined && event.maxSteps !== undefined) {
            parts.push(`[Navis] Step ${event.step}/${event.maxSteps}`);
        }
        else {
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
            try {
                listener(full);
            }
            catch { }
        });
    }
    browserLaunch(detail) { this.emit({ type: 'browser_launch', detail }); }
    pageNavigate(step, maxSteps, url) { this.emit({ type: 'page_navigate', step, maxSteps, url }); }
    elementClick(step, maxSteps, target, selector, position) { this.emit({ type: 'element_click', step, maxSteps, target, selector, position }); }
    elementInput(step, maxSteps, target, text, position) { this.emit({ type: 'element_input', step, maxSteps, target, action: text, position }); }
    scroll(step, maxSteps, direction) { this.emit({ type: 'scroll', step, maxSteps, action: direction }); }
    tabChange(step, maxSteps, detail) { this.emit({ type: 'tab_change', step, maxSteps, action: detail }); }
    extract(step, maxSteps, detail) { this.emit({ type: 'extract', step, maxSteps, detail }); }
    wait(step, maxSteps, detail) { this.emit({ type: 'wait', step, maxSteps, detail }); }
    aiDecision(step, maxSteps, goal) { this.emit({ type: 'ai_decision', step, maxSteps, action: goal }); }
    stepComplete(step, maxSteps, result) { this.emit({ type: 'step_complete', step, maxSteps, detail: result }); }
    screenshot(step, maxSteps, base64) { this.emit({ type: 'screenshot', step, maxSteps, base64 }); }
    taskComplete(success, steps, detail) { this.emit({ type: 'task_complete', detail: `${success ? 'success' : 'failed'} in ${steps ?? '?'} steps — ${detail || ''}` }); }
    error(detail) { this.emit({ type: 'error', detail }); }
}
exports.NavisLogger = NavisLogger;
