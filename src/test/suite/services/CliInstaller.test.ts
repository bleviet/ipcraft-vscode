import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CLI_SHIM_MARKER } from '../../../services/CliShim';
import { execFile } from 'child_process';
import {
  installCliShim,
  readWindowsUserPath,
  uninstallCliShim,
  writeCliLauncher,
  writeWindowsUserPath,
} from '../../../services/CliInstaller';

jest.mock('child_process', () => ({ execFile: jest.fn() }));
const execFileMock = execFile as unknown as jest.Mock;

const platform = process.platform;
const posixOnly = platform === 'win32' ? it.skip : it;

describe('CliInstaller', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-installer-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('writes the launcher, creating the directory', async () => {
    const binDir = path.join(tmp, 'a', 'bin');
    const launcher = await writeCliLauncher(binDir, '/opt/code', '/ext', platform, true);
    const contents = fs.readFileSync(launcher, 'utf8');
    expect(contents).toContain(CLI_SHIM_MARKER);
    expect(contents).toContain('ELECTRON_RUN_AS_NODE');
    expect(contents).toContain(path.join('/ext', 'dist', 'cli.js'));
    expect(fs.readdirSync(binDir)).toHaveLength(1);
  });

  posixOnly('marks the launcher executable', async () => {
    const launcher = await writeCliLauncher(tmp, '/opt/code', '/ext', platform, true);
    expect(fs.statSync(launcher).mode & 0o111).toBe(0o111);
  });

  it('rewrites the launcher with new content', async () => {
    await writeCliLauncher(tmp, '/opt/code-1', '/ext', platform, true);
    const launcher = await writeCliLauncher(tmp, '/opt/code-2', '/ext', platform, true);
    const contents = fs.readFileSync(launcher, 'utf8');
    expect(contents).toContain('code-2');
    expect(contents).not.toContain('code-1');
  });

  it('installs a shim pointing at the launcher and overwrites its own shim', async () => {
    const shimDir = path.join(tmp, 'shim');
    const shim = await installCliShim(shimDir, '/l/one', platform);
    await installCliShim(shimDir, '/l/two', platform);
    const contents = fs.readFileSync(shim, 'utf8');
    expect(contents).toContain('/l/two');
    expect(contents).not.toContain('/l/one');
    if (platform !== 'win32') {
      expect(fs.statSync(shim).mode & 0o111).toBe(0o111);
    }
  });

  it('refuses to overwrite a foreign file', async () => {
    const shimPath = path.join(tmp, platform === 'win32' ? 'ipcraft.cmd' : 'ipcraft');
    fs.writeFileSync(shimPath, 'something else');
    await expect(installCliShim(tmp, '/l', platform)).rejects.toThrow(/overwrite/);
    expect(fs.readFileSync(shimPath, 'utf8')).toBe('something else');
  });

  it('uninstalls only marked files', async () => {
    await installCliShim(tmp, '/l', platform);
    expect(await uninstallCliShim(tmp, platform)).toBe(true);
    expect(await uninstallCliShim(tmp, platform)).toBe(false);

    const shimPath = path.join(tmp, platform === 'win32' ? 'ipcraft.cmd' : 'ipcraft');
    fs.writeFileSync(shimPath, 'foreign');
    expect(await uninstallCliShim(tmp, platform)).toBe(false);
    expect(fs.existsSync(shimPath)).toBe(true);
  });

  describe('Windows user PATH via PowerShell', () => {
    function stubStdout(stdout: string): void {
      execFileMock.mockImplementation(
        (
          _file: string,
          _args: string[],
          _opts: unknown,
          cb: (error: Error | null, out: string) => void
        ) => cb(null, stdout)
      );
    }

    it('reads with UTF-8 output encoding and trims the trailing newline', async () => {
      stubStdout('C:\\Users\\Zoë\\bin;%USERPROFILE%\\x\r\n');
      await expect(readWindowsUserPath()).resolves.toBe('C:\\Users\\Zoë\\bin;%USERPROFILE%\\x');
      const [file, args] = execFileMock.mock.calls[0] as [string, string[]];
      expect(file).toBe('powershell.exe');
      const command = args[args.length - 1];
      expect(command.startsWith('[Console]::OutputEncoding = [Text.Encoding]::UTF8; ')).toBe(true);
      expect(command).toContain('DoNotExpandEnvironmentNames');
    });

    it('writes the value through IPCRAFT_USER_PATH as ExpandString', async () => {
      stubStdout('');
      await writeWindowsUserPath('C:\\a;C:\\b');
      const [, args, opts] = execFileMock.mock.calls[0] as [
        string,
        string[],
        { env: NodeJS.ProcessEnv },
      ];
      const command = args[args.length - 1];
      expect(opts.env.IPCRAFT_USER_PATH).toBe('C:\\a;C:\\b');
      expect(command).not.toContain('C:\\a;C:\\b');
      expect(command).toContain('$env:IPCRAFT_USER_PATH');
      expect(command).toContain('-Type ExpandString');
    });
  });
});
