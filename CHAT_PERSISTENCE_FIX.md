# Chat Message Persistence Fix

## Problem

When restarting the EverFern app, only the **last message** of the chat was displayed instead of the full conversation history.

## Root Cause

The bug was in how messages were being saved during the agent execution:

1. **Initial State**: User sends message → Agent starts running
   - DB has: 1 user message

2. **Real-time Sync**: Every 2 seconds during agent thinking, `syncToDb()` is called
   - `runner.ts` calls `chatHistoryStore.save()` with ONLY the current assistant message
   - DB should have: 1 user message + 1 assistant message (updated)
   - **BUT**: `history.ts` `save()` function has cleanup logic that deletes ALL messages NOT in the current save
   - Result: DB now has ONLY 1 assistant message (user message was DELETED!)

3. **More Real-time Syncs**: Agent continues thinking and syncing
   - Each sync adds only the current assistant message
   - Cleanup logic runs again
   - All previous messages get deleted

4. **App Restart**: Frontend loads conversations from DB
   - DB contains only the LAST assistant message (all others were deleted)
   - UI displays only 1 message

### The Problematic Code

**File**: `main/store/history.ts` - `save()` function

```typescript
// OLD CODE - Cleanup runs on EVERY save, including partial saves
if (savedIds.length > 0) {
  const placeholders = savedIds.map(() => '?').join(',');
  await dbOps.run(
    `DELETE FROM messages
     WHERE conversation_id = ? AND id NOT IN (${placeholders})`,
    [conversation.id, ...savedIds]
  );
}
```

**File**: `main/agent/runner/runner.ts` - `syncToDb()` function

```typescript
// OLD CODE - Saves ONLY current assistant message every 2 seconds
const syncToDb = async (force = false) => {
  // ... timing checks ...
  await chatHistoryStore.save({
    id: convId,
    messages: [
      {
        id: currentAssistantMsgId,
        role: 'assistant',
        content: currentContent,
        thought: currentThought,
        toolCalls: currentToolCalls,
        missionTimeline: missionTracker.getTimeline(),
      }
    ] as any,
    updatedAt: new Date().toISOString()
  } as any);
};
```

## Solution

Added a flag `isFullSave` to distinguish between:
- **Full saves**: Frontend saving entire conversation (should cleanup)
- **Partial saves**: Agent syncing current response (should NOT cleanup)

### Changes Made

#### 1. Modified `main/store/history.ts`

Added conditional cleanup logic:

```typescript
// NEW CODE - Only cleanup if NOT a partial save
if ((conversation as any).isFullSave !== false && savedIds.length > 0) {
  const placeholders = savedIds.map(() => '?').join(',');
  await dbOps.run(
    `DELETE FROM messages
     WHERE conversation_id = ? AND id NOT IN (${placeholders})`,
    [conversation.id, ...savedIds]
  );
} else if ((conversation as any).isFullSave !== false) {
  await dbOps.run(
    'DELETE FROM messages WHERE conversation_id = ?',
    [conversation.id]
  );
}
```

**Logic**:
- `isFullSave !== false` means: cleanup if true OR undefined (default for full saves)
- `isFullSave === false` means: NO cleanup (partial save)

#### 2. Modified `main/agent/runner/runner.ts`

Marked real-time syncs as partial saves:

```typescript
// NEW CODE - Mark as partial save to prevent message deletion
const syncToDb = async (force = false) => {
  // ... existing logic ...
  await chatHistoryStore.save({
    id: convId,
    messages: [
      {
        id: currentAssistantMsgId,
        role: 'assistant',
        content: currentContent,
        thought: currentThought,
        toolCalls: currentToolCalls,
        missionTimeline: missionTracker.getTimeline(),
      }
    ] as any,
    isFullSave: false, // ← NEW: Prevents deletion of other messages
    updatedAt: new Date().toISOString()
  } as any);
};
```

## How It Works Now

1. **Initial Save** (First user message):
   - `isFullSave` is undefined → defaults to full save behavior
   - Cleanup runs (fine, only 1 message exists anyway)

2. **Real-time Syncs** (Agent thinking):
   - `isFullSave: false` is set
   - Cleanup is SKIPPED
   - Current assistant message is upserted (INSERT OR REPLACE)
   - Previous messages are PRESERVED

3. **Full Frontend Save** (User adds message or conversation ends):
   - Frontend sends ALL messages
   - `isFullSave` is undefined (not set by frontend)
   - Cleanup runs (correct behavior - removes any messages not in the full list)

4. **App Restart**:
   - Loads ALL messages from DB
   - Full conversation is restored ✓

## Files Changed

1. `main/store/history.ts` - Added conditional cleanup logic
2. `main/agent/runner/runner.ts` - Added `isFullSave: false` flag to partial saves
3. `main/store/__tests__/chat-persistence-fix.test.ts` - NEW test file with 3 test cases

## Test Cases

The fix includes comprehensive tests in `chat-persistence-fix.test.ts`:

### Test 1: Partial Saves Don't Delete Messages
- Creates 2-message conversation
- Does partial save with `isFullSave: false`
- Verifies BOTH messages are preserved ✓

### Test 2: Full Saves DO Delete Unspecified Messages
- Creates 3-message conversation
- Does full save with only 2 messages
- Verifies 3rd message was deleted (expected behavior) ✓

### Test 3: App Restart Simulation
- Simulates realistic multi-turn conversation
- Multiple real-time syncs with partial saves
- Verifies all messages survive until app restart ✓

## Backward Compatibility

- **Fully backward compatible**: `isFullSave` defaults to true (full save behavior)
- No changes needed to existing code that doesn't use the flag
- Frontend code continues to work as-is

## Performance Impact

- **Minimal**: The cleanup check is just a boolean comparison
- Real-time syncs are now FASTER since they skip cleanup
- No database query changes

## Verification

To verify the fix works:

1. Build the desktop app
2. Start a conversation
3. Wait for agent to run (you'll see real-time message updates)
4. Restart the app
5. Open the same conversation
6. **Expected**: Full conversation history is displayed (not just last message)

## Testing

Run the test suite:

```bash
npm test -- main/store/__tests__/chat-persistence-fix.test.ts
```

Expected output: All 3 tests pass ✓
