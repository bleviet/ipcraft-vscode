const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const packageRoot = path.join(repoRoot, 'packages', 'ipcraft');
const sourceDist = path.join(repoRoot, 'dist');
const targetDist = path.join(packageRoot, 'dist');

const rootManifest = require(path.join(repoRoot, 'package.json'));
const cliManifest = require(path.join(packageRoot, 'package.json'));

if (rootManifest.version !== cliManifest.version) {
  throw new Error(
    `CLI version ${cliManifest.version} does not match extension version ${rootManifest.version}`
  );
}

const requiredPaths = [
  'cli.js',
  'packs',
  'templates',
  path.join('resources', 'bus_definitions'),
  path.join('resources', 'schemas'),
];

for (const relativePath of requiredPaths) {
  const sourcePath = path.join(sourceDist, relativePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing ${sourcePath}; run npm run package first`);
  }
}

fs.rmSync(targetDist, { recursive: true, force: true });
fs.mkdirSync(targetDist, { recursive: true });

for (const relativePath of requiredPaths) {
  fs.cpSync(path.join(sourceDist, relativePath), path.join(targetDist, relativePath), {
    recursive: true,
  });
}

fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(packageRoot, 'LICENSE'));
