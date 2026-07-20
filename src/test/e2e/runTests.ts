import * as fs from 'fs';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

function getMinimumVscodeVersion(extensionDevelopmentPath: string): string {
  const manifestPath = path.join(extensionDevelopmentPath, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    engines?: { vscode?: string };
  };
  const engineMatch = /^\^(\d+\.\d+\.\d+)$/.exec(manifest.engines?.vscode ?? '');

  if (!engineMatch) {
    throw new Error('engines.vscode must be a caret range such as ^1.80.0.');
  }

  return engineMatch[1];
}

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, '../../../');

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const vscodeVersion =
      process.env.VSCODE_TEST_VERSION ?? getMinimumVscodeVersion(extensionDevelopmentPath);

    // Download VS Code, unzip it and run the integration test
    await runTests({
      version: vscodeVersion,
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-dev-shm-usage',
        '--disable-extensions',
      ],
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

void main();
