# Phase 2 Integration Guide

## Quick Start

### 1. Import Phase 2 Actions

The Phase 2 actions are automatically integrated into the main action executor. No additional imports needed in orchestrator.ts.

### 2. Using Phase 2 Actions in AI Decisions

Phase 2 actions can be used in AI decisions just like Phase 1 actions:

```json
{
  "action": [
    {
      "type": "upload_file",
      "ref": "e5",
      "filePath": "/path/to/document.pdf"
    },
    {
      "type": "select_option",
      "ref": "e10",
      "text": "United States"
    },
    {
      "type": "set_date",
      "ref": "e15",
      "date": "2024-01-15"
    },
    {
      "type": "drag_and_drop",
      "sourceRef": "e20",
      "targetRef": "e25"
    },
    {
      "type": "hover",
      "ref": "e30"
    },
    {
      "type": "right_click",
      "ref": "e35",
      "menuItemText": "Copy"
    }
  ]
}
```

### 3. Action Execution Flow

```
Orchestrator
  ↓
executeAction(actionName, args, page, session, logger)
  ↓
Switch on actionName
  ├─ Phase 1 actions (existing)
  └─ Phase 2 actions (new)
      ├─ upload_file → executeUploadFile()
      ├─ select_option → executeSelectOption()
      ├─ set_date → executeSetDate()
      ├─ drag_and_drop → executeDragAndDrop()
      ├─ hover → executeHover()
      └─ right_click → executeRightClick()
```

---

## Phase 2 Action Reference

### 2.1 File Upload

**Action Type:** `upload_file`

**Parameters:**
```typescript
{
  ref: string;              // File input element ref
  filePath?: string;        // Single file path
  filePaths?: string[];     // Multiple file paths
  waitForCompletion?: boolean; // Wait for upload (default: true)
}
```

**Example:**
```json
{
  "type": "upload_file",
  "ref": "e5",
  "filePath": "/path/to/document.pdf",
  "waitForCompletion": true
}
```

**Returns:**
```typescript
{
  success: boolean;
  message: string;
  uploadedFiles?: string[];
}
```

**Use Cases:**
- Form submissions with file attachments
- Document uploads
- Image uploads
- Resume/CV uploads
- Multi-file uploads

---

### 2.2 Select Option

**Action Type:** `select_option`

**Parameters:**
```typescript
{
  ref: string;      // Select/dropdown element ref
  value?: string;   // Option value
  text?: string;    // Option text
  index?: number;   // Option index
}
```

**Examples:**
```json
// By value
{
  "type": "select_option",
  "ref": "e10",
  "value": "us"
}

// By text
{
  "type": "select_option",
  "ref": "e10",
  "text": "United States"
}

// By index
{
  "type": "select_option",
  "ref": "e10",
  "index": 0
}
```

**Returns:**
```typescript
{
  success: boolean;
  message: string;
}
```

**Use Cases:**
- Country/region selection
- Category selection
- Dropdown menus
- Custom dropdowns
- Multi-select dropdowns

---

### 2.3 Set Date

**Action Type:** `set_date`

**Parameters:**
```typescript
{
  ref: string;                    // Date input element ref
  date: string;                   // Date string
  format?: 'iso' | 'us' | 'eu';  // Date format
}
```

**Examples:**
```json
// ISO format (YYYY-MM-DD)
{
  "type": "set_date",
  "ref": "e15",
  "date": "2024-01-15"
}

// US format (MM/DD/YYYY)
{
  "type": "set_date",
  "ref": "e15",
  "date": "01/15/2024",
  "format": "us"
}

// EU format (DD/MM/YYYY)
{
  "type": "set_date",
  "ref": "e15",
  "date": "15/01/2024",
  "format": "eu"
}
```

**Returns:**
```typescript
{
  success: boolean;
  message: string;
}
```

**Use Cases:**
- Booking date selection
- Event scheduling
- Birth date entry
- Appointment scheduling
- Date range selection

---

### 2.4 Drag and Drop

**Action Type:** `drag_and_drop`

**Parameters:**
```typescript
{
  sourceRef: string;              // Source element ref
  targetRef?: string;             // Target element ref
  targetCoordinates?: {           // Target coordinates
    x: number;
    y: number;
  };
}
```

**Examples:**
```json
// Element to element
{
  "type": "drag_and_drop",
  "sourceRef": "e20",
  "targetRef": "e25"
}

// Element to coordinates
{
  "type": "drag_and_drop",
  "sourceRef": "e20",
  "targetCoordinates": { "x": 100, "y": 200 }
}
```

