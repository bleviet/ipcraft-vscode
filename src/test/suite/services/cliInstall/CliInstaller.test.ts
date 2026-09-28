import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  refreshLauncher,
  getLauncherPath,
  installCommand,
  uninstallCommand,
} from '../../../../services/cliInstall/CliInstaller';
import { POSIX_SHIM_MARKER } from '../../../../services/cliInstall/launcherScripts';

// installCommand/uninstallCommand import windowsUserPath (child_process-backed); it is
// never exercised by the POSIX-only scenarios in this file, but must still resolve.
jest.mock('../../../../services/cliInstall/windowsUserPath', () => ({
  addToWindowsUserPath: jest.fn().mockResolvedValue(undefined),
  removeFromWindowsUserPath: jest.fn().mockResolvedValue(undefined),
}));

// os.homedir is a non-configurable accessor on this Node runtime, so jest.spyOn(os,
// 'homedir') cannot redefine it; mock the whole module instead.
jest.mock('os', () => ({
  ...jest.requireActual<typeof import('os')>('os'),
  homedir: jest.fn(),
}));

const mockHomedir = os.homedir as jest.Mock;

function makeContext(tmpRoot: string): vscode.ExtensionContext {
  return {
    globalStorageUri: { fsPath: path.join(tmpRoot, 'storage') },
    extensionPath: path.join(tmpRoot, 'ext'),
    environmentVariableCollection: {
      prepend: jest.fn(),
      description: undefined as string | undefined,
    },
  } as unknown as vscode.ExtensionContext;
}

