const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');

// Fix 1: shouldSkipGrepFile return type
content = content.replace(/async function shouldSkipGrepFile\(filePath: string, maxBytes: number\): \{ skip: boolean; reason\?: string \} \{/g, 'async function shouldSkipGrepFile(filePath: string, maxBytes: number): Promise<{ skip: boolean; reason?: string }> {');

// Fix 2: the .map issue.
// Let's find exactly the line: `.map((entry) => {` that has `const stat = await fs.promises.stat(absolutePath);` below it
content = content.replace(/\.map\(\(entry\) => \{\n\s*const isDirectory/g, 'await Promise.all($.map(async (entry) => {\n              const isDirectory'.replace('$', ''));

// We need to close the Promise.all. The original code ends with:
/*
              return {
                name: cleanName,
                path: absolutePath,
                type: isDirectory ? 'directory' : 'file',
                size,
                modifiedAt,
              };
            });
*/
// We replace `});` with `})))` at the end of the map. Wait, that's too generic.
// Let's just find the exact block.
const searchBlock = `            .map(async (entry) => {
              const isDirectory = entry.endsWith('/');
              const cleanName = entry.replace(/[\\\\/]+$/g, '');
              const absolutePath = path.resolve(listPath, cleanName);
              let size: number | undefined;
              let modifiedAt: string | undefined;
              try {
                const stat = await fs.promises.stat(absolutePath);
                size = stat.isFile() ? stat.size : undefined;
                modifiedAt = stat.mtime.toISOString();
              } catch {
                // The PI output is still useful even if stat fails for a transient file.
              }
              return {
                name: cleanName,
                path: absolutePath,
                type: isDirectory ? 'directory' : 'file',
                size,
                modifiedAt,
              };
            });`;

// In the current file it looks like `.map((entry) => {` because my previous mapRegex failed.
const targetBlock = `            .map((entry) => {
              const isDirectory = entry.endsWith('/');
              const cleanName = entry.replace(/[\\\\/]+$/g, '');
              const absolutePath = path.resolve(listPath, cleanName);
              let size: number | undefined;
              let modifiedAt: string | undefined;
              try {
                const stat = await fs.promises.stat(absolutePath);
                size = stat.isFile() ? stat.size : undefined;
                modifiedAt = stat.mtime.toISOString();
              } catch {
                // The PI output is still useful even if stat fails for a transient file.
              }
              return {
                name: cleanName,
                path: absolutePath,
                type: isDirectory ? 'directory' : 'file',
                size,
                modifiedAt,
              };
            });`;

const replacementBlock = `            ))`;

if (content.includes(targetBlock)) {
    content = content.replace(targetBlock, `            .map(async (entry) => {
              const isDirectory = entry.endsWith('/');
              const cleanName = entry.replace(/[\\\\/]+$/g, '');
              const absolutePath = path.resolve(listPath, cleanName);
              let size: number | undefined;
              let modifiedAt: string | undefined;
              try {
                const stat = await fs.promises.stat(absolutePath);
                size = stat.isFile() ? stat.size : undefined;
                modifiedAt = stat.mtime.toISOString();
              } catch {
                // The PI output is still useful even if stat fails for a transient file.
              }
              return {
                name: cleanName,
                path: absolutePath,
                type: isDirectory ? 'directory' : 'file',
                size,
                modifiedAt,
              };
            }))`);
    // And prefix the `await Promise.all(` before `.split(/\r?\n/)` ... wait, the chain is:
    /*
          const files = stripAnsi(outputText)
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line && !/^\[.*\]$/.test(line))
            .map(async (entry) => {
    */
    content = content.replace(/const files = stripAnsi\(outputText\)\n\s*\.split/g, 'const files = await Promise.all(stripAnsi(outputText)\n            .split');
} else {
    console.log("Could not find the target block!");
}

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed await issues again');
