const fs = require('fs');
const file = 'main/agent/tools/computer-use.ts';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(/async execute\(args: Record<string, unknown>, onUpdate\?: \(msg: string\) => void, emitEvent\?: \(event: any\) => void, toolCallId\?: string\): Promise<AgentToolResult> \{/,
  `async execute(args: Record<string, unknown>, onUpdate?: (msg: string) => void, emitEvent?: (event: any) => void, toolCallId?: string): Promise<AgentToolResult> {
      const { getComputerOverlayManager } = require('../../computer-overlay');
      const overlay = getComputerOverlayManager();
      overlay.show("Executing action...");`
);

code = code.replace(/if \(activeAgentInstance === agent\) \{\s*activeAgentInstance = null;\s*\}/,
  `if (activeAgentInstance === agent) {
          activeAgentInstance = null;
        }
        const { getComputerOverlayManager } = require('../../computer-overlay');
        getComputerOverlayManager().hide();`
);

fs.writeFileSync(file, code);
console.log('Fixed overlay');
