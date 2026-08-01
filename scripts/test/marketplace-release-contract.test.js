const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  MARKETPLACE_IDENTITY,
  parseVersionTag,
  validateReleaseContract,
} = require('../marketplace-release-contract');

const extensionManifest = {
  name: 'ipcraft-vscode',
  publisher: 'bahonavi',
  version: '1.2.3',
  license: 'MIT',
};
const cliManifest = { version: '1.2.3' };
const marketplace = {
  publisher: { publisherId: MARKETPLACE_IDENTITY.publisherId, publisherName: 'bahonavi' },
  extensionId: MARKETPLACE_IDENTITY.extensionId,
  extensionName: 'ipcraft-vscode',
  versions: [{ version: '1.2.2' }],
};

describe('validateReleaseContract', () => {
  it('accepts an unpublished version selected by an exact tag', () => {
    assert.deepEqual(
      validateReleaseContract({
        sourceBranch: 'refs/tags/v1.2.3',
        extensionManifest,
        cliManifest,
        changelog: '## [1.2.3] - 2026-07-31\n',
        marketplace,
      }),
      { version: '1.2.3', extensionId: 'bahonavi.ipcraft-vscode' }
    );
  });

  it('rejects a non-tag ref', () => {
    assert.throws(() => parseVersionTag('refs/heads/main'), /exact v<major>.<minor>.<patch> tag/);
  });

  it('rejects a Marketplace response without a versions array', () => {
    assert.throws(
      () =>
        validateReleaseContract({
          sourceBranch: 'refs/tags/v1.2.3',
          extensionManifest,
          cliManifest,
          changelog: '## [1.2.3] - 2026-07-31\n',
          marketplace: { ...marketplace, versions: undefined },
        }),
      /Marketplace versions must be an array/
    );
  });

  it('rejects a Marketplace response with a malformed versions value', () => {
    assert.throws(
      () =>
        validateReleaseContract({
          sourceBranch: 'refs/tags/v1.2.3',
          extensionManifest,
          cliManifest,
          changelog: '## [1.2.3] - 2026-07-31\n',
          marketplace: { ...marketplace, versions: '1.2.2' },
        }),
      /Marketplace versions must be an array/
    );
  });

  it('reports tag, CLI, identity, license, changelog, and duplicate failures together', () => {
    assert.throws(
      () =>
        validateReleaseContract({
          sourceBranch: 'refs/tags/v1.2.4',
          extensionManifest: { ...extensionManifest, publisher: 'wrong', license: 'Apache-2.0' },
          cliManifest: { version: '1.2.2' },
          changelog: '# Changelog\n',
          marketplace: { ...marketplace, versions: [{ version: '1.2.4' }] },
        }),
      (error) => {
        assert.match(error.message, /tag version 1.2.4/);
        assert.match(error.message, /CLI version 1.2.2/);
        assert.match(error.message, /publisher/);
        assert.match(error.message, /MIT SPDX license/);
        assert.match(error.message, /CHANGELOG/);
        assert.match(error.message, /already exists/);
        return true;
      }
    );
  });
});
