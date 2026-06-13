const fs = require('fs');
const path = require('path');

const transcriptPath = 'C:/Users/srini/.gemini/antigravity/brain/c8e14d7b-bba5-450f-acac-b477edccde1b/.system_generated/logs/transcript.jsonl';
const outputPath = path.join(__dirname, 'history.txt');

try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n');
    let output = '';
    
    lines.forEach((line, index) => {
        if (!line.trim()) return;
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'USER_INPUT') {
                output += `=== STEP ${parsed.step_index} (${parsed.created_at}) ===\n`;
                output += `${parsed.content}\n\n`;
            }
        } catch (e) {
            output += `=== ERROR PARSING LINE ${index} ===\n${line.slice(0, 100)}...\n\n`;
        }
    });
    
    fs.writeFileSync(outputPath, output, 'utf8');
    console.log('Successfully wrote history to ' + outputPath);
} catch (err) {
    console.error('Error:', err);
}
