# Visual Reference Guide - Multi-Agent UI Integration

## 🎨 Component Layout

### Main Chat View with Subagent Panel Active

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  EverFern Chat                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────┐  ┌──────────────────────────────┐ │
│  │                                     │  │  [Agents] [Tool Details]      │ │
│  │    Main Chat Area                   │  ├──────────────────────────────┤ │
│  │                                     │  │                              │ │
│  │  User: Help me refactor this code  │  │  🤖 Multi-Agent Development  │ │
│  │                                     │  │  ├─ Completed: 1             │ │
│  │  AI: I'll help you refactor...     │  │  ├─ In Progress: 2           │ │
│  │                                     │  │  └─ Failed: 0               │ │
│  │  [read_file] [create_plan]         │  │                              │ │
│  │                                     │  │  ┌────────────────────────┐  │ │
│  │  [execute_tools] [write_file]      │  │  │ 🔍 Exploration         │  │ │
│  │                                     │  │  │ [████████░░] Complete  │  │ │
│  │                                     │  │  │ 2.3s                   │  │ │
│  │  Currently executing:              │  │  │                        │  │ │
│  │  - Reading source files            │  │  │ Output: Found 42 files │  │ │
│  │  - Analyzing dependencies          │  │  │ Metrics:               │  │ │
│  │  - Building execution plan         │  │  │ ├─ Files: 42          │  │ │
│  │                                     │  │  │ └─ Deps: 15           │  │ │
│  │                                     │  │  └────────────────────────┘  │ │
│  │                                     │  │  ┌────────────────────────┐  │ │
│  │                                     │  │  │ 📝 Planning            │  │ │
│  │                                     │  │  │ [████░░░░░░] Progress  │  │ │
│  │                                     │  │  │ 1.8s                   │  │ │
│  │                                     │  │  │ Output: ...            │  │ │
│  │                                     │  │  └────────────────────────┘  │ │
│  │                                     │  │  ┌────────────────────────┐  │ │
│  │                                     │  │  │ 💻 Implementation      │  │ │
│  │                                     │  │  │ [░░░░░░░░░░] Pending   │  │ │
│  │                                     │  │  │ Waiting...             │  │ │
│  │                                     │  │  └────────────────────────┘  │ │
│  │                                     │  │  ┌────────────────────────┐  │ │
│  │                                     │  │  │ ✅ Review              │  │ │
│  │                                     │  │  │ [░░░░░░░░░░] Pending   │  │ │
│  │                                     │  │  │ Waiting...             │  │ │
│  │                                     │  │  └────────────────────────┘  │ │
│  │                                     │  │  ┌────────────────────────┐  │ │
│  │                                     │  │  │ 🧪 Testing             │  │ │
│  │                                     │  │  │ [░░░░░░░░░░] Pending   │  │ │
│  │                                     │  │  │ Waiting...             │  │ │
│  │                                     │  │  └────────────────────────┘  │ │
│  │                                     │  │                              │ │
│  │  Type your message...              │  │  Execution time: 4.1s        │ │
│  │                                     │  │                              │ │
│  └─────────────────────────────────────┘  └──────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📊 Phase Card States

### Phase Card - Pending
```
┌────────────────────────────────────┐
│ ● 🔍 Exploration                   │  ← Dot indicates pending
│   Analyze codebase                  │
└────────────────────────────────────┘
```

### Phase Card - In Progress
```
┌────────────────────────────────────┐
│ ● 🔍 Exploration                   │  ← Pulsing dot (animation)
│   Analyze codebase                  │
│ [████████░░░░░░░░░░░░] 45%         │
│                                    │
│ ▼ Output                           │  ← Expandable
│   Scanned 42 files...              │
│ ▼ Metrics                          │
│   Files: 42 | Dependencies: 15     │
└────────────────────────────────────┘
```

### Phase Card - Completed
```
┌────────────────────────────────────┐
│ ✅ 🔍 Exploration                  │  ← Checkmark
│   Analyze codebase                  │
│ [████████████████████] 100%  2.3s  │
│                                    │
│ ▼ Output                           │
│   Exploration complete: 42 files   │
│ ▼ Metrics                          │
│   Files: 42 | Deps: 15 | Time: 2.3s
└────────────────────────────────────┘
```

### Phase Card - Failed
```
┌────────────────────────────────────┐
│ ❌ 🔍 Exploration                  │  ← Error indicator
│   Analyze codebase                  │
│ [████████░░░░░░░░░░░░] ERROR 1.2s  │
│                                    │
│ ⚠️ Error                           │
│   Failed to analyze: Permission    │
│   denied on /src/private           │
└────────────────────────────────────┘
```

