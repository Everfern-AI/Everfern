const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');

// Fix 1: Return type of shouldSkipGrepFile
content = content.replace(/async function shouldSkipGrepFile\(filePath: string, maxBytes: number\): \{ skip: boolean; reason\?: string \} \{/g, 'async function shouldSkipGrepFile(filePath: string, maxBytes: number): Promise<{ skip: boolean; reason?: string }> {');

// Let's also check for any function that has `await` but lacks `async`.
// We can just find `await ` inside `executeReplaceContent` or similar if line 983 is there.
// Instead of complex regex, let's look at lines around 983.
let lines = content.split('\n');
console.log('Line 138: ', lines[137]);
console.log('Line 980-985: ');
for (let i = 979; i <= 985; i++) {
    console.log(i + 1 + ': ' + lines[i]);
}

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed return type, outputting lines to check line 983...');
