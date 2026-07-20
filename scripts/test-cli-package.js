const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-smoke-'));
const consumerDir = path.join(tempRoot, 'consumer');
const npmCacheDir = path.join(tempRoot, 'npm-cache');
fs.mkdirSync(consumerDir);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCacheDir },
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`);
  }
  return result.stdout;
}

try {
  run(
    'npm',
    ['pack', path.join(repoRoot, 'packages', 'ipcraft'), '--pack-destination', tempRoot],
    repoRoot
  );
  const archives = fs.readdirSync(tempRoot).filter((name) => name.endsWith('.tgz'));
  if (archives.length !== 1) {
    throw new Error(`Expected one package archive, found ${archives.length}`);
  }

  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'ipcraft-clean-install-smoke', private: true }, null, 2)
  );
  run(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(tempRoot, archives[0])],
    consumerDir
  );

  const executable =
    process.platform === 'win32'
      ? path.join(consumerDir, 'node_modules', '.bin', 'ipcraft.cmd')
      : path.join(consumerDir, 'node_modules', '.bin', 'ipcraft');
  const help = run(executable, ['--help'], consumerDir);
  if (!help.includes('ipcraft generate') || !help.includes('ipcraft verify')) {
    throw new Error('Installed CLI help does not describe generate and verify');
  }

  fs.writeFileSync(
    path.join(consumerDir, 'smoke.ip.yml'),
    `apiVersion: '1.0'\nvlnv:
  vendor: test.com
  library: smoke
  name: smoke_core
  version: 1.0.0
description: Clean-install CLI smoke test
memoryMaps:
  import: smoke.mm.yml
`
  );
  fs.writeFileSync(
    path.join(consumerDir, 'smoke.mm.yml'),
    `- name: SMOKE_MAP
  addressBlocks:
    - name: REGS
      baseAddress: 0
      registers:
        - name: CTRL
          fields:
            - name: ENABLE
              bits: '[0:0]'
`
  );

  run(
    executable,
    ['generate', 'smoke.ip.yml', '--lang', 'vhdl', '--out', 'generated'],
    consumerDir
  );
  const generatedFiles = fs.readdirSync(path.join(consumerDir, 'generated'), {
    recursive: true,
  });
  if (generatedFiles.length === 0) {
    throw new Error('Installed CLI did not generate any files');
  }

  process.stdout.write('CLI package clean-install smoke test passed.\n');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
