# Quick Start - Multi-Agent Frontend Integration

## 🎯 What's Ready

The EverFern chat UI now has full support for displaying real-time multi-agent coding system progress. All components are integrated and waiting for backend event emission.

---

## 🚀 For Backend Developers

### 1. Understand the Event Structure
```typescript
// Event format that frontend expects
{
  type: 'subagent_event',
  subagentEventType: 'phase_start' | 'phase_update' | 'phase_complete' | 'phase_error' | 'coordination_update',
  agent: string,        // Must match: exploration_agent, planning_agent, worker_agent, code_reviewer_agent, test_runner_agent
  phase?: string,       // Phase name
  data?: {
    description?: string,
    output?: string,
    metrics?: Record<string, any>,
    error?: string
  }
}
```

### 2. Emit Events in Your Code
```typescript
// In coding-specialist.ts or any subagent:

// When phase starts
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_start',
  agent: 'exploration_agent',
  phase: 'exploration',
  data: { description: 'Analyzing codebase structure...' }
});

// During phase execution (optionally, every 1-5 seconds)
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_update',
  agent: 'exploration_agent',
  data: {
    output: 'Found 42 files, analyzing dependencies...',
    metrics: { filesAnalyzed: 42, dependenciesFound: 15 }
  }
});

// When phase completes
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_complete',
  agent: 'exploration_agent',
  data: {
    output: 'Exploration complete: 42 files, 15 dependencies',
    metrics: { filesAnalyzed: 42, dependenciesFound: 15, durationMs: 2500 }
  }
});

// On phase error
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'phase_error',
  agent: 'exploration_agent',
  data: {
    error: 'Failed to analyze directory: Permission denied',
    output: 'Analyzed 15 of 42 files before error'
  }
});

// When moving to next phase
eventQueue?.push({
  type: 'subagent_event',
  subagentEventType: 'coordination_update',
  data: {
    phase: 'planning',
    currentAgent: 'planning_agent',
    completedPhases: ['exploration'],
    sharedContext: { codebaseMap: { /* ... */ } }
  }
});
```

### 3. Agent Names (MUST match these exactly)
```typescript
const AGENTS_META = {
  exploration_agent: { icon: Eye, label: 'Exploration', color: '#3b82f6' },
  planning_agent: { icon: FileText, label: 'Planning', color: '#3b82f6' },
  worker_agent: { icon: Code, label: 'Implementation', color: '#22c55e' },
  code_reviewer_agent: { icon: CheckCircle, label: 'Review', color: '#f59e0b' },
  test_runner_agent: { icon: TestTube, label: 'Testing', color: '#8b5cf6' },
};
```

### 4. Test Your Events
```typescript
// Add this to your debugging
console.log('[Subagent Event] Emitting:', {
  type: 'subagent_event',
  subagentEventType: 'phase_start',
  agent: 'exploration_agent'
});

// Check browser console for:
// "[Frontend] 🤖 Subagent event received: phase_start exploration_agent"
```

---

## 🎨 For Frontend Developers

### 1. Components Are Ready to Use
All components are already integrated into the chat UI:
- `SubagentPanel` - Displays all 5 phases in real-time
- `ToolCallDetailPane` - Shows tool call details
- `useSubagentTracking` - Handles state management

### 2. No Code Changes Needed!
The integration is complete. Events from backend automatically:
- Trigger `api.onSubagentEvent()` handler
- Call `subagent.handleStreamEvent()`
- Update state in real-time
- Render updated UI automatically

### 3. Testing the UI
```typescript
// In browser console, you can monitor events:
window.__logSubagentEvents = true;

// You'll see logs like:
// "[Frontend] 🤖 Subagent event received: phase_start exploration_agent"
// "[Frontend] 🤖 Subagent event received: phase_update exploration_agent"
// "[Frontend] 🤖 Subagent event received: phase_complete exploration_agent"
```

### 4. UI Layout
The right sidebar now has:
```
┌─────────────────────────────────┐
│ [Agents] [Tool Details] Tabs   │  ← When subagent active
├─────────────────────────────────┤
│ SubagentPanel (5 phase cards)  │
│ - Real-time progress           │
│ - Status indicators            │
│ - Output/metrics               │
│ - Summary stats                │
└─────────────────────────────────┘

OR (when not in use)

┌─────────────────────────────────┐
│ Instructions Card              │
├─────────────────────────────────┤
│ Scheduled Tasks                │
├─────────────────────────────────┤
│ Context                        │
├─────────────────────────────────┤
│ Execution Plan                 │
└─────────────────────────────────┘
```

---

## 📊 Visual Components

