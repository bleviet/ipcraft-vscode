const fs = require('fs');
const log = fs.readFileSync('bus_interfaces_eslint.log', 'utf8');
const lines = log.split('\n');
const file = 'src/webview/ipcore/components/sections/BusInterfacesEditor.tsx';
let contentLines = fs.readFileSync(file, 'utf8').split('\n');

for (const line of lines) {
    if (line.includes('prefer-nullish-coalescing')) {
        const match = line.match(/:(\d+):\d+:/);
        if (match) {
            const lineNum = parseInt(match[1], 10) - 1;
            contentLines[lineNum] = contentLines[lineNum].replace('||', '??');
        }
    }
}
fs.writeFileSync(file, contentLines.join('\n'));