describe('CliInstaller', () => {
  let tmpRoot: string;
  let homeDir: string;
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;
  const originalShell = process.env.SHELL;
  const originalLocalAppData = process.env.LOCALAPPDATA;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cliinstall-'));
    homeDir = path.join(tmpRoot, 'home');
    fs.mkdirSync(homeDir, { recursive: true });
    mockHomedir.mockReturnValue(homeDir);
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    process.env.PATH = originalPath;
    process.env.SHELL = originalShell;
    if (originalLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = originalLocalAppData;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('getLauncherPath', () => {
    it('points at <globalStorage>/bin/ipcraft', () => {
      const context = makeContext(tmpRoot);
      expect(getLauncherPath(context)).toBe(path.join(tmpRoot, 'storage', 'bin', 'ipcraft'));
    });
  });

  describe('refreshLauncher', () => {
    it('writes an executable POSIX launcher and a Windows launcher, then prepends PATH', async () => {
      const context = makeContext(tmpRoot);
      await refreshLauncher(context);

      const binDir = path.join(tmpRoot, 'storage', 'bin');
      const posixPath = path.join(binDir, 'ipcraft');
      const winPath = path.join(binDir, 'ipcraft.cmd');
      expect(fs.existsSync(posixPath)).toBe(true);
      expect(fs.existsSync(winPath)).toBe(true);

      const content = fs.readFileSync(posixPath, 'utf8');
      expect(content).toContain(process.execPath);
      expect(content).toContain(path.join(tmpRoot, 'ext', 'dist', 'cli.js'));

      expect(fs.statSync(posixPath).mode & 0o777).toBe(0o755);
      expect(context.environmentVariableCollection.prepend).toHaveBeenCalledWith(
        'PATH',
        binDir + path.delimiter
      );
      expect(context.environmentVariableCollection.description).toBeTruthy();
    });

    it('rewrites the launcher on a second call (stays current across updates)', async () => {
      const context = makeContext(tmpRoot);
      await refreshLauncher(context);
      const posixPath = path.join(tmpRoot, 'storage', 'bin', 'ipcraft');
      const firstContent = fs.readFileSync(posixPath, 'utf8');
      expect(firstContent).toContain(path.join(tmpRoot, 'ext', 'dist', 'cli.js'));

      // Simulate an extension update: a new extensionPath.
      const updatedContext = {
        ...context,
        extensionPath: path.join(tmpRoot, 'ext-v2'),
      } as vscode.ExtensionContext;
      await refreshLauncher(updatedContext);
      const secondContent = fs.readFileSync(posixPath, 'utf8');
      expect(secondContent).toContain(path.join(tmpRoot, 'ext-v2', 'dist', 'cli.js'));
    });

    it('never throws when the storage directory cannot be created', async () => {
      // A regular file cannot be mkdir'd into on any platform.
      const blockerFile = path.join(tmpRoot, 'blocker');
      fs.writeFileSync(blockerFile, 'x');
      const context = {
        globalStorageUri: { fsPath: path.join(blockerFile, 'storage') },
        extensionPath: path.join(tmpRoot, 'ext'),
        environmentVariableCollection: { prepend: jest.fn(), description: undefined },
      } as unknown as vscode.ExtensionContext;

      await expect(refreshLauncher(context)).resolves.toBeUndefined();
    });
  });

  describe('installCommand on POSIX', () => {
    beforeEach(() => {
      setPlatform('darwin');
    });

    it('writes a shim and only shows an info message when the bin dir is already on PATH', async () => {
      const binDir = path.join(homeDir, '.local', 'bin');
      process.env.PATH = `/usr/bin:${binDir}`;
      const showInfo = jest
        .spyOn(vscode.window, 'showInformationMessage')
        .mockResolvedValue(undefined);

      const context = makeContext(tmpRoot);
      await installCommand(context);

      const shimPath = path.join(binDir, 'ipcraft');
      expect(fs.existsSync(shimPath)).toBe(true);
      expect(fs.readFileSync(shimPath, 'utf8')).toContain(POSIX_SHIM_MARKER);
      expect(fs.statSync(shimPath).mode & 0o777).toBe(0o755);
      expect(showInfo).toHaveBeenCalledTimes(1);
      expect(showInfo.mock.calls[0][0]).toContain('Installed');
    });

    it('refuses to overwrite a foreign file at the shim path', async () => {
      const binDir = path.join(homeDir, '.local', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'ipcraft'), '#!/bin/sh\necho "not ours"\n');
      process.env.PATH = '/usr/bin';
      const showError = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

      const context = makeContext(tmpRoot);
      await installCommand(context);

      expect(fs.readFileSync(path.join(binDir, 'ipcraft'), 'utf8')).toBe(
        '#!/bin/sh\necho "not ours"\n'
      );
      expect(showError).toHaveBeenCalledTimes(1);
      expect(showError.mock.calls[0][0]).toContain('did not create');
    });

    it('overwrites its own previously-installed shim without complaint', async () => {
      const binDir = path.join(homeDir, '.local', 'bin');
      process.env.PATH = `/usr/bin:${binDir}`;
      jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
      const showError = jest.spyOn(vscode.window, 'showErrorMessage').mockResolvedValue(undefined);

      const context = makeContext(tmpRoot);
      await installCommand(context);
      await installCommand(context);

      expect(showError).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(binDir, 'ipcraft'))).toBe(true);
    });

    it('adds a PATH block to the shell profile when the user chooses "Add"', async () => {
      process.env.SHELL = '/bin/zsh';
      process.env.PATH = '/usr/bin';
      const showInfo = jest
        .spyOn(vscode.window, 'showInformationMessage')
        .mockResolvedValueOnce('Add' as unknown as undefined)
        .mockResolvedValue(undefined);

      const context = makeContext(tmpRoot);
      await installCommand(context);

      const profilePath = path.join(homeDir, '.zprofile');
      expect(fs.existsSync(profilePath)).toBe(true);
      const profileContent = fs.readFileSync(profilePath, 'utf8');
      expect(profileContent).toContain('# >>> ipcraft >>>');
      expect(profileContent).toContain('export PATH="$HOME/.local/bin:$PATH"');
      expect(showInfo).toHaveBeenCalled();
    });

    it('copies the export line instead of editing the profile when the user chooses "Show instructions"', async () => {
      process.env.SHELL = '/bin/bash';
      process.env.PATH = '/usr/bin';
      jest
        .spyOn(vscode.window, 'showInformationMessage')
        .mockResolvedValueOnce('Show instructions' as unknown as undefined)
        .mockResolvedValueOnce('Copy' as unknown as undefined);
      const clipboardWrite = jest
        .spyOn(vscode.env.clipboard, 'writeText')
        .mockResolvedValue(undefined);

      const context = makeContext(tmpRoot);
      await installCommand(context);

      expect(fs.existsSync(path.join(homeDir, '.bash_profile'))).toBe(false);
      expect(clipboardWrite).toHaveBeenCalledWith('export PATH="$HOME/.local/bin:$PATH"');
    });

    it('shows copyable instructions directly for an unrecognized shell', async () => {
      process.env.SHELL = '/usr/bin/fish';
      process.env.PATH = '/usr/bin';
      const showInfo = jest
        .spyOn(vscode.window, 'showInformationMessage')
        .mockResolvedValueOnce('Copy' as unknown as undefined);
      const clipboardWrite = jest
        .spyOn(vscode.env.clipboard, 'writeText')
        .mockResolvedValue(undefined);

      const context = makeContext(tmpRoot);
      await installCommand(context);

      expect(showInfo).toHaveBeenCalledTimes(1);
      const [message, ...actions] = showInfo.mock.calls[0];
      expect(message).toContain('export PATH="$HOME/.local/bin:$PATH"');
      expect(actions).toContain('Copy');
      expect(clipboardWrite).toHaveBeenCalledWith('export PATH="$HOME/.local/bin:$PATH"');
    });
  });

  // Windows behavior (installCommand/uninstallCommand on win32) is covered by
  // CliInstaller.windows.test.ts with fs/promises mocked: userBinDir's win32 branch
  // produces backslash-separated paths via path.win32.join, which are not valid,
  // rooted paths on a POSIX filesystem — real fs I/O against them on a macOS/Linux
  // test runner would land outside any temp dir (see that file's header comment).

  describe('uninstallCommand', () => {
    it('removes only its own shim on POSIX, leaving a foreign file alone', async () => {
      setPlatform('darwin');
      const binDir = path.join(homeDir, '.local', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(
        path.join(binDir, 'ipcraft'),
        `#!/bin/sh\n${POSIX_SHIM_MARKER}\nexec true\n`
      );
      jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

      await uninstallCommand();

      expect(fs.existsSync(path.join(binDir, 'ipcraft'))).toBe(false);
    });

    it('leaves a foreign shim in place', async () => {
      setPlatform('darwin');
      const binDir = path.join(homeDir, '.local', 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(path.join(binDir, 'ipcraft'), '#!/bin/sh\necho "not ours"\n');
      jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

      await uninstallCommand();

      expect(fs.existsSync(path.join(binDir, 'ipcraft'))).toBe(true);
      expect(fs.readFileSync(path.join(binDir, 'ipcraft'), 'utf8')).toBe(
        '#!/bin/sh\necho "not ours"\n'
      );
    });

    it('removes the PATH block from the shell profile it was added to', async () => {
      setPlatform('darwin');
      process.env.SHELL = '/bin/zsh';
      const profilePath = path.join(homeDir, '.zprofile');
      fs.writeFileSync(
        profilePath,
        'export EDITOR=vim\n\n# >>> ipcraft >>>\nexport PATH="$HOME/.local/bin:$PATH"\n# <<< ipcraft <<<\n'
      );
      jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);

      await uninstallCommand();

      expect(fs.readFileSync(profilePath, 'utf8')).toBe('export EDITOR=vim\n');
    });
  });
});