**Returns:**
```typescript
{
  success: boolean;
  message: string;
}
```

**Use Cases:**
- Drag and drop file uploads
- Reordering list items
- Kanban board interactions
- Drag to sort
- Drag to organize

---

### 2.5 Hover

**Action Type:** `hover`

**Parameters:**
```typescript
{
  ref: string;      // Element ref
  chain?: string[]; // Hover chain refs (for nested menus)
}
```

**Examples:**
```json
// Single hover
{
  "type": "hover",
  "ref": "e30"
}

// Hover chain (nested menus)
{
  "type": "hover",
  "ref": "e30",
  "chain": ["e31", "e32"]
}
```

**Returns:**
```typescript
{
  success: boolean;
  message: string;
  data?: {
    title: string;
    url: string;
    visibleElements: number;
  };
}
```

**Use Cases:**
- Revealing tooltips
- Opening dropdown menus
- Nested menu navigation
- Hover-triggered content
- Mega menu navigation

---

### 2.6 Right-Click

**Action Type:** `right_click`

**Parameters:**
```typescript
{
  ref: string;              // Element ref
  menuItemText?: string;    // Menu item text
  menuItemIndex?: number;   // Menu item index
}
```

**Examples:**
```json
// Right-click only
{
  "type": "right_click",
  "ref": "e35"
}

// Right-click and select by text
{
  "type": "right_click",
  "ref": "e35",
  "menuItemText": "Copy"
}

// Right-click and select by index
{
  "type": "right_click",
  "ref": "e35",
  "menuItemIndex": 0
}
```

**Returns:**
```typescript
{
  success: boolean;
  message: string;
  contextMenuItems?: Array<{
    ref: string;
    text: string;
    index: number;
  }>;
}
```

**Use Cases:**
- Context menu interactions
- Copy/paste operations
- Save as operations
- Delete confirmations
- Custom context menus

---

## Integration with Orchestrator

### 1. Action Execution

The orchestrator calls `executeAction()` with Phase 2 actions:

```typescript
const result = await executeAction(
  'upload_file',
  { ref: 'e5', filePath: '/path/to/file.pdf' },
  page,
  session,
  logger,
  step,
  maxSteps
);
```

### 2. Error Handling

Phase 2 actions follow the same error handling pattern as Phase 1:

```typescript
if (!result.success) {
  logger.error(step, maxSteps, result.message);
  // Retry or fallback strategy
}
```

### 3. Logging

All Phase 2 actions log their execution:

```
[Navis] File upload: 1 file(s) selected
[Navis] Selected option: United States
[Navis] Set date to 2024-01-15
[Navis] Dragged element e20 to e25
[Navis] Hovered over element: e30
[Navis] Right-clicked element: e35
```

---

## Element Capture Integration

Phase 2 actions work with elements captured by Element_Capture:

1. **Element Capture** identifies interactive elements and assigns refs (e1, e2, etc.)
2. **Phase 2 Actions** use these refs to locate and interact with elements
3. **Element Validation** ensures elements are visible and enabled before interaction

### Example Flow

```
1. Element_Capture finds file input: ref="e5"
2. AI decides to upload file
3. executeAction('upload_file', { ref: 'e5', filePath: '...' })
4. Action locates element using ref
5. Action validates element is visible
6. Action sets files on input
7. Action waits for completion
8. Returns success/failure
```

---

## Session Integration

Phase 2 actions use BrowserSession for:

1. **Cursor Movement** - `session.moveCursor(x, y)`
2. **Element Highlighting** - `session.highlightElement(box)`
3. **Overlay Status** - `session.setOverlayStatus(message)`
4. **Page Management** - `session.setActivePage(page)`

### Example

```typescript
// Move cursor to element
const box = await locator.boundingBox();
if (box) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await session.moveCursor(centerX, centerY);
}

// Highlight element
await session.highlightElement(box);

// Update overlay status
await session.setOverlayStatus('Uploading file...');
```

---

## Logger Integration

Phase 2 actions use NavisLogger for:

1. **Info Logging** - `logger.info(step, maxSteps, message)`
2. **Warning Logging** - `logger.warn(step, maxSteps, message)`
3. **Error Logging** - `logger.error(step, maxSteps, message)`

### Example

```typescript
logger.info(step, maxSteps, 'File upload: 1 file(s) selected');
logger.warn(step, maxSteps, 'Upload completion indicators not detected');
logger.error(step, maxSteps, 'File not found: /path/to/file');
```

---

## Testing Phase 2 Actions

### Unit Tests

Run Phase 2 unit tests:

