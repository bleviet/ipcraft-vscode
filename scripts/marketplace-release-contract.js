const MARKETPLACE_IDENTITY = Object.freeze({
  publisher: 'bahonavi',
  name: 'ipcraft-vscode',
  publisherId: '68ba6820-f472-413e-8a4f-4be6765ede40',
  extensionId: '98c7d872-c2ba-4955-8ee5-5bf5e193ef78',
});
const MARKETPLACE_SHORT_DESCRIPTION =
  'Visual FPGA IP-core and memory-map editor with VHDL/SystemVerilog, Vivado, and Quartus project generation.';

function parseVersionTag(sourceBranch) {
  const match = /^refs\/tags\/v(\d+\.\d+\.\d+)$/.exec(sourceBranch ?? '');
  if (!match) throw new Error('Build.SourceBranch must be an exact v<major>.<minor>.<patch> tag');
  return match[1];
}

function validateReleaseContract(input) {
  const errors = [];
  const version = parseVersionTag(input.sourceBranch);
  const manifest = input.extensionManifest;

  if (manifest.version !== version) {
    errors.push(`tag version ${version} does not match extension version ${manifest.version}`);
  }
  if (input.cliManifest.version !== manifest.version) {
    errors.push(`CLI version ${input.cliManifest.version} does not match extension version ${manifest.version}`);
  }
  if (manifest.publisher !== MARKETPLACE_IDENTITY.publisher) {
    errors.push(`publisher must be ${MARKETPLACE_IDENTITY.publisher}`);
  }
  if (manifest.name !== MARKETPLACE_IDENTITY.name) {
    errors.push(`extension name must be ${MARKETPLACE_IDENTITY.name}`);
  }
  if (manifest.license !== 'MIT') {
    errors.push('license must be the MIT SPDX license');
  }
  if (!new RegExp(`^## \\[${version.replaceAll('.', '\\.') }\\] - `, 'm').test(input.changelog)) {
    errors.push(`CHANGELOG must contain a ${version} release heading`);
  }
  if (input.marketplace.publisher?.publisherId !== MARKETPLACE_IDENTITY.publisherId) {
    errors.push('Marketplace publisher ID does not match the release contract');
  }
  if (input.marketplace.extensionId !== MARKETPLACE_IDENTITY.extensionId) {
    errors.push('Marketplace extension ID does not match the release contract');
  }
  if (!Array.isArray(input.marketplace.versions)) {
    errors.push('Marketplace versions must be an array');
  } else if (input.marketplace.versions.some((item) => item.version === version)) {
    errors.push(`Marketplace version ${version} already exists`);
  }
  if (errors.length) throw new Error(errors.join('\n'));

  return { version, extensionId: `${manifest.publisher}.${manifest.name}` };
}

function getMarketplacePackageUrl(version) {
  return [
    'https://marketplace.visualstudio.com/_apis/public/gallery/publishers',
    encodeURIComponent(MARKETPLACE_IDENTITY.publisher),
    'vsextensions',
    encodeURIComponent(MARKETPLACE_IDENTITY.name),
    encodeURIComponent(version),
    'vspackage',
  ].join('/');
}

function validatePublishedPackage({ version, listing, packagedManifest, archiveFiles }) {
  const errors = [];
  const requiredArchiveFiles = [
    'extension/readme.md',
    'extension/LICENSE.txt',
    'extension/changelog.md',
    'extension/resources/icon.png',
  ];

  for (const file of requiredArchiveFiles) {
    if (!archiveFiles.has(file)) {
      errors.push(`Published VSIX is missing ${file === 'extension/readme.md' ? 'README' : file}`);
    }
  }

  if (packagedManifest.license !== 'MIT') {
    errors.push('Published manifest license must be the MIT SPDX license');
  }
  if (packagedManifest.publisher !== MARKETPLACE_IDENTITY.publisher) {
    errors.push(`Published manifest publisher must be ${MARKETPLACE_IDENTITY.publisher}`);
  }
  if (packagedManifest.name !== MARKETPLACE_IDENTITY.name) {
    errors.push(`Published manifest extension name must be ${MARKETPLACE_IDENTITY.name}`);
  }
  if (packagedManifest.version !== version) {
    errors.push(`Published manifest version ${packagedManifest.version} does not match ${version}`);
  }
  if (packagedManifest.icon !== 'resources/icon.png') {
    errors.push('Published manifest icon must be resources/icon.png');
  }
  if (packagedManifest.repository?.url !== 'git+https://github.com/bleviet/ipcraft-vscode.git') {
    errors.push('Published manifest repository URL does not match the release contract');
  }
  if (packagedManifest.homepage !== 'https://github.com/bleviet/ipcraft-vscode#readme') {
    errors.push('Published manifest homepage does not match the release contract');
  }
  if (packagedManifest.bugs?.url !== 'https://github.com/bleviet/ipcraft-vscode/issues') {
    errors.push('Published manifest bugs URL does not match the release contract');
  }
  if (!['Programming Languages', 'Visualization', 'Other'].every((category) => packagedManifest.categories?.includes(category))) {
    errors.push('Published manifest categories must include Programming Languages, Visualization, and Other');
  }
  if (!packagedManifest.contributes?.commands?.length) {
    errors.push('Published manifest must contribute commands');
  }

  if (listing.publisher?.publisherId !== MARKETPLACE_IDENTITY.publisherId) {
    errors.push('Marketplace publisher ID does not match the release contract');
  }
  if (listing.publisher?.publisherName !== MARKETPLACE_IDENTITY.publisher) {
    errors.push(`Marketplace publisher name must be ${MARKETPLACE_IDENTITY.publisher}`);
  }
  if (listing.extensionId !== MARKETPLACE_IDENTITY.extensionId) {
    errors.push('Marketplace extension ID does not match the release contract');
  }
  if (listing.extensionName !== MARKETPLACE_IDENTITY.name) {
    errors.push(`Marketplace extension name must be ${MARKETPLACE_IDENTITY.name}`);
  }
  if (listing.displayName !== 'IPCraft for VS Code') {
    errors.push('Marketplace display name must be IPCraft for VS Code');
  }
  if (listing.shortDescription !== MARKETPLACE_SHORT_DESCRIPTION) {
    errors.push('Marketplace short description must match the release contract');
  }
  if (!listing.versions?.some((item) => item.version === version)) {
    errors.push(`Marketplace listing does not contain version ${version}`);
  }
  if (!['Programming Languages', 'Visualization'].every((category) => listing.categories?.includes(category))) {
    errors.push('Marketplace categories must include Programming Languages and Visualization');
  }

  if (errors.length) throw new Error(errors.join('\n'));

  return { version, extensionId: `${MARKETPLACE_IDENTITY.publisher}.${MARKETPLACE_IDENTITY.name}` };
}

module.exports = {
  MARKETPLACE_IDENTITY,
  getMarketplacePackageUrl,
  parseVersionTag,
  validatePublishedPackage,
  validateReleaseContract,
};
