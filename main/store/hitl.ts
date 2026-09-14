/**
 * HITL (Human-in-the-Loop) Storage
 * 
 * Stores HITL approval requests and responses in ~/.everfern/hitl/
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { assertSafeSegment } from '../lib/path-guard';

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

interface HitlRecord {
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
  const safeId = assertSafeSegment(conversationId, 'conversationId');
  const dir = path.join(getHitlDir(), safeId);
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
    const filePath = path.join(dir, `${assertSafeSegment(request.id, 'requestId')}.json`);
    
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
    const filePath = path.join(dir, `${assertSafeSegment(response.requestId, 'requestId')}.json`);
    
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
    const filePath = path.join(dir, `${assertSafeSegment(requestId, 'requestId')}.json`);
    
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
function getHitlStats(conversationId: string): {
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
