const { it } = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest } = require('../check-vsix');

it('requires the root license declaration and packaged license file', () => {
  assert.doesNotThrow(() =>
    validateManifest(
      { license: 'SEE LICENSE IN LICENSE' },
      new Set(['extension/LICENSE.txt'])
    )
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
