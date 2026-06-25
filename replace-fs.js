const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');

// Replacements
content = content.replace(/fs\.existsSync/g, '(await existsAsync)');
content = content.replace(/fs\.readFileSync/g, 'await fs.promises.readFile');
content = content.replace(/fs\.writeFileSync/g, 'await fs.promises.writeFile');
content = content.replace(/fs\.readdirSync/g, 'await fs.promises.readdir');
content = content.replace(/fs\.statSync/g, 'await fs.promises.stat');
content = content.replace(/fs\.mkdirSync/g, 'await fs.promises.mkdir');

// Ensure existsAsync is defined
if (!content.includes('async function existsAsync')) {
    content = content.replace(/import \* as path from 'path';/, "import * as path from 'path';\n\nasync function existsAsync(p: string): Promise<boolean> {\n  try {\n    await fs.promises.access(p);\n    return true;\n  } catch {\n    return false;\n  }\n}\n");
}

fs.writeFileSync(file, content, 'utf8');
console.log('Replacements done in pi-tools.ts');