```bash
npm test -- main/agent/tools/navis/__tests__/phase2-actions.test.ts --run
```

### Integration Tests

Test Phase 2 actions with real browser:

```typescript
import { chromium } from 'playwright';
import { BrowserSession } from './session';
import { executeUploadFile } from './phase2-actions';

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const session = new BrowserSession(context);

const result = await executeUploadFile(
  { ref: 'e5', filePath: '/path/to/file.pdf' },
  page,
  session
);

console.log(result);
```

---

## Performance Considerations

### Action Timing

- **File Upload**: 200-700ms
- **Dropdown Selection**: 150-300ms
- **Date Picker**: 120-250ms
- **Drag and Drop**: 700-1000ms
- **Hover**: 600-700ms
- **Right-Click**: 500-700ms

### Optimization Tips

1. **Batch Actions**: Group independent actions together
2. **Parallel Processing**: Use Promise.all() for independent actions
3. **Caching**: Reuse element snapshots within 500ms window
4. **Prefetching**: Start element capture during navigation

---

## Common Patterns

### Form Submission with File Upload

```json
{
  "action": [
    {
      "type": "input_text",
      "ref": "e1",
      "text": "John Doe"
    },
    {
      "type": "select_option",
      "ref": "e5",
      "text": "United States"
    },
    {
      "type": "set_date",
      "ref": "e10",
      "date": "1990-01-15"
    },
    {
      "type": "upload_file",
      "ref": "e15",
      "filePath": "/path/to/resume.pdf"
    },
    {
      "type": "click_element",
      "ref": "e20"
    }
  ]
}
```

### Nested Menu Navigation

```json
{
  "action": [
    {
      "type": "hover",
      "ref": "e1",
      "chain": ["e2", "e3"]
    },
    {
      "type": "click_element",
      "ref": "e4"
    }
  ]
}
```

### Drag and Drop Reordering

```json
{
  "action": [
    {
      "type": "drag_and_drop",
      "sourceRef": "e1",
      "targetRef": "e2"
    },
    {
      "type": "drag_and_drop",
      "sourceRef": "e3",
      "targetRef": "e4"
    }
  ]
}
```

### Context Menu Interaction

```json
{
  "action": [
    {
      "type": "right_click",
      "ref": "e1",
      "menuItemText": "Delete"
    }
  ]
}
```

---

## Troubleshooting

### File Upload Not Working

1. **Check file path**: Ensure file exists at specified path
2. **Check element**: Verify file input element is found
3. **Check permissions**: Ensure file is readable
4. **Check completion**: Verify upload completion indicators

### Dropdown Selection Failing

1. **Check element**: Verify dropdown element is found
2. **Check option**: Verify option exists in dropdown
3. **Check visibility**: Ensure dropdown is visible
4. **Check custom**: Verify if dropdown is custom or native

### Date Picker Not Setting

1. **Check format**: Verify date format is correct
2. **Check element**: Verify date input element is found
3. **Check type**: Verify if date picker is native or custom
4. **Check events**: Verify change/blur events are triggered

### Drag and Drop Not Working

1. **Check elements**: Verify source and target elements exist
2. **Check coordinates**: Verify target coordinates are valid
3. **Check animations**: Verify drag animations complete
4. **Check state**: Verify drop zone state changes

### Hover Not Revealing Content

1. **Check element**: Verify element is found
2. **Check wait time**: Verify 500ms wait is sufficient
3. **Check visibility**: Verify revealed content is visible
4. **Check chain**: Verify hover chain is correct

### Right-Click Not Working

1. **Check element**: Verify element is found
2. **Check menu**: Verify context menu appears
3. **Check items**: Verify menu items are captured
4. **Check selection**: Verify menu item is found

---

## Next Steps

Phase 2 provides advanced form interaction capabilities. Next phases will add:

- **Phase 3**: Complex DOM Handling (iframes, shadow DOM)
- **Phase 4**: Session and Authentication Management
- **Phase 5**: Advanced Protection and Robustness
- **Phase 6**: Session Recording and Intelligent Waiting
- **Phase 7**: SPA and Dynamic Content Handling
- **Phase 8**: Responsive and Network Handling
- **Phase 9**: Error Recovery and Developer Experience
- **Phase 10**: Configuration and Extensibility

---

## Support

For issues or questions about Phase 2 actions:

1. Check the PHASE2_IMPLEMENTATION.md for detailed documentation
2. Review the phase2-actions.test.ts for usage examples
3. Check the error messages for troubleshooting hints
4. Review the logs for detailed execution information
