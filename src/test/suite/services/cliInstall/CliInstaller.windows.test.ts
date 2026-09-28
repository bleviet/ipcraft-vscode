/**
 * installCommand/uninstallCommand's win32 branch, tested separately from
 * CliInstaller.test.ts with `fs/promises` fully mocked.
 *
 * Why: userBinDir('win32', ...) builds paths with `path.win32.join`, which always
 * normalizes to backslashes — but the rest of CliInstaller.ts joins those win32-style
 * strings with the ambient `path.join`, which resolves to `path.win32` on a real Windows
 * machine (correct) but to `path.posix` on the macOS/Linux runner that actually executes
 * this test suite. A backslash-only string is not a rooted POSIX path, so any real fs
 * write against it lands relative to CWD instead of a temp dir — i.e. it can leak files
 * into the repo. Mocking fs/promises here avoids all real disk I/O for this platform.
 */
import * as path from 'path';
import * as vscode from 'vscode';

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  chmod: jest.fn(),
  readFile: jest.fn(),
  rm: jest.fn(),
}));

jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));

jest.mock('../../../../services/cliInstall/windowsUserPath', () => ({
  addToWindowsUserPath: jest.fn().mockResolvedValue(undefined),
  removeFromWindowsUserPath: jest.fn().mockResolvedValue(undefined),
}));

import * as fsp from 'fs/promises';
import * as os from 'os';
import { installCommand, uninstallCommand } from '../../../../services/cliInstall/CliInstaller';
import { userBinDir } from '../../../../services/cliInstall/launcherScripts';
import {
  addToWindowsUserPath,
  removeFromWindowsUserPath,
} from '../../../../services/cliInstall/windowsUserPath';

const mockWriteFile = fsp.writeFile as jest.Mock;
const mockReadFile = fsp.readFile as jest.Mock;
const mockRm = fsp.rm as jest.Mock;
const mockHomedir = os.homedir as jest.Mock;
const mockAddWindowsPath = addToWindowsUserPath as jest.Mock;
const mockRemoveWindowsPath = removeFromWindowsUserPath as jest.Mock;

function enoent(): NodeJS.ErrnoException {
  const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
  err.code = 'ENOENT';
  return err;
}

function makeContext(): vscode.ExtensionContext {
  return {
    globalStorageUri: {
      fsPath:
        'C:\\Users\\alice\\AppData\\Roaming\\Code\\User\\globalStorage\\bahonavi.ipcraft-vscode',
    },
    extensionPath: 'C:\\Users\\alice\\.vscode\\extensions\\bahonavi.ipcraft-vscode-1.0.0',
    environmentVariableCollection: {
      prepend: jest.fn(),
      description: undefined as string | undefined,
    },
  } as unknown as vscode.ExtensionContext;
}

describe('CliInstaller on Windows (fs mocked)', () => {
  const originalPlatform = process.platform;
  const homeDir = 'C:\\Users\\alice';
  const localAppData = 'C:\\Users\\alice\\AppData\\Local';
  const expectedBinDir = userBinDir('win32', { LOCALAPPDATA: localAppData }, homeDir);
  // Mirrors CliInstaller.ts's own `path.join(binDir, shimName)` (ambient path.join —
  // path.win32 on real Windows; here, on the POSIX host actually running this test,
  // it's path.posix, but production and test call the exact same function).
  const expectedShimPath = path.join(expectedBinDir, 'ipcraft.cmd');

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    mockHomedir.mockReturnValue(homeDir);
    (fsp.mkdir as jest.Mock).mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    (fsp.chmod as jest.Mock).mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(enoent());
    process.env.LOCALAPPDATA = localAppData;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    delete process.env.LOCALAPPDATA;
    delete process.env.PATH;
  });

  it('installCommand writes a .cmd shim and adds the bin dir to the Windows user PATH when absent', async () => {
    process.env.PATH = 'C:\\Windows\\System32';
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    await installCommand(makeContext());

    expect(mockWriteFile).toHaveBeenCalledWith(
      expectedShimPath,
      expect.stringContaining('ipcraft-vscode shim'),
      'utf8'
    );
    expect(mockAddWindowsPath).toHaveBeenCalledWith(expectedBinDir);
  });

  it('installCommand skips the Windows PATH update when the bin dir is already on PATH', async () => {
    process.env.PATH = `C:\\Windows;${expectedBinDir}`;
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    await installCommand(makeContext());

    expect(mockAddWindowsPath).not.toHaveBeenCalled();
  });

  it('installCommand refuses to overwrite a foreign .cmd file', async () => {
    process.env.PATH = 'C:\\Windows\\System32';
    mockReadFile.mockResolvedValueOnce('@echo off\r\necho not ours\r\n');
    const showError = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

    await installCommand(makeContext());

    expect(showError).toHaveBeenCalledTimes(1);
    expect(mockAddWindowsPath).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalledWith(
      expectedShimPath,
      expect.anything(),
      expect.anything()
    );
  });

  it('uninstallCommand removes its own .cmd shim and updates the Windows user PATH', async () => {
    mockReadFile.mockResolvedValueOnce('@echo off\r\nREM ipcraft-vscode shim\r\n"..." %*\r\n');
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    await uninstallCommand();

    expect(mockRm).toHaveBeenCalledWith(expectedShimPath, { force: true });
    expect(mockRemoveWindowsPath).toHaveBeenCalledWith(expectedBinDir);
  });

  it('uninstallCommand leaves a foreign .cmd shim in place', async () => {
    mockReadFile.mockResolvedValueOnce('@echo off\r\necho not ours\r\n');
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

    await uninstallCommand();

    expect(mockRm).not.toHaveBeenCalled();
    expect(mockRemoveWindowsPath).toHaveBeenCalledWith(expectedBinDir);
  });
});
