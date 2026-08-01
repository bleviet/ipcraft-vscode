const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yazl = require('yazl');
const {
  MARKETPLACE_IDENTITY,
  getMarketplacePackageUrl,
  validatePublishedPackage,
} = require('../marketplace-release-contract');
const {
  downloadFile,
  pollForVersion,
  readVsixManifest,
} = require('../verify-marketplace-release');

const expectedShortDescription =
  'Visual FPGA IP-core and memory-map editor with VHDL/SystemVerilog, Vivado, and Quartus project generation.';

function createPublishedPackageInput(overrides = {}) {
  return {
    version: '1.2.3',
    listing: {
      publisher: { publisherId: MARKETPLACE_IDENTITY.publisherId, publisherName: 'bahonavi' },
      extensionId: MARKETPLACE_IDENTITY.extensionId,
      extensionName: 'ipcraft-vscode',
      displayName: 'IPCraft for VS Code',
      shortDescription: expectedShortDescription,
      versions: [{ version: '1.2.3' }],
      categories: ['Programming Languages', 'Visualization'],
    },
    packagedManifest: {
      name: 'ipcraft-vscode',
      publisher: 'bahonavi',
      version: '1.2.3',
      license: 'MIT',
      description: expectedShortDescription,
      icon: 'resources/icon.png',
      repository: { url: 'git+https://github.com/bleviet/ipcraft-vscode.git' },
      homepage: 'https://github.com/bleviet/ipcraft-vscode#readme',
      bugs: { url: 'https://github.com/bleviet/ipcraft-vscode/issues' },
      categories: ['Programming Languages', 'Visualization', 'Other'],
      contributes: { commands: [{ command: 'fpga-ip-core.createIpCore' }] },
    },
    archiveFiles: new Set([
      'extension/LICENSE.txt',
      'extension/readme.md',
      'extension/changelog.md',
      'extension/resources/icon.png',
    ]),
    ...overrides,
  };
}

describe('published Marketplace package verification', () => {
  it('accepts the expected public listing and packaged manifest', () => {
    assert.deepEqual(
      validatePublishedPackage(createPublishedPackageInput()),
      { version: '1.2.3', extensionId: 'bahonavi.ipcraft-vscode' }
    );
  });

  it('accepts a Marketplace short description supplied by the packaged manifest', () => {
    const input = createPublishedPackageInput();
    input.packagedManifest.description = 'Description supplied by the packaged manifest.';
    input.listing.shortDescription = 'Description supplied by the packaged manifest.';

    assert.doesNotThrow(() => validatePublishedPackage(input));
  });

  it('reports a listing without the README, license, and commands together', () => {
    const invalidInput = createPublishedPackageInput({
      listing: {
        ...createPublishedPackageInput().listing,
        displayName: 'Wrong name',
        categories: ['Other'],
      },
      packagedManifest: {
        ...createPublishedPackageInput().packagedManifest,
        license: 'Apache-2.0',
        contributes: { commands: [] },
      },
      archiveFiles: new Set(['extension/LICENSE.txt']),
    });

    assert.throws(
      () => validatePublishedPackage(invalidInput),
      /README[\s\S]*MIT SPDX license[\s\S]*commands/
    );
  });

  it('rejects a listing whose short description differs from the packaged manifest', () => {
    const input = createPublishedPackageInput({
      listing: {
        ...createPublishedPackageInput().listing,
        shortDescription: 'Visual FPGA editor',
      },
    });

    assert.throws(
      () => validatePublishedPackage(input),
      /Marketplace short description must match the packaged manifest/
    );
  });

  it('constructs the exact public vspackage URL', () => {
    assert.equal(
      getMarketplacePackageUrl('1.2.3'),
      'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/bahonavi/vsextensions/ipcraft-vscode/1.2.3/vspackage'
    );
  });
});

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-marketplace-release-'));
}

function writeVsix(archivePath, manifest) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    archive.addBuffer(Buffer.from(JSON.stringify(manifest)), 'extension/package.json');
    archive.addBuffer(Buffer.from('license'), 'extension/LICENSE.txt');
    archive.addBuffer(Buffer.from('readme'), 'extension/readme.md');
    archive.addBuffer(Buffer.from('changelog'), 'extension/changelog.md');
    archive.addBuffer(Buffer.from('icon'), 'extension/resources/icon.png');
    archive.outputStream
      .pipe(fs.createWriteStream(archivePath))
      .on('close', resolve)
      .on('error', reject);
    archive.end();
  });
}

describe('Marketplace verification CLI helpers', () => {
  it('retries a Marketplace listing until the requested version is visible', async () => {
    let calls = 0;
    const listing = await pollForVersion(
      async () => {
        calls += 1;
        return calls === 3 ? { versions: [{ version: '1.2.3' }] } : { versions: [] };
      },
      '1.2.3',
      { attempts: 12, intervalMs: 0 }
    );

    assert.equal(calls, 3);
    assert.deepEqual(listing, { versions: [{ version: '1.2.3' }] });
  });

  it('writes the downloaded VSIX bytes to the explicit output file', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputPath = path.join(temporaryDirectory, 'marketplace-1.2.3.vsix');

    try {
      await downloadFile('https://example.invalid/marketplace.vsix', outputPath, async () =>
        new Response(Buffer.from('vsix-bytes'), { status: 200 })
      );

      assert.deepEqual(fs.readFileSync(outputPath), Buffer.from('vsix-bytes'));
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('fails with a concise error when a Marketplace download exceeds its timeout', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputPath = path.join(temporaryDirectory, 'marketplace-1.2.3.vsix');

    try {
      const result = await Promise.race([
        downloadFile(
          'https://example.invalid/marketplace.vsix',
          outputPath,
          async (_url, { signal }) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('request aborted')));
            }),
          5
        ).then(
          () => undefined,
          (error) => error
        ),
        new Promise((resolve) => setTimeout(() => resolve(undefined), 50)),
      ]);

      assert.ok(result instanceof Error, 'download did not time out');
      assert.match(result.message, /Timed out downloading published VSIX after 5ms/);
      assert.equal(fs.existsSync(outputPath), false);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects a non-2xx Marketplace download response', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const outputPath = path.join(temporaryDirectory, 'marketplace-1.2.3.vsix');

    try {
      await assert.rejects(
        downloadFile('https://example.invalid/marketplace.vsix', outputPath, async () =>
          new Response('not found', { status: 404, statusText: 'Not Found' })
        ),
        /Failed to download published VSIX: 404 Not Found/
      );
      assert.equal(fs.existsSync(outputPath), false);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('reads the packaged manifest and every file from a downloaded VSIX', async () => {
    const temporaryDirectory = createTemporaryDirectory();
    const archivePath = path.join(temporaryDirectory, 'marketplace-1.2.3.vsix');
    const manifest = { name: 'ipcraft-vscode', publisher: 'bahonavi', version: '1.2.3' };

    try {
      await writeVsix(archivePath, manifest);
      const result = await readVsixManifest(archivePath);

      assert.deepEqual(result.packagedManifest, manifest);
      assert.deepEqual([...result.archiveFiles].sort(), [
        'extension/LICENSE.txt',
        'extension/changelog.md',
        'extension/package.json',
        'extension/readme.md',
        'extension/resources/icon.png',
      ]);
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
