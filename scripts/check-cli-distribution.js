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

for (const relativePath of ['README.md', path.join('docs', 'reference', 'generator.md')]) {
  const contents = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  if (contents.includes('npx ipcraft')) {
    throw new Error(`${relativePath} advertises the CLI before its npm release`);
  }
}

const vscodeIgnore = fs.readFileSync(path.join(repoRoot, '.vscodeignore'), 'utf8');
if (vscodeIgnore.split(/\r?\n/).some((line) => line.trim().startsWith('dist/cli.js'))) {
  throw new Error('.vscodeignore must not exclude dist/cli.js; the VSIX ships the CLI');
}

const contributedCommands = new Set(
  (extensionManifest.contributes?.commands ?? []).map((entry) => entry.command)
);
for (const command of ['fpga-ip-core.installCliInPath', 'fpga-ip-core.uninstallCliFromPath']) {
  if (!contributedCommands.has(command)) {
    throw new Error(`The extension manifest must contribute ${command}`);
  }
}

if (!(extensionManifest.activationEvents ?? []).includes('onStartupFinished')) {
  throw new Error('activationEvents must include onStartupFinished so the CLI reaches PATH');
}
