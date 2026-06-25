const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');

// Fix existsAsync calls
// Find `(await existsAsync)(something)` and replace with `(await existsAsync(something))`
content = content.replace(/\(await existsAsync\)\(([^)]+)\)/g, '(await existsAsync($1))');

// Fix 'await' inside synchronous functions.
// In `executeHostGrep`, `searchFile` is a synchronous inner function. We must make it async.
content = content.replace(/const searchFile = \(filePath: string\) => \{/g, 'const searchFile = async (filePath: string) => {');

// In `executeHostGrep`, `searchFile(searchPath)` needs `await`
content = content.replace(/searchFile\(searchPath\);/g, 'await searchFile(searchPath);');

// `shouldSkipGrepFile` uses `fs.statSync`. It's a sync function. Let's make it async and fix its usage.
content = content.replace(/function shouldSkipGrepFile/g, 'async function shouldSkipGrepFile');
content = content.replace(/const skip = shouldSkipGrepFile/g, 'const skip = await shouldSkipGrepFile');
// `shouldSkipGrepFile` has `await fs.promises.stat` now because of my previous script replacing `fs.statSync`.

// Are there other nested functions?
content = content.replace(/const scanDirectory = \(dir: string\) => \{/g, 'const scanDirectory = async (dir: string) => {');
content = content.replace(/scanDirectory\(dirPath\);/g, 'await scanDirectory(dirPath);');
content = content.replace(/scanDirectory\(searchPath\);/g, 'await scanDirectory(searchPath);');
content = content.replace(/scanDirectory\(dir\);/g, 'await scanDirectory(dir);');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed await issues in pi-tools.ts');
