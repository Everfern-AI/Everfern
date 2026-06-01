/**
 * EverFern Desktop — Chat Memory Persistence System Type Definitions
 *
 * These types define the data models for the chat memory and persistence system.
 * They ensure type safety across database operations, vector storage, and UI components.
 *
 * @see requirements.md - Requirements 2.6, 7.5, 11.5
 * @see design.md - Data Models section
 */

// ── Core Message Types ──────────────────────────────────────────────

/**
 * Tool call information attached to a message
 */
export interface ToolCall {
  /** Unique identifier for the tool call */
  id?: string;
  /** Name of the tool being called */
  name: string;
  /** Arguments passed to the tool (JSON object) */
  arguments: Record<string, any>;
  /** Result returned by the tool */
  result?: any;
  /** Order index for sorting multiple tool calls */
  orderIndex?: number;
  /** Timestamp when the tool was called */
  timestamp?: string;
  /** Status of the tool call */
  status?: 'pending' | 'success' | 'error';
  /** Error message if the tool call failed */
  error?: string;
}

/**
 * File or media attachment associated with a message
 */
export interface Attachment {
  /** Unique identifier for the attachment */
  id: string;
  /** Type of attachment (image, file, etc.) */
  type: 'image' | 'file' | 'audio' | 'video';
  /** File name */
  name: string;
  /** File path or URL */
  url: string;
  /** MIME type */
  mimeType?: string;
  /** File size in bytes */
  size?: number;
  /** Thumbnail URL for media files */
  thumbnailUrl?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Content type for messages supporting text and multimodal content
 */
export type MessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }
    >;

/**
 * Role of the message sender
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Individual chat message with all metadata
 *
 * This interface represents a single message in a conversation with all
 * associated metadata including tool calls, attachments, and timeline information.
 *
 * @see requirements.md - Requirement 2.6 (Message Metadata Completeness)
 * @see requirements.md - Requirement 7.5 (Timestamp Precision)
 */
export interface ChatMessage {
  /** Unique message identifier */
  id: string;

  /** Role of the message sender */
  role: MessageRole;

  /** Message content (text or multimodal) */
  content: MessageContent;

  /** Internal reasoning or thought process (for assistant messages) */
  thought?: string;

  /** Extended reasoning content */
  reasoning_content?: string;

  /** Tool calls made during this message */
  toolCalls?: ToolCall[];

  /** Mission timeline data (for complex multi-step operations) */
  missionTimeline?: any;

  /** Whether this message has timeline data */
  hasTimeline: boolean;

  /** Order index for sorting messages in the conversation */
  orderIndex: number;

  /** Duration of thinking/reasoning in milliseconds */
  thinkingDuration?: number;

  /** Whether the message generation was stopped by the user */
  stopped: boolean;

  /** File or media attachments */
  attachments?: Attachment[];

  /** ISO 8601 timestamp with millisecond precision */
  createdAt: string;
}

// ── Conversation Types ──────────────────────────────────────────────

/**
 * Provider type for AI completions
 */
export type ProviderType =
  | 'openai'
  | 'anthropic'
  | 'deepseek'
  | 'minimax'
  | 'ollama'
  | 'ollama-cloud'
  | 'lmstudio'
  | 'everfern'
  | 'gemini'
  | 'nvidia'
  | 'openrouter';

/**
 * Full conversation with all messages
 *
 * Represents a complete chat session including all messages and metadata.
 * Each conversation is isolated and maintains its own independent history.
 *
 * @see requirements.md - Requirement 1.1 (Chat Session Isolation)
 * @see requirements.md - Requirement 7.1 (Chat History Persistence)
 */
export interface Conversation {
  /** Unique conversation identifier */
  id: string;

  /** Human-readable conversation title */
  title: string;

  /** All messages in the conversation */
  messages: ChatMessage[];

  /** AI provider used for this conversation */
  provider: ProviderType;

  /** Model name used for this conversation */
  model?: string;

  /** Associated project ID (if conversation is project-specific) */
  projectId?: string;

  /** Associated project name (denormalized for performance) */
  projectName?: string;

  /** ISO 8601 timestamp when conversation was created */
  createdAt: string;

  /** ISO 8601 timestamp when conversation was last updated */
  updatedAt: string;
}

/**
 * Lightweight conversation summary for list views
 *
 * Contains essential metadata without loading all messages.
 * Used for displaying conversation lists efficiently.
 *
 * @see requirements.md - Requirement 8.2 (Chat Session Management)
 */
export interface ConversationSummary {
  /** Unique conversation identifier */
  id: string;

  /** Human-readable conversation title */
  title: string;

  /** AI provider used for this conversation */
  provider: ProviderType;

  /** Model name used for this conversation */
  model?: string;

  /** Associated project ID */
  projectId?: string;

  /** Associated project name */
  projectName?: string;

  /** Total number of messages in the conversation */
  messageCount: number;

  /** ISO 8601 timestamp when conversation was created */
  createdAt: string;

  /** ISO 8601 timestamp when conversation was last updated */
  updatedAt: string;
}

// ── Vector Storage Types ────────────────────────────────────────────

/**
 * Search result from vector similarity search
 *
 * Represents a message retrieved through semantic similarity search,
 * including the similarity score for ranking.
 *
 * @see requirements.md - Requirement 2.3 (Semantic Search Relevance)
 * @see requirements.md - Requirement 9.1 (Memory Context Retrieval)
 */
export interface SearchResult {
  /** Message identifier */
  id: string;

