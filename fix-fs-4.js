const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'main/agent/tools/pi-tools.ts');
let content = fs.readFileSync(file, 'utf8');
let lines = content.split('\n');

for (let i = 960; i <= 990; i++) {
    console.log(i+1 + ': ' + lines[i]);
}
