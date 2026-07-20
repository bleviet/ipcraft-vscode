const manifest = require('../package.json');

const engineRange = manifest.engines?.vscode;
const engineMatch = /^\^(\d+\.\d+\.\d+)$/.exec(engineRange ?? '');

if (!engineMatch) {
  console.error('engines.vscode must be a caret range such as ^1.80.0.');
  process.exit(1);
}

const minimumVersion = engineMatch[1];
const vscodeTypesVersion = manifest.devDependencies?.['@types/vscode'];

if (vscodeTypesVersion !== minimumVersion) {
  console.error(
    `@types/vscode must be pinned to ${minimumVersion} to match engines.vscode ${engineRange}.`
  );
  process.exit(1);
}

console.log(`VS Code compatibility floor is ${minimumVersion}.`);
