import { WebSocketServer, WebSocket } from 'ws';
import { AgentRunner } from './runner/runner';
import { getPooledAIClient } from '../lib/ai-client';
import { acpManager } from '../acp/manager';
import { globalAbortManager } from './runner/abort-manager';
import * as crypto from 'crypto';

export class AgentGatewayServer {
  private wss: WebSocketServer | null = null;
  private port: number;

  constructor(port = 4002) {
    this.port = port;
  }

  public start() {
    if (this.wss) return;

    this.wss = new WebSocketServer({ port: this.port });
    console.log(`[AgentGateway] WebSocket Gateway Control Plane started on port ${this.port}`);

    this.wss.on('connection', (ws) => {
      console.log('[AgentGateway] Remote client node connected to gateway');

      ws.on('message', async (message) => {
        try {
          const payload = JSON.parse(message.toString());
          const { type, requestId, data } = payload;

          if (type === 'run_task') {
            await this.handleRunTask(ws, requestId, data);
          } else if (type === 'abort_task') {
            globalAbortManager.setAborted();
            ws.send(JSON.stringify({ type: 'task_aborted', requestId }));
          }
        } catch (err: any) {
          ws.send(JSON.stringify({ type: 'error', message: err.message }));
        }
      });

      ws.on('close', () => {
        console.log('[AgentGateway] Remote client node disconnected');
      });
    });
  }

  private async handleRunTask(ws: WebSocket, requestId: string, data: any) {
    const { userInput, history, model, conversationId, projectId, systemPromptOverride } = data;
    const client = acpManager.getClient() || getPooledAIClient({ provider: 'ollama', model: model || 'llama3' });
    const runner = new AgentRunner(client);

    ws.send(JSON.stringify({ type: 'task_started', requestId, conversationId }));

    try {
      const stream = runner.runStream(
        userInput,
        history || [],
        model,
        conversationId || crypto.randomUUID(),
        systemPromptOverride,
        projectId,
        false,
        undefined,
        data.isBackground || false
      );

      for await (const event of stream) {
        ws.send(JSON.stringify({
          type: 'event',
          requestId,
          event
        }));
      }

      ws.send(JSON.stringify({ type: 'task_completed', requestId }));
    } catch (err: any) {
      ws.send(JSON.stringify({ type: 'task_failed', requestId, error: err.message }));
    }
  }

  public stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      console.log('[AgentGateway] WebSocket Gateway Control Plane stopped');
    }
  }
}

export const agentGatewayServer = new AgentGatewayServer();
