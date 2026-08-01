const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { MARKETPLACE_IDENTITY, validateReleaseContract } = require('./marketplace-release-contract');

function loadMarketplace() {
  if (process.env.MARKETPLACE_METADATA_FILE) {
    return JSON.parse(fs.readFileSync(process.env.MARKETPLACE_METADATA_FILE, 'utf8'));
  }

  return JSON.parse(
    execFileSync(
      'npx',
      ['vsce', 'show', `${MARKETPLACE_IDENTITY.publisher}.${MARKETPLACE_IDENTITY.name}`, '--json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
      }
    )
  );
}

try {
  const repoRoot = path.resolve(__dirname, '..');
  const { version, extensionId } = validateReleaseContract({
    sourceBranch: process.env.BUILD_SOURCEBRANCH,
    extensionManifest: require(path.join(repoRoot, 'package.json')),
    cliManifest: require(path.join(repoRoot, 'packages', 'ipcraft', 'package.json')),
    changelog: fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8'),
    marketplace: loadMarketplace(),
  });

  process.stdout.write(`Release contract valid for ${extensionId} ${version}\n`);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
