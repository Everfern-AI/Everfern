const fs = require('fs');
const file = 'main/agent/tools/computer-use.ts';
let code = fs.readFileSync(file, 'utf8');

// 1. Remove ProgressEventEmitter class and types
const classStart = code.indexOf('class ProgressEventEmitter {');
const classEnd = code.indexOf('// ── Computer Use Main Logic ──────────────────────────────────────────────────');
if (classStart !== -1 && classEnd !== -1) {
  code = code.substring(0, classStart) + code.substring(classEnd);
}

// 2. Remove SubAgentProgressBatch
const batchStart = code.indexOf('export interface SubAgentProgressBatch {');
const batchEnd = code.indexOf('// ── Progress Event Emitter ──────────────────────────────────────────────────');
if (batchStart !== -1 && batchEnd !== -1) {
  code = code.substring(0, batchStart) + code.substring(batchEnd);
}

// 3. Update createComputerUseTool
code = code.replace(/const mainWindow = \(global as any\)\.mainWindow;[\s\S]*?tool\.setProgressEmitter\(progressEmitter, effectiveToolCallId\);/m, `
      // Emit branch start event for timeline visualization
      emitEvent?.({
        type: 'subagent-progress',
        toolCallId: effectiveToolCallId,
        timestamp: new Date().toISOString(),
        data: {
          type: 'branch_start',
          toolCallId: effectiveToolCallId,
          timestamp: new Date().toISOString(),
          content: task || 'Computer use automation task',
          timelineBranch: timelineBranchMetadata
        }
      });
`);

code = code.replace(/progressEmitter\.emitBranchComplete\(finalOutput\);/g, `
        emitEvent?.({
          type: 'subagent-progress',
          toolCallId: effectiveToolCallId,
          timestamp: new Date().toISOString(),
          data: {
            type: 'branch_complete',
            toolCallId: effectiveToolCallId,
            timestamp: new Date().toISOString(),
            content: finalOutput,
            timelineBranch: { ...timelineBranchMetadata, branchStatus: 'completed' }
          }
        });
`);

code = code.replace(/progressEmitter\.emit\({[\s\S]*?type: 'complete',[\s\S]*?}\);/g, ``);

code = code.replace(/progressEmitter\.emitBranchAbort\(`Task failed: \${errorMessage}`\);/g, `
        emitEvent?.({
          type: 'subagent-progress',
          toolCallId: effectiveToolCallId,
          timestamp: new Date().toISOString(),
          data: {
            type: 'branch_abort',
            toolCallId: effectiveToolCallId,
            timestamp: new Date().toISOString(),
            content: \`Task failed: \${errorMessage}\`,
            timelineBranch: { ...timelineBranchMetadata, branchStatus: 'failed' }
          }
        });
`);

code = code.replace(/progressEmitter\.emit\({[\s\S]*?type: 'abort',[\s\S]*?}\);/g, ``);

code = code.replace(/progressEmitter\.destroy\(\);/g, ``);

code = code.replace(/agent\.run\([\s\S]*?\(event\) => {[\s\S]*?progressEmitter\.emit\(event\);[\s\S]*?}\s*\);/m, `agent.run(
          (update) => onUpdate?.(update),
          (event) => {
            if (emitEvent) {
              emitEvent({
                type: 'subagent-progress',
                toolCallId: effectiveToolCallId,
                timestamp: new Date().toISOString(),
                data: {
                  ...event,
                  toolCallId: effectiveToolCallId,
                  content: event.content || event.action?.description || '',
                  timelineBranch: {
                    ...timelineBranchMetadata,
                    branchStatus: 'running'
                  }
                }
              });
            }
          }
        );`);

fs.writeFileSync(file, code);
console.log('Fixed computer-use.ts');
