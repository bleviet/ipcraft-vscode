import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { downloadAndUnzipVSCode, runTests, runVSCodeCommand } from '@vscode/test-electron';

const DOWNLOAD_ONLY_ENV = 'IPCRAFT_VSCODE_DOWNLOAD_ONLY';
const DOWNLOAD_ATTEMPTS = 3;

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

function runDownloadProcess(vscodeVersion: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename], {
      env: {
        ...process.env,
        [DOWNLOAD_ONLY_ENV]: '1',
        VSCODE_TEST_VERSION: vscodeVersion,
      },
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      const outcome = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
      reject(new Error(`VS Code download process failed with ${outcome}.`));
    });
  });
}

export async function downloadVscodeWithRetry(
  vscodeVersion: string,
  runDownload: (version: string) => Promise<void> = runDownloadProcess
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await runDownload(vscodeVersion);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < DOWNLOAD_ATTEMPTS) {
        console.warn(
          `VS Code download failed (attempt ${attempt} of ${DOWNLOAD_ATTEMPTS}); retrying.`
        );
      }
    }
  }

  throw lastError;
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
    const vsixPath = process.env.VSIX_PATH ? path.resolve(process.env.VSIX_PATH) : undefined;

    if (process.env[DOWNLOAD_ONLY_ENV] === '1') {
      await downloadAndUnzipVSCode(vscodeVersion);
      return;
    }

    // @vscode/test-electron 2.x can turn an interrupted checksum stream into an
    // unhandled rejection before its internal retry completes. Isolating the
    // download lets the parent retry that failure without retrying smoke tests.
    await downloadVscodeWithRetry(vscodeVersion);

    if (vsixPath) {
      if (!fs.existsSync(vsixPath)) {
        throw new Error(`VSIX not found: ${vsixPath}`);
      }
      await runVSCodeCommand(['--install-extension', vsixPath, '--force'], {
        version: vscodeVersion,
      });
    }

    // Download VS Code, unzip it and run the integration test
    await runTests({
      version: vscodeVersion,
      extensionDevelopmentPath: vsixPath
        ? path.join(extensionDevelopmentPath, 'src', 'test', 'e2e', 'harness')
        : extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        '--disable-gpu',
        '--no-sandbox',
        '--disable-gpu-sandbox',
        '--disable-dev-shm-usage',
        ...(vsixPath ? [] : ['--disable-extensions']),
      ],
    });
  } catch (err) {
    console.error('Failed to run tests', err);
    process.exit(1);
  }
}

if (require.main === module) {
  void main();
}
