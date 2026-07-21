const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

const COMPRESSED_BUDGET_BYTES = 2 * 1024 * 1024;
const UNPACKED_BUDGET_BYTES = 5 * 1024 * 1024;
const repoRoot = path.resolve(__dirname, '..');
const vsixPath = path.resolve(process.argv[2] ?? 'artifacts/ipcraft-vscode.vsix');

const exactAllowedFiles = new Set([
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/LICENSE.txt',
  'extension/changelog.md',
  'extension/package.json',
  'extension/readme.md',
  'extension/resources/concepts/icon-c-circle.md',
  'extension/resources/icon.png',
]);

const allowedPatterns = [
  /^extension\/dist\/(extension|webview|ipcore|dataInspector)\.js$/,
  /^extension\/dist\/(extension|webview|ipcore|dataInspector)\.js\.LICENSE\.txt$/,
  /^extension\/dist\/(webview|ipcore|dataInspector)\.css$/,
  /^extension\/dist\/[a-f0-9]+\.ttf$/,
  /^extension\/dist\/packs\/[A-Za-z0-9._/-]+\.(j2|md|yml)$/,
  /^extension\/dist\/resources\/bus_definitions\/[A-Za-z0-9._-]+\.yml$/,
  /^extension\/dist\/resources\/schemas\/[A-Za-z0-9._-]+\.json$/,
  /^extension\/dist\/templates\/[A-Za-z0-9._-]+\.j2$/,
  /^extension\/media\/walkthrough\/[A-Za-z0-9._/-]+\.md$/,
];

const requiredFiles = new Set([
  ...exactAllowedFiles,
  'extension/dist/extension.js',
  'extension/dist/webview.js',
  'extension/dist/webview.css',
  'extension/dist/ipcore.js',
  'extension/dist/ipcore.css',
  'extension/dist/dataInspector.js',
  'extension/dist/dataInspector.css',
]);

function addRequiredTree(sourceDir, archiveDir) {
  const absoluteSourceDir = path.join(repoRoot, sourceDir);
  for (const entry of fs.readdirSync(absoluteSourceDir, { withFileTypes: true })) {
    const relativePath = path.join(sourceDir, entry.name);
    const archivePath = `${archiveDir}/${entry.name}`;
    if (entry.isDirectory()) {
      addRequiredTree(relativePath, archivePath);
    } else {
      requiredFiles.add(archivePath.replaceAll(path.sep, '/'));
    }
  }
}

addRequiredTree('src/generator/templates', 'extension/dist/templates');
addRequiredTree('src/generator/packs', 'extension/dist/packs');
addRequiredTree('ipcraft-spec/bus_definitions', 'extension/dist/resources/bus_definitions');
addRequiredTree('media/walkthrough', 'extension/media/walkthrough');
for (const schema of [
  'data_inspector.schema.json',
  'ip_core.schema.json',
  'memory_map.schema.json',
]) {
  requiredFiles.add(`extension/dist/resources/schemas/${schema}`);
}

function readArchive(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError) {
        reject(openError);
        return;
      }

      const entries = [];
      zipFile.on('entry', (entry) => {
        if (!entry.fileName.endsWith('/')) {
          entries.push({ name: entry.fileName, size: entry.uncompressedSize });
        }
        zipFile.readEntry();
      });
      zipFile.on('end', () => resolve(entries));
      zipFile.on('error', reject);
      zipFile.readEntry();
    });
  });
}

async function main() {
  if (!fs.existsSync(vsixPath)) {
    throw new Error(`VSIX not found: ${vsixPath}`);
  }

  const entries = await readArchive(vsixPath);
  const archiveFiles = new Set(entries.map((entry) => entry.name));
  const duplicateFiles = entries
    .map((entry) => entry.name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  const unexpectedFiles = entries
    .map((entry) => entry.name)
    .filter(
      (name) =>
        !exactAllowedFiles.has(name) && !allowedPatterns.some((pattern) => pattern.test(name))
    );
  const missingFiles = [...requiredFiles].filter((name) => !archiveFiles.has(name));
  const compressedBytes = fs.statSync(vsixPath).size;
  const unpackedBytes = entries.reduce((total, entry) => total + entry.size, 0);

  process.stdout.write(
    `${entries
      .map((entry) => entry.name)
      .sort()
      .join('\n')}\n`
  );
  process.stdout.write(
    `VSIX size: ${compressedBytes} compressed bytes, ${unpackedBytes} unpacked bytes\n`
  );
  process.stdout.write(
    `VSIX budget: ${COMPRESSED_BUDGET_BYTES} compressed bytes, ${UNPACKED_BUDGET_BYTES} unpacked bytes\n`
  );

  const errors = [];
  if (duplicateFiles.length > 0) {
    errors.push(`Duplicate archive files:\n${duplicateFiles.join('\n')}`);
  }
  if (unexpectedFiles.length > 0) {
    errors.push(`Files outside the production allowlist:\n${unexpectedFiles.join('\n')}`);
  }
  if (missingFiles.length > 0) {
    errors.push(`Required runtime files are missing:\n${missingFiles.join('\n')}`);
  }
  if (compressedBytes > COMPRESSED_BUDGET_BYTES) {
    errors.push(`Compressed size exceeds the ${COMPRESSED_BUDGET_BYTES}-byte budget`);
  }
  if (unpackedBytes > UNPACKED_BUDGET_BYTES) {
    errors.push(`Unpacked size exceeds the ${UNPACKED_BUDGET_BYTES}-byte budget`);
  }
  if (errors.length > 0) {
    throw new Error(errors.join('\n\n'));
  }

  process.stdout.write('VSIX contents and size are within the production contract.\n');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