  /** Conversation identifier */
  chatId: string;

  /** Message role */
  role: string;

  /** Message content */
  content: string;

  /** Unix timestamp (milliseconds) */
  createdAt: number;

  /** Semantic similarity score (0.0 to 1.0) */
  similarity: number;
}

/**
 * Vector store statistics and health information
 *
 * Provides diagnostic information about the vector store state.
 *
 * @see requirements.md - Requirement 6.1 (Vector Store Health Validation)
 */
export interface VectorStats {
  /** Total number of messages with embeddings */
  messageCount: number;

  /** Dimension count of embeddings (e.g., 1536 for text-embedding-3-small) */
  dimensionCount: number | null;

  /** Storage size in bytes */
  storageSize: number;

  /** Whether the vector store is initialized */
  initialized: boolean;

  /** Error message if initialization failed */
  error: string | null;
}

// ── Health Check Types ──────────────────────────────────────────────

/**
 * Health check result for a system component
 *
 * @see requirements.md - Requirement 3.2 (Pre-Flight Health Check UI)
 */
export interface HealthCheckResult {
  /** Whether the component is healthy */
  healthy: boolean;

  /** Human-readable status message */
  message: string;

  /** Detailed diagnostic information */
  diagnostics?: {
    /** Whether the database file exists */
    fileExists?: boolean;

    /** Whether the database is readable */
    canRead?: boolean;

    /** Whether the database is writable */
    canWrite?: boolean;

    /** Whether the database schema is valid */
    schemaValid?: boolean;

    /** Additional diagnostic data */
    [key: string]: any;
  };
}

/**
 * Component type for health checks
 */
export type HealthCheckComponent = 'vm' | 'database' | 'vector';

/**
 * Status of a health check
 */
export type HealthCheckStatus = 'pending' | 'running' | 'passed' | 'failed';

/**
 * Individual health check result with timing
 *
 * @see requirements.md - Requirement 3.3 (Pre-Flight Health Check UI)
 */
export interface CheckResult {
  /** Component being checked */
  component: HealthCheckComponent;

  /** Whether the check passed */
  passed: boolean;

  /** Status message */
  message: string;

  /** Check duration in milliseconds */
  duration: number;

  /** Additional diagnostic information */
  diagnostics?: any;
}

/**
 * Status information for UI display
 */
export interface CheckStatus {
  /** Component name */
  component: string;

  /** Current status */
  status: HealthCheckStatus;

  /** Status message */
  message: string;
}

/**
 * Complete pre-flight check result
 *
 * @see requirements.md - Requirement 3.4 (Pre-Flight Health Check UI)
 */
export interface PreFlightResult {
  /** Whether all checks passed */
  allPassed: boolean;

  /** Individual check results */
  checks: CheckResult[];

  /** Whether the application can proceed */
  canProceed: boolean;
}

// ── Parser/Serializer Types ─────────────────────────────────────────

/**
 * Result of a parsing operation
 *
 * @see requirements.md - Requirement 11.1 (Chat History Parser)
 */
export interface ParseResult<T> {
  /** Whether parsing succeeded */
  success: boolean;

  /** Parsed data (if successful) */
  data?: T;

  /** Error information (if failed) */
  error?: {
    /** Error message */
    message: string;

    /** Location of the error in the input */
    location?: string;
  };
}

// ── Database Operation Types ────────────────────────────────────────

/**
 * Result of a database operation
 *
 * @see requirements.md - Requirement 10.1 (Error Recovery and Data Integrity)
 */
export interface DatabaseOperationResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Error message (if failed) */
  error?: string;
}

/**
 * Pagination parameters for message retrieval
 *
 * @see requirements.md - Requirement 12.5 (Performance and Scalability)
 */
export interface PaginationParams {
  /** Page number (0-indexed) */
  page: number;

  /** Number of items per page */
  pageSize: number;
}

/**
 * Paginated result set
 */
export interface PaginatedResult<T> {
  /** Items in the current page */
  items: T[];

  /** Total number of items across all pages */
  totalCount: number;

  /** Current page number */
  page: number;

  /** Number of items per page */
  pageSize: number;

  /** Total number of pages */
  totalPages: number;

  /** Whether there is a next page */
  hasNextPage: boolean;

  /** Whether there is a previous page */
  hasPreviousPage: boolean;
}

// ── Configuration Types ─────────────────────────────────────────────

/**
 * Embedding provider configuration
 */
export interface EmbeddingConfig {
  /** Provider name (e.g., 'openai', 'local') */
  provider: string;

  /** Model name (e.g., 'text-embedding-3-small') */
  model: string;

  /** Embedding dimension count */
  dimensions: number;

  /** API key (if required) */
  apiKey?: string;

  /** Base URL (for custom endpoints) */
  baseUrl?: string;
}

/**
 * Chat manager configuration
 */
export interface ChatManagerConfig {
  /** Maximum messages to load per page */
  defaultPageSize: number;

  /** Threshold for automatic pagination (messages) */
  paginationThreshold: number;

  /** Maximum retry attempts for failed operations */
  maxRetries: number;

  /** Base delay for exponential backoff (milliseconds) */
  retryBaseDelay: number;
}

/**
 * Vector service configuration
 */
export interface VectorServiceConfig {
  /** Similarity threshold for search results (0.0 to 1.0) */
  similarityThreshold: number;

  /** Maximum number of results to return */
  maxResults: number;

  /** Embedding configuration */
  embedding: EmbeddingConfig;
}
