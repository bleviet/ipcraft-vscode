const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const extensionManifest = require(path.join(repoRoot, 'package.json'));
const cliManifest = require(path.join(repoRoot, 'packages', 'ipcraft', 'package.json'));

if (extensionManifest.bin) {
  throw new Error('The VS Code extension manifest must not advertise a shell binary');
}

if (cliManifest.name !== 'ipcraft' || cliManifest.bin?.ipcraft !== 'dist/cli.js') {
  throw new Error('The standalone package must expose dist/cli.js as the ipcraft binary');
}

// Issue #206: the VSIX must ship dist/cli.js (run via VS Code's own Electron/Node
// runtime — see src/services/cliInstall/) so `ipcraft` works after a Marketplace
// install with no separate Node.js/npm release required.
const vscodeignore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8');
const excludedCliPaths = vscodeignore
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line === 'dist/cli.js' || line === 'dist/cli.js.LICENSE.txt');
if (excludedCliPaths.length > 0) {
  throw new Error('.vscodeignore must not exclude dist/cli.js — the VSIX must ship the CLI bundle');
}

for (const relativePath of ['README.md', path.join('docs', 'reference', 'generator.md')]) {
  const contents = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  if (contents.includes('npx ipcraft')) {
    throw new Error(`${relativePath} advertises the CLI before its npm release`);
  }
}