### SubagentPanel
Shows real-time progress of the 5-phase workflow:
```
Exploration Agent    [████████░░] In Progress   2.3s
Planning Agent       [████████░░] In Progress   1.8s
Implementation Agent [░░░░░░░░░░] Pending      -
Code Reviewer Agent  [░░░░░░░░░░] Pending      -
Test Runner Agent    [░░░░░░░░░░] Pending      -

Stats: 0 completed • 2 running • 0 failed
```

### ToolCallDetailPane
Shows details of a specific tool call:
```
[Input] [Output] [Timeline]

Tool: read_file
Status: Completed (1.2s)
Time: 2:45:30 PM

Arguments: { path: "/src/app.ts" }
Result: { content: "...", size: 1024 }
```

---

## 🔍 Debug Commands

Open browser DevTools console and run:

```javascript
// Check if subagent hook is active
const chatPage = document.querySelector('[data-chatpage]');
console.log('Subagent active:', window.__subagentState?.isActive);

// View current phases
console.log('Phases:', window.__subagentState?.phases);

// View coordination state
console.log('Coordination:', window.__subagentState?.coordination);

// Enable event logging
window.__logSubagentEvents = true;

// Check for errors
console.log(document.querySelector('.text-red-500'));
```

---

## 🧪 Testing Checklist

### Frontend Testing
- [ ] Start a new chat
- [ ] Observe subagent panel appears when events arrive
- [ ] Verify phases display correctly
- [ ] Check status indicators update in real-time
- [ ] Confirm metrics display correctly
- [ ] Test tab switcher between Agents/Tool Details
- [ ] Verify UI hides when conversation ends
- [ ] Test responsive layout on different screen sizes

### Backend Testing
- [ ] Verify event emission through eventQueue
- [ ] Check agent names match AGENTS_META keys
- [ ] Confirm event sequencing is correct
- [ ] Test with all 5 phases
- [ ] Verify metrics data structure
- [ ] Test error event handling
- [ ] Monitor performance with rapid events

### Integration Testing
- [ ] Events flow from backend → frontend
- [ ] UI updates match event data
- [ ] State resets properly on new chat
- [ ] No console errors or warnings
- [ ] Performance remains smooth
- [ ] Works across different browser tabs

---

## 📁 Key Files

### Frontend (Already Integrated)
- `src/app/chat/page.tsx` - Main chat, has all integration
- `src/app/chat/components/SubagentPanel.tsx` - Phase display
- `src/app/chat/components/ToolCallDetailPane.tsx` - Tool details
- `src/hooks/useSubagentTracking.ts` - State management

### Backend (To Be Implemented)
- `main/agent/runner/agents/coding-specialist.ts` - Emit events here
- `main/agent/runner/services/agent-runtime.ts` - Route events through eventQueue
- `main/agent/runner/agents/coding-assistant/subagents/*.ts` - Emit from subagents

### Documentation
- `SUBAGENT_EVENT_EMISSION.md` - Event spec and examples
- `FRONTEND_INTEGRATION_GUIDE.md` - Component usage
- `MULTI_AGENT_ARCHITECTURE.md` - System design

---

## 🎯 Success Criteria

✅ Event properly emitted from backend
✅ Frontend receives event in `api.onSubagentEvent()`
✅ Phase state updates in real-time
✅ SubagentPanel displays updated phases
✅ Status indicators show progress
✅ Metrics display correctly
✅ UI is responsive and smooth
✅ No console errors

---

## ⚡ Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Panel not showing | Events not emitted | Check backend is emitting events |
| Phases not updating | Agent name mismatch | Verify agent name in AGENTS_META |
| Stale data | Old conversation state | Call `subagent.reset()` on new chat |
| Slow updates | Too many events/second | Batch updates every 1-5 seconds |
| Type errors | TypeScript mismatch | Use exact event structure |

---

## 📞 Need Help?

### Documentation
1. **Event structure**: See `SUBAGENT_EVENT_EMISSION.md`
2. **Component usage**: See `FRONTEND_INTEGRATION_GUIDE.md`
3. **System design**: See `MULTI_AGENT_ARCHITECTURE.md`
4. **Troubleshooting**: See `SUBAGENT_FRONTEND_INTEGRATION_COMPLETE.md`

### Code References
- Component implementations have inline documentation
- TypeScript interfaces provide type guidance
- Hook has JSDoc comments explaining each function

---

## 🎉 You're Ready!

The frontend is **fully ready** for real-time multi-agent visualization. Just start emitting events from the backend and watch the magic happen in the UI.

**Next Step**: Implement event emission in your backend code! 🚀

---

*Last Updated: June 2, 2026*
*Status: Ready for Backend Integration ✅*
