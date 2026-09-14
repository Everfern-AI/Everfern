import * as fs from 'fs/promises';
import * as path from 'path';
import type { AgentTool, ToolResult } from '../runner/types';
import { getRollbackManager } from '../persistence/rollback-manager';
import { getAgentContext } from './pi-tools';

interface FileEntry {
  path: string;
  content: string;
}
