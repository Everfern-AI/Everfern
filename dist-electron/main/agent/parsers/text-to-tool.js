"use strict";
/**
 * EverFern Desktop — Text to Tool Call Parser
 *
 * Catches cases where a model writes tool signatures purely in text (e.g. naked python-like string calls
 * or unformatted JSON blocks) instead of emitting formal tool-call objects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTextToToolCalls = parseTextToToolCalls;
/**
 * Parses UI-TARS format actions from text
 * Supports formats like: Action: click((y,x)), Action: type(content='text'), etc.
 */
function parseUiTarsActions(text) {
    const actions = [];
    // Pattern: Action: <name>(<args>)
    const actionRegex = /Action:\s*(\w+)\((.*?)\)/gi;
    let match;
    while ((match = actionRegex.exec(text)) !== null) {
        const actionName = match[1].toLowerCase();
        const paramsStr = match[2].trim();
        const inputs = {};
        if (actionName === 'click' || actionName === 'left_double' || actionName === 'right_single') {
            // Extract coordinates like (y,x)
            const coordMatch = paramsStr.match(/\((\d+),\s*(\d+)\)/);
            if (coordMatch) {
                inputs.start_box = [parseInt(coordMatch[1], 10), parseInt(coordMatch[2], 10)];
            }
        }
        else if (actionName === 'type') {
            // Extract content like content='text' or content="text"
            const contentMatch = paramsStr.match(/content=['"](.*?)['"]/);
            if (contentMatch) {
                inputs.content = contentMatch[1].replace(/\\n/g, '\n');
            }
        }
        else if (actionName === 'drag') {
            // Extract drag endpoints
            const endBoxMatch = paramsStr.match(/end_box=\((.*?)\)/);
            if (endBoxMatch) {
                inputs.end_box = endBoxMatch[1];
            }
        }
        else if (actionName === 'key' || actionName === 'press') {
            // Extract key name
            const keyMatch = paramsStr.match(/content=['"](.*?)['"]/);
            if (keyMatch) {
                inputs.content = keyMatch[1];
            }
        }
        else if (actionName === 'hover') {
            // Extract hover box
            const hoverMatch = paramsStr.match(/start_box=\((.*?)\)/);
            if (hoverMatch) {
                inputs.start_box = hoverMatch[1];
            }
        }
        else if (actionName === 'wait' || actionName === 'finished') {
            // No parameters needed
        }
        if (actionName) {
            actions.push({
                action_type: actionName,
                action_inputs: inputs
            });
        }
    }
    return actions;
}
// Tool name aliases for backward compatibility and model-specific variations
const TOOL_NAME_ALIASES = {
    'read_file': 'read',
    'write_file': 'write',
    'edit_file': 'edit',
    'find_files': 'find',
    'grep_files': 'grep',
    'list_files': 'ls',
    'view_file': 'read',
    'write_to_file': 'write',
    'replace': 'edit',
    'run_command': 'terminal_execute',
    'bash': 'terminal_execute',
    'executePwsh': 'terminal_execute',
};
function normalizeToolName(toolName) {
    return TOOL_NAME_ALIASES[toolName.toLowerCase()] || toolName;
}
function parseTextToToolCalls(textContent, definedTools) {
    const toolCalls = [];
    let scrubbedContent = textContent;
    let parseErrorStr;
    console.log(`[TextToTool] 🔍 Starting parser with ${textContent.length} chars, ${definedTools.length} defined tools`);
    console.log(`[TextToTool] 📋 Defined tools: ${definedTools.map(t => t.name).join(', ')}`);
    // 1. Strip <think> and <thought> blocks before parsing so we don't accidentally parse JSON narrated inside reasoning
    scrubbedContent = scrubbedContent.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/ig, '').trim();
    // 1b. Match formal <tool_call> blocks first
    const toolCallRegex = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
    let tcMatch;
    while ((tcMatch = toolCallRegex.exec(scrubbedContent)) !== null) {
        const blockContent = tcMatch[1].trim();
        let parsedArgs = null;
        let toolName = '';
        try {
            // It might be pure JSON
            const parsed = JSON.parse(blockContent);
            toolName = parsed.name || parsed.tool || '';
            parsedArgs = parsed.arguments || parsed.args || parsed.parameters || { ...parsed };
            delete parsedArgs.name;
            delete parsedArgs.tool;
        }
        catch (e) {
            // Might be a weird YAML/JSON hybrid like:
            // {"name": "write", "arguments": {"path": "..."}}
            // Or just name: write \n arguments: {...}
            const nameMatch = blockContent.match(/"name"\s*:\s*"([^"]+)"/i) || blockContent.match(/name\s*:\s*"?([^"\n]+)"?/i);
            if (nameMatch)
                toolName = nameMatch[1];
            // Try to extract arguments object
            const argsMatch = blockContent.match(/"arguments"\s*:\s*(\{[\s\S]*?\})/i) || blockContent.match(/arguments\s*:\s*(\{[\s\S]*?\})/i);
            if (argsMatch) {
                try {
                    parsedArgs = JSON.parse(argsMatch[1]);
                }
                catch (e2) { }
            }
        }
        const normalizedName = normalizeToolName(toolName);
        if (toolName && parsedArgs && definedTools.some(t => t.name === normalizedName)) {
            // Map common argument variations
            if (['terminal_execute', 'run_command', 'bash', 'executePwsh'].includes(normalizedName)) {
                if (parsedArgs.CommandLine && !parsedArgs.command) {
                    parsedArgs.command = parsedArgs.CommandLine;
                }
                if (parsedArgs.cmd && !parsedArgs.command) {
                    parsedArgs.command = parsedArgs.cmd;
                }
            }
            toolCalls.push({
                id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: normalizedName,
                arguments: parsedArgs
            });
            scrubbedContent = scrubbedContent.replace(tcMatch[0], '').trim();
            console.log(`[TextToTool] 🧩 Formalized <tool_call> tag for: ${toolName}`);
        }
    }
    // 2. Match computer_use(task="...") or other common tool patterns
    const funcRegex = /([a-zA-Z0-9_-]+)\(([\s\S]*?)\)/gi;
    let fMatch;
    const discoveredCalls = [];
    while ((fMatch = funcRegex.exec(scrubbedContent)) !== null) {
        const pId = `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const toolName = normalizeToolName(fMatch[1]);
        const paramsRaw = fMatch[2].trim();
        if (toolName === 'terminal_execute' || toolName === 'bash') {
            const cmdMatch = paramsRaw.match(/command=['"]([\s\S]*?)['"]/);
            if (cmdMatch) {
                discoveredCalls.push({
                    id: pId,
                    name: 'terminal_execute',
                    arguments: { command: cmdMatch[1] },
                    rawMatch: fMatch[0]
                });
            }
        }
        else if (toolName === 'read') {
            const pathMatch = paramsRaw.match(/path=['"](.*?)['"]/);
            if (pathMatch) {
                discoveredCalls.push({
                    id: pId,
                    name: 'read_file',
                    arguments: { file_path: pathMatch[1] },
                    rawMatch: fMatch[0]
                });
            }
        }
        else if (toolName === 'write') {
            // Handle multiline content for write
            const writeMatch = paramsRaw.match(/path=['"](.*?)['"]\s*,\s*content=['"]([\s\S]*?)['"]/);
            if (writeMatch) {
                discoveredCalls.push({
                    id: pId,
                    name: 'write_file',
                    arguments: { path: writeMatch[1], content: writeMatch[2] },
                    rawMatch: fMatch[0]
                });
            }
        }
        else if (toolName === 'computer_use') {
            // Parse computer_use(action="...", coordinate=[x,y], ...) format
            const args = {};
            // Extract action parameter
            const actionMatch = paramsRaw.match(/action=['"](.*?)['"]/);
            if (actionMatch) {
                args.action = actionMatch[1];
            }
            // Extract coordinate parameter [x, y]
            const coordMatch = paramsRaw.match(/coordinate=\[(\d+),\s*(\d+)\]/);
            if (coordMatch) {
                args.coordinate = [parseInt(coordMatch[1], 10), parseInt(coordMatch[2], 10)];
            }
            // Extract text parameter
            const textMatch = paramsRaw.match(/text=['"]([\s\S]*?)['"]/);
            if (textMatch) {
                args.text = textMatch[1].replace(/\\n/g, '\n');
            }
            // Extract keys parameter [key1, key2, ...]
            const keysMatch = paramsRaw.match(/keys=\[(.*?)\]/);
            if (keysMatch) {
                const keysStr = keysMatch[1];
                args.keys = keysStr.split(',').map((k) => k.trim().replace(/['"]/g, ''));
            }
            // Extract pixels parameter
            const pixelsMatch = paramsRaw.match(/pixels=(\d+)/);
            if (pixelsMatch) {
                args.pixels = parseInt(pixelsMatch[1], 10);
            }
            // Extract time parameter
            const timeMatch = paramsRaw.match(/time=(\d+(?:\.\d+)?)/);
            if (timeMatch) {
                args.time = parseFloat(timeMatch[1]);
            }
            // Extract status parameter
            const statusMatch = paramsRaw.match(/status=['"](success|failure)['"]/);
            if (statusMatch) {
                args.status = statusMatch[1];
            }
            if (args.action) {
                discoveredCalls.push({
                    id: pId,
                    name: 'computer_use',
                    arguments: args,
                    rawMatch: fMatch[0]
                });
                console.log(`[TextToTool] 🖥️ computer_use Parser found: ${args.action}`, args);
            }
        }
    }
    // 3. Match UI-TARS native format using local parser
    if (definedTools.some(t => t.name === 'computer_use')) {
        try {
            const parsedActions = parseUiTarsActions(textContent);
            if (parsedActions && parsedActions.length > 0) {
                for (const action of parsedActions) {
                    const actionName = action.action_type;
                    const inputs = action.action_inputs;
                    const args = {};
                    console.log(`[TextToTool] 🤖 UI-TARS Parser found: ${actionName}`, inputs);
                    if (actionName === 'click' || actionName === 'left_double' || actionName === 'right_single') {
                        args.action = actionName === 'click' ? 'left_click' : (actionName === 'left_double' ? 'double_click' : 'right_click');
                        if (inputs.start_box) {
                            // start_box is usually "[y,x]" or "[y1,x1,y2,x2]"
                            const cleanStr = inputs.start_box.replace(/'/g, '"').replace(/\(/g, '[').replace(/\)/g, ']');
                            try {
                                const coords = JSON.parse(cleanStr);
                                if (Array.isArray(coords)) {
                                    if (coords.length === 4) {
                                        // Center of box
                                        args.coordinate = [
                                            Math.round((coords[1] + coords[3]) / 2),
                                            Math.round((coords[0] + coords[2]) / 2)
                                        ];
                                    }
                                    else if (coords.length === 2) {
                                        // [y, x] -> [x, y]
                                        args.coordinate = [Math.round(coords[1]), Math.round(coords[0])];
                                    }
                                }
                            }
                            catch (e) {
                                // Regex fallback for (y,x)
                                const m = inputs.start_box.match(/(\d+),\s*(\d+)/);
                                if (m)
                                    args.coordinate = [parseInt(m[2], 10), parseInt(m[1], 10)];
                            }
                        }
                    }
                    else if (actionName === 'type') {
                        args.action = 'type';
                        if (inputs.content)
                            args.text = inputs.content.replace(/\\n/g, '\n');
                    }
                    else if (actionName === 'drag') {
                        args.action = 'left_click_drag';
                        if (inputs.end_box) {
                            const cleanStr = inputs.end_box.replace(/'/g, '"').replace(/\(/g, '[').replace(/\)/g, ']');
                            try {
                                const coords = JSON.parse(cleanStr);
                                if (Array.isArray(coords) && coords.length === 2) {
                                    args.coordinate = [Math.round(coords[1]), Math.round(coords[0])];
                                }
                            }
                            catch (e) { }
                        }
                    }
                    else if (actionName === 'key' || actionName === 'press') {
                        args.action = 'key';
                        if (inputs.content)
                            args.keys = [inputs.content];
                    }
                    else if (actionName === 'hover') {
                        args.action = 'mouse_move';
                        if (inputs.start_box) {
                            const m = inputs.start_box.match(/(\d+),\s*(\d+)/);
                            if (m)
                                args.coordinate = [parseInt(m[2], 10), parseInt(m[1], 10)];
                        }
                    }
                    else if (actionName === 'scroll') {
                        args.action = 'scroll';
                        const dir = (inputs.direction || 'down').toLowerCase();
                        args.pixels = (dir === 'down' || dir === 'right') ? -600 : 600;
                    }
                    else if (actionName === 'wait') {
                        args.action = 'wait';
                    }
                    else if (actionName === 'finished') {
                        args.action = 'terminate';
                        args.status = 'success';
                    }
                    if (args.action) {
                        toolCalls.push({
                            id: `tc-uitars-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                            name: 'computer_use',
                            arguments: args
                        });
                    }
                }
                // Scrub the Action: blocks
                scrubbedContent = scrubbedContent.replace(/Action:\s*.*\(.*?\)/gi, '').trim();
            }
        }
        catch (err) {
            console.error(`[TextToTool] ❌ UI-TARS Parser failed:`, err);
        }
    }
    if (discoveredCalls.length > 0) {
        for (const c of discoveredCalls) {
            if (!toolCalls.find(tc => tc.name === c.name && JSON.stringify(tc.arguments) === JSON.stringify(c.arguments))) {
                toolCalls.push({ id: c.id, name: c.name, arguments: c.arguments });
            }
            scrubbedContent = scrubbedContent.replace(c.rawMatch, '');
        }
    }
    // 4. Match generic action=name(...) pattern if applicable
    const genericMatch = scrubbedContent.match(/action=([a-z_]+)\((.*?)\)/i);
    if (genericMatch) {
        const actionName = normalizeToolName(genericMatch[1]);
        if (definedTools.some(t => t.name === actionName)) {
            toolCalls.push({
                id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: actionName,
                arguments: { task: 'Perform automation' } // Simple fallback
            });
            scrubbedContent = scrubbedContent.replace(genericMatch[0], '').trim();
        }
    }
    // 5. Match generic JSON blocks
    try {
        const jsonBlocks = [];
        let braceCount = 0;
        let currentBlockStart = -1;
        let inString = false;
        let isEscaped = false;
        for (let i = 0; i < scrubbedContent.length; i++) {
            const char = scrubbedContent[i];
            if (inString) {
                if (char === '\\')
                    isEscaped = !isEscaped;
                else if (char === '"' && !isEscaped)
                    inString = false;
                else
                    isEscaped = false;
            }
            else {
                if (char === '"')
                    inString = true;
                else if (char === '{') {
                    if (braceCount === 0)
                        currentBlockStart = i;
                    braceCount++;
                }
                else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0 && currentBlockStart !== -1) {
                        jsonBlocks.push({ str: scrubbedContent.substring(currentBlockStart, i + 1), start: currentBlockStart, end: i + 1 });
                        currentBlockStart = -1;
                    }
                }
            }
        }
        for (const block of jsonBlocks) {
            try {
                const parsed = JSON.parse(block.str);
                const toolName = normalizeToolName(parsed.name || parsed.tool || '');
                if (toolName && definedTools.some(t => t.name === toolName)) {
                    toolCalls.push({
                        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                        name: toolName,
                        arguments: parsed.arguments || parsed.args || parsed.parameters || parsed
                    });
                    scrubbedContent = scrubbedContent.replace(block.str, '');
                }
            }
            catch (e) { }
        }
    }
    catch (e) { }
    // 6. Final Deduplication
    const uniqueToolCalls = toolCalls.filter((tc, index, self) => index === self.findIndex((t) => (t.name === tc.name && JSON.stringify(t.arguments) === JSON.stringify(tc.arguments))));
    return { toolCalls: uniqueToolCalls, scrubbedContent: scrubbedContent.trim(), parseError: parseErrorStr };
}
