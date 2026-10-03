import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { installCliShim } from '../../../services/CliInstaller';
import { cliScriptName } from '../../../services/CliShim';

async function waitForFile(file: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < deadline, `Activation did not write the launcher at ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite('Bundled CLI Test Suite', () => {
  test('Installed shim runs the activation-written launcher from a minimal environment', async function (this: Mocha.Context) {
    this.timeout(60000);
    const extension = vscode.extensions.getExtension('bahonavi.ipcraft-vscode');
    assert.ok(extension, 'Extension should be present');
    await extension.activate();

    assert.ok(
      fs.existsSync(path.join(extension.extensionPath, 'dist', 'cli.js')),
      'dist/cli.js is missing from the extension; run `npm run compile` (packaging regression)'
    );

    const userDataDir = process.env.IPCRAFT_E2E_USER_DATA_DIR;
    assert.ok(userDataDir, 'IPCRAFT_E2E_USER_DATA_DIR must be set by runTests.ts');
    const platform = process.platform;
    const launcher = path.join(
      userDataDir,
      'User',
      'globalStorage',
      'bahonavi.ipcraft-vscode',
      'bin',
      cliScriptName(platform)
    );
    // Activation writes the launcher fire-and-forget.
    await waitForFile(launcher, 10000);

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-e2e-'));
    try {
      const shim = await installCliShim(path.join(tmp, 'shim'), launcher, platform);

      // Mimic an external terminal: no ELECTRON_RUN_AS_NODE or other VS Code variables.
      const env: NodeJS.ProcessEnv =
        platform === 'win32'
          ? {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              USERPROFILE: process.env.USERPROFILE,
            }
          : { PATH: process.env.PATH, HOME: os.homedir() };
      const [file, args] =
        platform === 'win32'
          ? ['cmd.exe', ['/d', '/s', '/c', `"${shim}" --help`]]
          : [shim, ['--help']];
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          file,
          args,
          { env, windowsVerbatimArguments: platform === 'win32' },
          (error, out, err) =>
            error ? reject(new Error(`${error.message}\n${err}`)) : resolve(out)
        );
      });
      assert.ok(stdout.includes('ipcraft generate'), `Unexpected --help output:\n${stdout}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
