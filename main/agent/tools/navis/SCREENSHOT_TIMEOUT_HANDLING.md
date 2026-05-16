# Screenshot Timeout Handling in Navis

## Problem
When Navis vision mode encounters a screenshot timeout (page unresponsive for >30 seconds), it would throw an error and stop execution, returning nothing to the main agent about what happened.

## Solution
Implemented graceful timeout handling that:

1. **Detects timeout errors** - Checks if the error message contains "timed out" or "Timeout"
2. **Captures current state** - Gets the element snapshot without screenshot to understand page state
3. **Asks AI to assess** - Calls the AI to analyze what happened and provide context
4. **Returns gracefully** - Returns a structured response to the main agent with:
   - Assessment of current page state
   - Explanation of why timeout occurred
   - Suggestions for next steps

## Implementation Details

### Location
`main/agent/tools/navis/orchestrator.ts` - Vision mode screenshot capture section

### Flow
```
Screenshot attempt
    ↓
Timeout error caught
    ↓
Is it a timeout? → Yes
    ↓
Capture elements (no screenshot)
    ↓
Ask AI to assess current state
    ↓
Return graceful response with assessment
    ↓
Main agent receives structured error info
```

### AI Assessment Prompt
When timeout occurs, Navis asks the AI:
1. What is the current state of the page?
2. What was the last action attempted?
3. What should the user know about what happened?

### Response Format
```json
{
  "success": false,
  "output": "Screenshot Timeout: [AI Assessment]\n\nThe page at [URL] did not respond...",
  "steps": [number]
}
```

## Benefits
- ✅ Main agent receives meaningful feedback instead of generic error
- ✅ AI provides context about page state when timeout occurs
- ✅ User understands why the task stopped
- ✅ Graceful degradation - doesn't crash the entire system
- ✅ Allows main agent to decide next steps based on assessment

## Error Handling
- If AI assessment fails, returns basic timeout message
- Non-timeout errors still throw to stop execution (as intended)
- Overlay is always restored even if assessment fails
- Annotations are cleaned up properly

## Testing
To test this behavior:
1. Navigate to a page with heavy JavaScript or slow server
2. Run Navis with vision mode enabled
3. Observe that timeout is caught and AI assessment is returned
4. Main agent receives structured response with assessment
