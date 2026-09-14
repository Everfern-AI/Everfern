/**
 * HITL (Human-in-the-Loop) Storage
 * 
 * Stores HITL approval requests and responses in ~/.everfern/hitl/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface HitlRequest {
  id: string;
  conversationId: string;
  timestamp: string;
  question: string;
  details: {
    tools: any[];
    summary: string;
    reasoning: string;
  };
  options: string[];
}

export interface HitlResponse {
  id: string;
  requestId: string;
  conversationId: string;
  timestamp: string;
  approved: boolean;
  response: string;
}

export interface HitlRecord {
  request: HitlRequest;
  response?: HitlResponse;
  status: 'pending' | 'approved' | 'rejected';
}

const getHitlDir = (): string => {
  const dir = path.join(os.homedir(), '.everfern', 'hitl');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

const getConversationHitlDir = (conversationId: string): string => {
  const dir = path.join(getHitlDir(), conversationId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
};

/**
 * Save a HITL request
 */
export function saveHitlRequest(request: HitlRequest): void {
  try {
    const dir = getConversationHitlDir(request.conversationId);
    const filePath = path.join(dir, `${request.id}.json`);
    
    const record: HitlRecord = {
      request,
      status: 'pending'
    };
    
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    console.log(`[HITL Storage] Saved request: ${request.id}`);
  } catch (err) {
    console.error('[HITL Storage] Failed to save request:', err);
  }
}

/**
 * Save a HITL response
 */
export function saveHitlResponse(response: HitlResponse): void {
  try {
    const dir = getConversationHitlDir(response.conversationId);
    const filePath = path.join(dir, `${response.requestId}.json`);
    
    // Load existing record
    let record: HitlRecord;
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      record = JSON.parse(data);
    } else {
      console.warn(`[HITL Storage] Request ${response.requestId} not found, creating new record`);
      record = {
        request: {
          id: response.requestId,
          conversationId: response.conversationId,
          timestamp: response.timestamp,
          question: '',
          details: { tools: [], summary: '', reasoning: '' },
          options: []
        },
        status: 'pending'
      };
    }
    
    // Update with response
    record.response = response;
    record.status = response.approved ? 'approved' : 'rejected';
    
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
    console.log(`[HITL Storage] Saved response: ${response.id} (${record.status})`);
  } catch (err) {
    console.error('[HITL Storage] Failed to save response:', err);
  }
}

/**
 * Get a HITL record by request ID
 */
export function getHitlRecord(conversationId: string, requestId: string): HitlRecord | null {
  try {
    const dir = getConversationHitlDir(conversationId);
    const filePath = path.join(dir, `${requestId}.json`);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('[HITL Storage] Failed to get record:', err);
    return null;
  }
}

/**
 * List all HITL records for a conversation
 */
export function listHitlRecords(conversationId: string): HitlRecord[] {
  try {
    const dir = getConversationHitlDir(conversationId);
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    
    const records: HitlRecord[] = [];
    for (const file of files) {
      const filePath = path.join(dir, file);
      const data = fs.readFileSync(filePath, 'utf-8');
      records.push(JSON.parse(data));
    }
    
    // Sort by timestamp (newest first)
    records.sort((a, b) => 
      new Date(b.request.timestamp).getTime() - new Date(a.request.timestamp).getTime()
    );
    
    return records;
  } catch (err) {
    console.error('[HITL Storage] Failed to list records:', err);
    return [];
  }
}

/**
 * Get HITL statistics for a conversation
 */
export function getHitlStats(conversationId: string): {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
} {
  const records = listHitlRecords(conversationId);
  
  return {
    total: records.length,
    pending: records.filter(r => r.status === 'pending').length,
    approved: records.filter(r => r.status === 'approved').length,
    rejected: records.filter(r => r.status === 'rejected').length,
  };
}

/**
 * Delete all HITL records for a conversation
 */
export function deleteConversationHitl(conversationId: string): void {
  try {
    const dir = getConversationHitlDir(conversationId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`[HITL Storage] Deleted all records for conversation: ${conversationId}`);
    }
  } catch (err) {
    console.error('[HITL Storage] Failed to delete conversation records:', err);
  }
}

/**
 * Export HITL records to a summary file
 */
export function exportHitlSummary(conversationId: string): string {
  const records = listHitlRecords(conversationId);
  const stats = getHitlStats(conversationId);
  
  let summary = `# HITL Approval Summary\n\n`;
  summary += `**Conversation ID:** ${conversationId}\n`;
  summary += `**Generated:** ${new Date().toISOString()}\n\n`;
  summary += `## Statistics\n\n`;
  summary += `- Total Requests: ${stats.total}\n`;
  summary += `- Approved: ${stats.approved}\n`;
  summary += `- Rejected: ${stats.rejected}\n`;
  summary += `- Pending: ${stats.pending}\n\n`;
  summary += `## Detailed Records\n\n`;
  
  for (const record of records) {
    summary += `### Request ${record.request.id}\n\n`;
    summary += `**Timestamp:** ${record.request.timestamp}\n`;
    summary += `**Status:** ${record.status}\n`;
    summary += `**Question:** ${record.request.question}\n`;
    summary += `**Reasoning:** ${record.request.details.reasoning}\n`;
    summary += `**Tools:** ${record.request.details.summary}\n\n`;
    
    if (record.response) {
      summary += `**Response Timestamp:** ${record.response.timestamp}\n`;
      summary += `**Decision:** ${record.response.approved ? 'APPROVED' : 'REJECTED'}\n`;
      summary += `**Response:** ${record.response.response}\n\n`;
    } else {
      summary += `**Response:** Pending\n\n`;
    }
    
    summary += `---\n\n`;
  }
  
  return summary;
}
