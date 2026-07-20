const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const extensionVersion = require(path.join(repoRoot, 'package.json')).version;
const cliVersion = require(path.join(repoRoot, 'packages', 'ipcraft', 'package.json')).version;
const requestedVersion = process.env.RELEASE_VERSION;

if (process.env.EXTENSION_PUBLISHED !== 'true') {
  throw new Error('Confirm that the matching VS Code extension version is already published');
}

if (!requestedVersion) {
  throw new Error('RELEASE_VERSION is required');
}

if (extensionVersion !== requestedVersion || cliVersion !== requestedVersion) {
  throw new Error(
    `Requested ${requestedVersion}, extension ${extensionVersion}, and CLI ${cliVersion} must match`
  );
}
