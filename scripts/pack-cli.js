const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.join(repoRoot, 'build');
fs.mkdirSync(outputDir, { recursive: true });

const result = spawnSync(
  'npm',
  ['pack', path.join(repoRoot, 'packages', 'ipcraft'), '--pack-destination', outputDir],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: path.join(outputDir, 'npm-cache') },
  }
);

if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
}
