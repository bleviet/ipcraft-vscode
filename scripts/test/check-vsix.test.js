const { it } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { validateManifest } = require('../check-vsix');

const repoRoot = path.resolve(__dirname, '..', '..');

it('requires the root license declaration and packaged license file', () => {
  assert.doesNotThrow(() =>
    validateManifest({ license: 'SEE LICENSE IN LICENSE' }, new Set(['extension/LICENSE.txt']))
  );
  assert.throws(
    () => validateManifest({ license: 'MIT' }, new Set(['extension/LICENSE.txt'])),
    /SEE LICENSE IN LICENSE/
  );
  assert.throws(
    () => validateManifest({ license: 'SEE LICENSE IN LICENSE' }, new Set()),
    /extension\/LICENSE.txt/
  );
});

it('excludes the release pipeline from the packaged file set', () => {
  const vscePath = path.join(repoRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
  const packagedFiles = execFileSync(process.execPath, [vscePath, 'ls', '--no-dependencies'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .trim()
    .split('\n');

  assert.equal(packagedFiles.includes('azure-pipelines/marketplace-release.yml'), false);
});
