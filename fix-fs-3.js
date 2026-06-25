const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');
let lines = content.split('\n');

for (let i = 982; i >= 900; i--) {
    if (lines[i].includes('function ') || lines[i].includes('=>')) {
        console.log('Enclosing at line ' + (i+1) + ': ' + lines[i]);
        break;
    }
}
