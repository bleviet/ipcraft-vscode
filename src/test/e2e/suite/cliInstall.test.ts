/* eslint-disable */
/**
 * Issue #206 fresh-install e2e coverage: after activation, the `ipcraft` CLI launcher
 * must exist on disk and run standalone — no separate Node.js install, and (for the
 * integrated terminal case) no manual PATH setup either.
 *
 * These assertions exercise the real, built `dist/cli.js` bundle: with VSIX_PATH set
 * (see runTests.ts), that is the CLI shipped inside the packaged VSIX; without it, the
 * CLI built alongside the extension under test.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import * as vscode from 'vscode';

const EXTENSION_ID = 'bahonavi.ipcraft-vscode';
const FIXTURES_DIR = path.resolve(__dirname, '../fixtures');

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runFile(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(command, args, { env }, (error, stdout, stderr) => {
      const code =
        error === null
          ? 0
          : typeof (error as NodeJS.ErrnoException).code === 'number'
            ? (error as unknown as { code: number }).code
            : 1;
      resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
    });
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!predicate()) {
    throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
  }
}

suite('CLI in PATH (issue #206)', () => {
  let cliLauncherPath: string;

  suiteSetup(async function (this: Mocha.Context) {
    this.timeout(30000);
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'IPCraft extension should be discoverable');

    const api = (await extension!.activate()) as { cliLauncherPath?: string } | undefined;
    assert.ok(api?.cliLauncherPath, 'activate() should export cliLauncherPath');
    cliLauncherPath = api!.cliLauncherPath!;

    // refreshLauncher writes the file asynchronously (fire-and-forget from activate());
    // wait for it to land, plus a short buffer for the PATH prepend call that follows it.
    await waitUntil(() => fs.existsSync(cliLauncherPath), 15000);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  test('the launcher exists, is executable, and references the current runtime', function () {
    const stat = fs.statSync(cliLauncherPath);
    assert.ok(stat.isFile(), `${cliLauncherPath} should be a file`);
    if (process.platform !== 'win32') {
      assert.strictEqual(stat.mode & 0o111, 0o111, 'launcher should be executable by everyone');
    }
    const content = fs.readFileSync(cliLauncherPath, 'utf8');
    assert.ok(content.includes('ELECTRON_RUN_AS_NODE=1'));
    assert.ok(content.includes(process.execPath));
  });

  test('running the launcher directly works with no Node.js on PATH', async function (this: Mocha.Context) {
    this.timeout(20000);
    if (process.platform === 'win32') {
      this.skip();
      return;
    }

    const result = await runFile(cliLauncherPath, ['--help'], {
      PATH: '/usr/bin:/bin',
      HOME: os.homedir(),
    });
    assert.strictEqual(
      result.code,
      0,
      `expected exit 0, got ${result.code}. stdout=${result.stdout} stderr=${result.stderr}`
    );
    assert.ok(
      result.stdout.includes('Usage:'),
      `expected stdout to contain 'Usage:', got: ${result.stdout}`
    );
  });

  test('ipcraft generate produces files via the launcher', async function (this: Mocha.Context) {
    this.timeout(20000);
    if (process.platform === 'win32') {
      this.skip();
      return;
    }

    const ipYamlPath = path.join(FIXTURES_DIR, 'test.ip.yml');
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-e2e-generate-'));

    try {
      const result = await runFile(cliLauncherPath, ['generate', ipYamlPath, '--out', outDir], {
        PATH: '/usr/bin:/bin',
        HOME: os.homedir(),
      });
      assert.strictEqual(
        result.code,
        0,
        `generate should exit 0, got ${result.code}. stdout=${result.stdout} stderr=${result.stderr}`
      );
      const rtlFile = path.join(outDir, 'rtl', 'test_core.vhd');
      assert.ok(fs.existsSync(rtlFile), `expected ${rtlFile} to be generated`);
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('a new integrated terminal has ipcraft on PATH with zero setup', async function (this: Mocha.Context) {
    this.timeout(30000);
    if (process.platform === 'win32') {
      // The integrated default shell (PowerShell/cmd) needs ipcraft.cmd discovery via
      // PATHEXT, which is not exercised here — covered by design review, not this e2e run.
      this.skip();
      return;
    }

    const outputFile = path.join(os.tmpdir(), `ipcraft-e2e-terminal-${Date.now()}.txt`);
    const terminal = vscode.window.createTerminal({ name: 'ipcraft-e2e-206' });
    try {
      // Bracket the real command with markers so a failure (timeout, "not found", a
      // crash) is distinguishable from "the terminal never ran anything at all".
      terminal.sendText(
        `echo IPCRAFT_E2E_START > "${outputFile}"; ipcraft --help >> "${outputFile}" 2>&1; echo IPCRAFT_E2E_DONE_$? >> "${outputFile}"`
      );
      try {
        await waitUntil(
          () =>
            fs.existsSync(outputFile) &&
            fs.readFileSync(outputFile, 'utf8').includes('IPCRAFT_E2E_DONE'),
          25000
        );
      } catch (waitError) {
        const seen = fs.existsSync(outputFile)
          ? fs.readFileSync(outputFile, 'utf8')
          : '<output file was never created>';
        throw new Error(
          `${(waitError as Error).message}. Terminal output so far: ${JSON.stringify(seen)}`
        );
      }
      const content = fs.readFileSync(outputFile, 'utf8');
      assert.ok(
        content.includes('Usage:'),
        `expected terminal output to contain 'Usage:', got: ${content}`
      );
    } finally {
      terminal.dispose();
      fs.rmSync(outputFile, { force: true });
    }
  });
});
