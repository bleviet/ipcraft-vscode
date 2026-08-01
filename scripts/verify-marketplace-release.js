const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const yauzl = require('yauzl');
const {
  MARKETPLACE_IDENTITY,
  getMarketplacePackageUrl,
  validatePublishedPackage,
} = require('./marketplace-release-contract');

const MAX_POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function pollForVersion(loadListing, version, options = {}) {
  const attempts = options.attempts ?? MAX_POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const sleep = options.sleep ?? wait;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const listing = await loadListing();
    if (listing?.versions?.some((item) => item.version === version)) {
      return listing;
    }
    if (attempt < attempts && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  throw new Error(`Marketplace version ${version} was not visible after ${attempts} attempts`);
}

async function downloadFile(
  url,
  outputPath,
  fetchImplementation = fetch,
  timeoutMs = DOWNLOAD_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to download published VSIX: ${response.status} ${response.statusText}`);
    }
    await fs.promises.writeFile(outputPath, Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Timed out downloading published VSIX after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function readVsixManifest(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, archive) => {
      if (openError) {
        reject(openError);
        return;
      }

      const archiveFiles = new Set();
      let packagedManifest;
      let settled = false;
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      archive.on('entry', (entry) => {
        if (entry.fileName.endsWith('/')) {
          archive.readEntry();
          return;
        }

        archiveFiles.add(entry.fileName);
        if (entry.fileName !== 'extension/package.json') {
          archive.readEntry();
          return;
        }

        archive.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }

          const chunks = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('error', fail);
          stream.on('end', () => {
            try {
              packagedManifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              archive.readEntry();
            } catch (error) {
              fail(error);
            }
          });
        });
      });
      archive.on('error', fail);
      archive.on('end', () => {
        if (settled) return;
        if (!packagedManifest) {
          fail(new Error('Published VSIX is missing extension/package.json'));
          return;
        }
        settled = true;
        resolve({ packagedManifest, archiveFiles });
      });
      archive.readEntry();
    });
  });
}

function loadMarketplaceListing() {
  const extensionName = `${MARKETPLACE_IDENTITY.publisher}.${MARKETPLACE_IDENTITY.name}`;
  const result = spawnSync('npx', ['vsce', 'show', extensionName, '--json'], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `npx vsce show exited with status ${result.status}`);
  }
  return JSON.parse(result.stdout);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag !== '--version' && flag !== '--out') || !value || values[flag]) {
      throw new Error('Usage: verify-marketplace-release --version <version> --out <output.vsix>');
    }
    values[flag] = value;
  }
  if (!values['--version'] || !values['--out']) {
    throw new Error('Usage: verify-marketplace-release --version <version> --out <output.vsix>');
  }
  return { version: values['--version'], out: values['--out'] };
}

async function main(argv = process.argv.slice(2)) {
  const { version, out } = parseArguments(argv);
  const listing = await pollForVersion(loadMarketplaceListing, version);
  await downloadFile(getMarketplacePackageUrl(version), out);
  const { packagedManifest, archiveFiles } = await readVsixManifest(out);
  validatePublishedPackage({ version, listing, packagedManifest, archiveFiles });
  process.stdout.write(`Downloaded and verified published VSIX: ${out}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { downloadFile, pollForVersion, readVsixManifest };
