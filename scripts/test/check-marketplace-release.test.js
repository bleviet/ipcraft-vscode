const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const extensionVersion = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
).version;
const tempDirectories = [];

afterEach(() => {
  for (const tempDirectory of tempDirectories.splice(0)) {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
});

function writeMarketplaceMetadata(metadata) {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-release-test-'));
  const metadataFile = path.join(tempDirectory, 'marketplace.json');
  fs.writeFileSync(metadataFile, JSON.stringify(metadata));
  tempDirectories.push(tempDirectory);
  return metadataFile;
}

function runPreflight(metadata) {
  return spawnSync(process.execPath, ['scripts/check-marketplace-release.js'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      BUILD_SOURCEBRANCH: `refs/tags/v${extensionVersion}`,
      MARKETPLACE_METADATA_FILE: writeMarketplaceMetadata(metadata),
    },
  });
}

const marketplace = {
  publisher: { publisherId: '68ba6820-f472-413e-8a4f-4be6765ede40', publisherName: 'bahonavi' },
  extensionId: '98c7d872-c2ba-4955-8ee5-5bf5e193ef78',
  extensionName: 'ipcraft-vscode',
  versions: [],
};

describe('check-marketplace-release', () => {
  it('prints the validated extension identity and version', () => {
    const result = runPreflight(marketplace);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      result.stdout.trim(),
      `Release contract valid for bahonavi.ipcraft-vscode ${extensionVersion}`
    );
  });

  it('fails when the Marketplace version already exists', () => {
    const result = runPreflight({
      ...marketplace,
      versions: [{ version: extensionVersion }],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already exists/);
  });
});
