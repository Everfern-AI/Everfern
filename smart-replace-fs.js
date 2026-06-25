const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');

// 1. Add existAsync
if (!content.includes('async function existsAsync')) {
    content = content.replace(/import \* as path from 'path';/, "import * as path from 'path';\n\nasync function existsAsync(p: string): Promise<boolean> {\n  try {\n    await fs.promises.access(p);\n    return true;\n  } catch {\n    return false;\n  }\n}\n");
}

// 2. Simple sync -> async replacements
content = content.replace(/fs\.existsSync\(([^)]+)\)/g, '(await existsAsync($1))');
content = content.replace(/fs\.readFileSync/g, 'await fs.promises.readFile');
content = content.replace(/fs\.writeFileSync/g, 'await fs.promises.writeFile');
content = content.replace(/fs\.readdirSync/g, 'await fs.promises.readdir');
content = content.replace(/fs\.mkdirSync/g, 'await fs.promises.mkdir');
content = content.replace(/fs\.statSync/g, 'await fs.promises.stat');

// 3. Fix shouldSkipGrepFile
content = content.replace(/function shouldSkipGrepFile/g, 'async function shouldSkipGrepFile');
content = content.replace(/const skip = shouldSkipGrepFile/g, 'const skip = await shouldSkipGrepFile');

// 4. Fix searchFile and scanDirectory inside executeHostGrep
content = content.replace(/const searchFile = \(filePath: string\) => \{/g, 'const searchFile = async (filePath: string) => {');
content = content.replace(/searchFile\(searchPath\);/g, 'await searchFile(searchPath);');
content = content.replace(/const scanDirectory = \(dir: string\) => \{/g, 'const scanDirectory = async (dir: string) => {');
content = content.replace(/scanDirectory\(dirPath\);/g, 'await scanDirectory(dirPath);');
content = content.replace(/scanDirectory\(searchPath\);/g, 'await scanDirectory(searchPath);');
content = content.replace(/scanDirectory\(dir\);/g, 'await scanDirectory(dir);');

// 5. Fix the .map() issue inside `executeTerminalCommand` (around line 976)
// Look for `.map((entry) => {` and replace it to `await Promise.all(...)`
// We'll use a regex that matches the `.map` block and rewrites it.
const mapRegex = /\.map\(\(entry\) => \{([\s\S]*?)return \{([\s\S]*?)\};\n\s*\}\)/g;
content = content.replace(mapRegex, 'await Promise.all($.map(async (entry) => {$1return {$2};\n            }))'.replace('$', ''));

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed await issues in pi-tools.ts via script');
