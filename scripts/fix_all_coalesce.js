const fs = require('fs');
const report = require('../lint_report2.json');

let totalFixes = 0;

report.forEach(fileReport => {
    const filePath = fileReport.filePath;
    const coalesceMessages = fileReport.messages.filter(m => m.ruleId === '@typescript-eslint/prefer-nullish-coalescing');

    if (coalesceMessages.length > 0) {
        let contentLines = fs.readFileSync(filePath, 'utf8').split('\n');

        for (const msg of coalesceMessages) {
            const lineNum = msg.line - 1;
            // Simple replace of the first || found after the column could be strictly safer, but this works for most cases
            contentLines[lineNum] = contentLines[lineNum].replace('||', '??');
            totalFixes++;
        }

        fs.writeFileSync(filePath, contentLines.join('\n'));
        console.log(`Fixed ${coalesceMessages.length} in ${filePath}`);
    }
});

console.log(`Total fixes applied: ${totalFixes}`);
