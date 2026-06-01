# Chat Memory Persistence System - Type Definitions

This directory contains the TypeScript data model interfaces for the chat memory and persistence system.

## Overview

The type system is designed to ensure type safety across:
- Database operations (SQLite)
- Vector storage (sqlite-vec)
- UI components (React)
- API boundaries (IPC)

## Core Types

### Message Types

#### `ChatMessage`
The primary interface for individual chat messages. Contains all metadata including:
- **Required fields**: `id`, `role`, `content`, `hasTimeline`, `orderIndex`, `stopped`, `createdAt`
- **Optional fields**: `thought`, `reasoning_content`, `toolCalls`, `missionTimeline`, `thinkingDuration`, `attachments`

**Database Mapping:**
```sql
messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT,
  thought TEXT,
  reasoning_content TEXT,
  tool_calls TEXT, -- JSON string
  mission_timeline TEXT, -- JSON string
  has_timeline BOOLEAN DEFAULT 0,
  order_index INTEGER DEFAULT 0,
  thinking_duration INTEGER,
  stopped BOOLEAN DEFAULT 0,
  attachments TEXT, -- JSON string
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `ToolCall`
Represents a tool invocation within a message:
- Tool name and arguments
- Execution result and status
- Order index for multiple tool calls
- Timestamp and error information

#### `Attachment`
File or media attachments:
- Supports images, files, audio, video
- Includes metadata like size, MIME type, thumbnails

### Conversation Types

#### `Conversation`
Complete conversation with all messages:
- Unique ID and title
- Array of `ChatMessage` objects
- Provider and model information
- Project association
- Created/updated timestamps

**Database Mapping:**
```sql
conversations (
  id TEXT PRIMARY KEY,
  title TEXT,
  provider TEXT,
  model TEXT,
  project_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### `ConversationSummary`
Lightweight summary for list views:
- Essential metadata without messages
- Message count for display
- Used for efficient conversation listing

### Vector Storage Types

#### `SearchResult`
Result from semantic similarity search:
- Message content and metadata
- Similarity score (0.0 to 1.0)
- Used for context retrieval

#### `VectorStats`
Diagnostic information about vector store:
- Message count and dimensions
- Storage size and initialization status
- Error information if applicable

### Health Check Types

#### `HealthCheckResult`
Result of component health validation:
- Boolean healthy status
- Human-readable message
- Detailed diagnostics object

#### `CheckResult`
Individual check with timing:
- Component identifier
- Pass/fail status
- Duration in milliseconds

#### `PreFlightResult`
Complete pre-flight check results:
- Overall pass/fail status
- Array of individual check results
- Whether application can proceed

### Parser/Serializer Types

#### `ParseResult<T>`
Generic result of parsing operations:
- Success boolean
- Parsed data (if successful)
- Error with message and location (if failed)

#### `DatabaseOperationResult`
Result of database operations:
- Success boolean
- Error message (if failed)

### Pagination Types

#### `PaginationParams`
Parameters for paginated queries:
- Page number (0-indexed)
- Page size

#### `PaginatedResult<T>`
Paginated result set:
- Items array
- Total count and page info
- Navigation flags (hasNextPage, hasPreviousPage)

## Type Safety Guarantees

### Required vs Optional Fields

The type system enforces strict requirements:

**Always Required:**
- `ChatMessage.id` - Unique identifier
- `ChatMessage.role` - Message sender role
- `ChatMessage.content` - Message content
- `ChatMessage.hasTimeline` - Timeline flag
- `ChatMessage.orderIndex` - Sort order
- `ChatMessage.stopped` - Stop flag
- `ChatMessage.createdAt` - Timestamp with millisecond precision

**Optional but Important:**
- `ChatMessage.toolCalls` - Only present when tools are used
- `ChatMessage.attachments` - Only present when files are attached
- `ChatMessage.thought` - Internal reasoning (assistant only)

### Timestamp Precision

All timestamps use ISO 8601 format with millisecond precision:
```typescript
createdAt: "2025-01-15T10:30:00.123Z"
```

This satisfies **Requirement 7.5** (Timestamp Precision).

### Session Isolation

The type system enforces session isolation through:
- Unique `Conversation.id` for each session
- Foreign key constraints in database schema
- Type-safe query methods that require session ID

This satisfies **Requirement 1.1** (Chat Session Isolation).

## Usage Examples

### Creating a New Message

```typescript
import { ChatMessage } from './chat-memory-types';

const message: ChatMessage = {
  id: 'msg-123',
  role: 'user',
  content: 'Hello, how can you help me?',
  hasTimeline: false,
  orderIndex: 0,
  stopped: false,
  createdAt: new Date().toISOString()
};
```

### Parsing Search Results

```typescript
import { SearchResult } from './chat-memory-types';

function processSearchResults(results: SearchResult[]): ChatMessage[] {
  return results
    .filter(r => r.similarity > 0.7) // Threshold filtering
    .map(r => ({
      id: r.id,
      role: r.role as MessageRole,
      content: r.content,
      hasTimeline: false,
      orderIndex: 0,
      stopped: false,
      createdAt: new Date(r.createdAt).toISOString()
    }));
}
```

### Health Check Implementation

```typescript
import { HealthCheckResult } from './chat-memory-types';

async function checkDatabase(): Promise<HealthCheckResult> {
  try {
    // Perform checks...
    return {
      healthy: true,
      message: 'Database is operational',
      diagnostics: {
        fileExists: true,
        canRead: true,
        canWrite: true,
        schemaValid: true
      }
    };
  } catch (error) {
    return {
      healthy: false,
      message: `Database check failed: ${error.message}`,
      diagnostics: {
        fileExists: false,
        canRead: false,
        canWrite: false,
        schemaValid: false
      }
    };
  }
}
```

## Relationship to Requirements

This type system directly implements the following requirements:

- **Requirement 2.6**: Message Metadata Completeness
- **Requirement 7.5**: Timestamp Precision
- **Requirement 11.5**: Serialization Completeness
- **Requirement 1.1**: Chat Session Isolation (through type structure)
- **Requirement 8.1**: Session Management API (through interfaces)

## Migration from ACP Types

The existing `acp/types.ts` file contains a simpler `ChatMessage` interface. The new `chat-memory-types.ts` provides:

1. **Stricter type safety** - Required fields are enforced
2. **Better documentation** - JSDoc comments explain each field
3. **Supporting types** - ToolCall, Attachment, etc. are properly typed
4. **Database alignment** - Types match the database schema exactly

Both type systems can coexist during migration. The ACP types are used for AI provider communication, while the chat-memory types are used for persistence.

## Testing

All types should be validated through:
1. **Unit tests** - Test type constraints and validation
2. **Property tests** - Test round-trip serialization
3. **Integration tests** - Test database operations with types

See the tasks.md file for specific testing requirements.