---

## 🔄 Agent Colors & Icons

```
┌──────────────────────────────────────────────────────────────┐
│ Agent Type        │ Color      │ Icon  │ Phase              │
├──────────────────────────────────────────────────────────────┤
│ Exploration       │ Blue       │ 🔍   │ Understand codebase│
│ Planning          │ Blue       │ 📝   │ Create strategy    │
│ Implementation    │ Green      │ 💻   │ Write code         │
│ Code Review       │ Orange     │ ✅   │ Check quality      │
│ Testing           │ Purple     │ 🧪   │ Validate solution  │
└──────────────────────────────────────────────────────────────┘
```

---

## 📈 SubagentPanel Stats Display

```
┌────────────────────────────────────┐
│ 🤖 Multi-Agent Development         │
├────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐
│ │Completed│ │ Running │ │ Failed  │
│ │    1    │ │    2    │ │    0    │
│ └─────────┘ └─────────┘ └─────────┘
└────────────────────────────────────┘
```

---

## 🔀 Tab Switcher

### When Subagent Panel Active
```
┌─────────────────────────────────────┐
│ [Agents] [Tool Details]             │  ← "Tool Details" shown
├─────────────────────────────────────┤
│ SubagentPanel displayed             │
└─────────────────────────────────────┘
```

### When Tool Details Selected
```
┌─────────────────────────────────────┐
│ [Agents] [Tool Details]             │  ← Both tabs visible
├─────────────────────────────────────┤
│ ToolCallDetailPane displayed        │
└─────────────────────────────────────┘
```

### When Subagent Inactive
```
(No tab switcher shown)

Instructions Card
Context Card
Scheduled Tasks Card
Execution Plan Card
```

---

## 📋 ToolCallDetailPane Layout

### Input Tab
```
┌────────────────────────────────────┐
│ [Input] [Output] [Timeline]        │
├────────────────────────────────────┤
│ Tool: read_file                    │
│ Status: Completed (1.2s)           │
│                                    │
│ Arguments:                         │
│ {                                  │
│   "path": "/src/app.ts",          │
│   "encoding": "utf-8"             │
│ }                                  │
│                                [Copy]
└────────────────────────────────────┘
```

### Output Tab
```
┌────────────────────────────────────┐
│ [Input] [Output] [Timeline]        │
├────────────────────────────────────┤
│ Tool: read_file                    │
│ Status: Completed (1.2s)           │
│                                    │
│ Result:                            │
│ {                                  │
│   "content": "import React...",    │
│   "size": 1024,                    │
│   "mtime": "2026-06-02..."         │
│ }                                  │
│                                [Copy]
└────────────────────────────────────┘
```

### Timeline Tab
```
┌────────────────────────────────────┐
│ [Input] [Output] [Timeline]        │
├────────────────────────────────────┤
│ ● Tool Called                      │
│   2:45:30 PM                       │
│ │                                  │
│ ├─ ● Executing                     │
│ │  2:45:30.6 PM                    │
│ │                                  │
│ └─ ● Completed                     │
│    2:45:31.8 PM                    │
└────────────────────────────────────┘
```

---

## 🎨 Color Scheme

```
Background Colors:
├─ Primary BG:       #fafafa (light beige)
├─ Card Surface:     #ffffff (white)
├─ Raised Surface:   #f5f5f4 (light gray)
└─ Border:           #e8e8e6 (light border)

Text Colors:
├─ Primary Text:     #141412 (dark)
├─ Secondary Text:   #6b6b67 (medium gray)
├─ Muted Text:       #a8a8a3 (light gray)
└─ Links/Accent:     #3b82f6 (blue)

Status Colors:
├─ Success:          #22c55e (green)
├─ Active:           #3b82f6 (blue)
├─ Warning:          #eab308 (yellow)
├─ Error:            #ef4444 (red)
└─ Orange:           #f59e0b (orange)

Phase Colors:
├─ Exploration:      #3b82f6 (blue)
├─ Planning:         #3b82f6 (blue)
├─ Implementation:   #22c55e (green)
├─ Review:           #f59e0b (orange)
└─ Testing:          #8b5cf6 (purple)
```

---

## 🎬 Animations

### Phase Progress Bar
```
[░░░░░░░░░░] Pending
[████░░░░░░] In Progress (animates)
[██████████] Completed (fills smoothly)
[████████░░] Failed (shows partial)
```

