const fs = require('fs');
const file = 'main/agent/tools/computer-use.ts';
let code = fs.readFileSync(file, 'utf8');

const classRegex = /class ProgressEventEmitter \{[\s\S]*?\n\}/;
const replacementClass = `class ProgressEventEmitter {
  constructor(
    private toolCallId: string,
    private emitEvent: ((event: any) => void) | undefined,
    private timelineBranchMetadata?: any
  ) {}

  emit(event: any): void {
    if (this.timelineBranchMetadata && !event.timelineBranch) {
      event.timelineBranch = {
        ...this.timelineBranchMetadata,
        branchStatus: this.mapEventTypeToBranchStatus(event.type),
      };
    }
    
    if (this.emitEvent) {
      this.emitEvent({
        type: 'subagent-progress',
        toolCallId: this.toolCallId,
        timestamp: new Date().toISOString(),
        data: {
          ...event,
          toolCallId: this.toolCallId,
          content: event.content || event.action?.description || ''
        }
      });
    }
  }

  private mapEventTypeToBranchStatus(eventType: string): string {
    switch (eventType) {
      case 'branch_start': case 'step': case 'reasoning': case 'action': case 'screenshot': case 'branch_update':
        return 'running';
      case 'branch_complete': case 'complete':
        return 'completed';
      case 'branch_abort': case 'abort':
        return 'aborted';
      default:
        return 'running';
    }
  }

  emitBranchStart(taskDescription?: string): void {
    this.emit({
      type: 'branch_start',
      toolCallId: this.toolCallId,
      timestamp: new Date().toISOString(),
      content: taskDescription || 'Subagent branch started',
      timelineBranch: { ...this.timelineBranchMetadata, branchStatus: 'running', taskDescription: taskDescription || this.timelineBranchMetadata?.taskDescription }
    });
  }

  emitBranchComplete(result?: string): void {
    this.emit({
      type: 'branch_complete',
      toolCallId: this.toolCallId,
      timestamp: new Date().toISOString(),
      content: result || 'Subagent branch completed successfully',
      timelineBranch: { ...this.timelineBranchMetadata, branchStatus: 'completed' }
    });
  }

  emitBranchAbort(reason?: string): void {
    this.emit({
      type: 'branch_abort',
      toolCallId: this.toolCallId,
      timestamp: new Date().toISOString(),
      content: reason || 'Subagent branch aborted',
      timelineBranch: { ...this.timelineBranchMetadata, branchStatus: 'aborted' }
    });
  }

  destroy(): void {}
}`;

code = code.replace(classRegex, replacementClass);

// Also need to update the instantiation of ProgressEventEmitter
code = code.replace(
  /const progressEmitter = new ProgressEventEmitter\(\s*effectiveToolCallId,\s*sender,\s*timelineBranchMetadata\s*\);/,
  `const progressEmitter = new ProgressEventEmitter(\n        effectiveToolCallId,\n        emitEvent,\n        timelineBranchMetadata\n      );`
);

fs.writeFileSync(file, code);
console.log('Fixed computer-use.ts');