### Active Phase Indicator
```
The blue dot pulses when phase is in-progress:
● → ◐ → ◑ → ◕ → ● (repeating)
```

### Panel Transitions
```
When switching tabs or panels:
├─ Fade out (200ms)
└─ Fade in (200ms)
```

---

## 📐 Layout Dimensions

```
Desktop Layout:
├─ Sidebar:           260px (collapsible)
├─ Main Chat Area:    flex (remaining)
├─ Right Panel:       380px (fixed)
└─ Min Width:         1024px

Right Panel Sections:
├─ Tab Switcher:      Full width, 32px height
├─ Panel Content:     Full width, flex height
├─ Instructions:      Full width, collapsible
├─ Context:           Full width, collapsible
├─ Scheduled:         Full width, collapsible
└─ Execution Plan:    Full width, min-height 480px

Phase Card:
├─ Width:             340px
├─ Min Height:        64px
├─ Expanded Height:   200px+ (varies with content)
└─ Margin Bottom:     10px
```

---

## ✨ Responsive Breakpoints

```
Desktop (1024px+):
├─ Full layout (sidebar + chat + right panel)
├─ All components visible
└─ Optimal UX

Tablet (768px - 1023px):
├─ Sidebar collapses on interaction
├─ Chat area expands
├─ Right panel fits
└─ Adjusted padding

Mobile (< 768px):
├─ Not supported for this view
├─ Sidebar minimal
├─ Chat focused
└─ Right panel hidden or stacked
```

---

## 🔌 Integration Points Visual

```
Backend
  │
  ├─ eventQueue.push({
  │    type: 'subagent_event',
  │    subagentEventType: 'phase_start',
  │    agent: 'exploration_agent'
  │  })
  │
  ▼
Frontend Handler
  │
  ├─ api.onSubagentEvent()
  │
  ├─ subagent.handleStreamEvent()
  │
  ├─ setState(phases)
  │
  ▼
UI Update
  │
  ├─ SubagentPanel re-render
  │
  ├─ Phase card shows new status
  │
  ├─ Animation plays
  │
  ▼
User sees real-time progress
```

---

## 🎯 User Journey

### Initial View (No Execution)
```
Right Sidebar shows:
- Instructions card
- Context card
- Scheduled tasks card
- Execution plan card (if available)
```

### During Execution
```
Right Sidebar transforms to show:
- Tab switcher [Agents] [Tool Details]
- SubagentPanel with 5 phases
- Real-time status updates
- Metric tracking
```

### After Completion
```
Right Sidebar shows:
- Final phase results
- All metrics completed
- Summary statistics
- Option to view details or start new chat
```

---

## 📱 Accessibility Features

```
Visual Indicators:
├─ Color + Icon (not just color)
├─ Text labels for all states
├─ Sufficient color contrast
├─ Status descriptions in UI
└─ Clear call-to-action buttons

Keyboard Navigation:
├─ Tab between tabs
├─ Enter to expand/collapse
├─ Escape to close panels
└─ Arrow keys in lists

Screen Readers:
├─ ARIA labels on buttons
├─ Semantic HTML structure
├─ Status announcements
└─ Role attributes where needed
```

---

## 🖱️ Interaction States

### Button Hover States
```
Normal:  [Button Text]
Hover:   [Button Text] ← Slight background change
Press:   [Button Text] ← Slightly darker
```

### Card Hover States
```
Normal:  ┌─────────┐
         │ Content │
         └─────────┘

Hover:   ┌─────────┐
         │ Content │ ← Subtle shadow increase
         └─────────┘
```

### Expandable States
```
Collapsed:  ▶ Instructions
Hover:      ▶ Instructions (chevron highlight)
Expanded:   ▼ Instructions (content visible)
```

---

## 🎓 Learning Path

1. **View this guide** - Understand visual layout
2. **Review QUICK_START_INTEGRATION.md** - Get started
3. **Check component files** - See implementation
4. **Read SUBAGENT_EVENT_EMISSION.md** - Understand events
5. **Implement backend** - Start event emission

---

## 🎉 Summary

This visual reference shows:
- ✅ Component layout and hierarchy
- ✅ Color scheme and design tokens
- ✅ Animation and transitions
- ✅ Responsive design patterns
- ✅ User interaction flow
- ✅ Accessibility considerations

All visual elements are designed to work cohesively with the existing EverFern UI design system.

---

*Visual Reference Guide - Multi-Agent Frontend Integration*
*Last Updated: June 2, 2026*
