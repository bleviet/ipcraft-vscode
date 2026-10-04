import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { registerCliPathCommands } from '../../../commands/CliPathCommands';
import {
  installCliShim,
  readWindowsUserPath,
  uninstallCliShim,
  writeWindowsUserPath,
} from '../../../services/CliInstaller';

jest.mock('../../../services/CliInstaller', () => ({
  ...jest.requireActual<object>('../../../services/CliInstaller'),
  readWindowsUserPath: jest.fn(),
  writeWindowsUserPath: jest.fn(),
  installCliShim: jest.fn(),
  uninstallCliShim: jest.fn(),
}));

jest.mock('os', () => ({
  ...jest.requireActual<object>('os'),
  homedir: jest.fn(),
}));

const PROFILE_LINE = 'export PATH="$HOME/.local/bin:$PATH"';
const INSTALL = 'fpga-ip-core.installCliInPath';
const UNINSTALL = 'fpga-ip-core.uninstallCliFromPath';

const showWarning = vscode.window.showWarningMessage as jest.Mock;
const showInfo = vscode.window.showInformationMessage as jest.Mock;
const writeText = vscode.env.clipboard.writeText as jest.Mock;
const readUserPath = readWindowsUserPath as jest.Mock;
const writeUserPath = writeWindowsUserPath as jest.Mock;
const actualInstaller = jest.requireActual<typeof import('../../../services/CliInstaller')>(
  '../../../services/CliInstaller'
);

describe('CliPathCommands', () => {
  const realPlatform = process.platform;
  const realPath = process.env.PATH;
  const realLocalAppData = process.env.LOCALAPPDATA;
  let tmp: string;
  let home: string;
  let globalStorage: string;
  let prepend: jest.Mock;
  let handlers: Map<string, () => Promise<void>>;
  let context: vscode.ExtensionContext;

  function setPlatform(platform: NodeJS.Platform): void {
    Object.defineProperty(process, 'platform', { value: platform });
  }

  async function register(): Promise<void> {
    registerCliPathCommands(context);
    await waitFor(() => prepend.mock.calls.length > 0);
  }

  async function waitFor(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(condition()).toBe(true);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-commands-'));
    home = path.join(tmp, 'home');
    globalStorage = path.join(tmp, 'storage');
    fs.mkdirSync(home);
    (os.homedir as jest.Mock).mockReturnValue(home);
    process.env.PATH = '/usr/bin';
    // Real shim IO by default; the win32 tests override these (registry PATH only).
    (installCliShim as jest.Mock).mockImplementation(actualInstaller.installCliShim);
    (uninstallCliShim as jest.Mock).mockImplementation(actualInstaller.uninstallCliShim);

    handlers = new Map();
    (vscode.commands.registerCommand as jest.Mock).mockImplementation(
      (command: string, handler: () => Promise<void>) => {
        handlers.set(command, handler);
        return { dispose: jest.fn() };
      }
    );
    prepend = jest.fn();
    context = {
      globalStorageUri: { fsPath: globalStorage },
      extensionPath: path.join(tmp, 'extension'),
      subscriptions: [],
      environmentVariableCollection: { prepend },
    } as unknown as vscode.ExtensionContext;
  });

  afterEach(() => {
    setPlatform(realPlatform);
    process.env.PATH = realPath;
    if (realLocalAppData === undefined) {
      delete process.env.LOCALAPPDATA;
    } else {
      process.env.LOCALAPPDATA = realLocalAppData;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prepends <globalStorage>/bin to PATH after the launcher is written', async () => {
    setPlatform('linux');
    await register();
    const binDir = path.join(globalStorage, 'bin');
    expect(prepend).toHaveBeenCalledWith('PATH', binDir + path.delimiter);
    expect(fs.existsSync(path.join(binDir, 'ipcraft'))).toBe(true);
  });

  it('linux: offers only Copy Line when ~/.local/bin is not on PATH', async () => {
    setPlatform('linux');
    await register();
    showWarning.mockResolvedValue('Copy Line');

    await handlers.get(INSTALL)?.();

    expect(showWarning).toHaveBeenCalledTimes(1);
    expect((showWarning.mock.calls[0] as string[]).slice(1)).toEqual(['Copy Line']);
    expect(writeText).toHaveBeenCalledWith(PROFILE_LINE);
    expect(fs.existsSync(path.join(home, '.local', 'bin', 'ipcraft'))).toBe(true);
    expect(fs.existsSync(path.join(home, '.zprofile'))).toBe(false);
  });

  it('darwin: appends the line to ~/.zprofile once', async () => {
    setPlatform('darwin');
    await register();
    showWarning.mockResolvedValue('Add to ~/.zprofile');

    await handlers.get(INSTALL)?.();
    await handlers.get(INSTALL)?.();

    expect((showWarning.mock.calls[0] as string[]).slice(1)).toEqual([
      'Add to ~/.zprofile',
      'Copy Line',
    ]);
    const profile = fs.readFileSync(path.join(home, '.zprofile'), 'utf8');
    expect(profile.split(PROFILE_LINE)).toHaveLength(2);
  });

  it('darwin: writes nothing when the prompt is dismissed', async () => {
    setPlatform('darwin');
    await register();
    showWarning.mockResolvedValue(undefined);

    await handlers.get(INSTALL)?.();

    expect(fs.existsSync(path.join(home, '.zprofile'))).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  describe('win32', () => {
    const shimDir = path.win32.join('C:\\Local', 'Programs', 'ipcraft');

    beforeEach(() => {
      setPlatform('win32');
      process.env.LOCALAPPDATA = 'C:\\Local';
      (installCliShim as jest.Mock).mockResolvedValue(path.win32.join(shimDir, 'ipcraft.cmd'));
      (uninstallCliShim as jest.Mock).mockResolvedValue(true);
    });

    it('adds the shim dir to the user PATH when missing', async () => {
      await register();
      readUserPath.mockResolvedValue('C:\\bin');

      await handlers.get(INSTALL)?.();

      expect(writeUserPath).toHaveBeenCalledWith(`C:\\bin;${shimDir}`);
      expect(showInfo).toHaveBeenCalled();
    });

    it('leaves the user PATH alone when the shim dir is present', async () => {
      await register();
      readUserPath.mockResolvedValue(`C:\\bin;${shimDir}`);

      await handlers.get(INSTALL)?.();

      expect(writeUserPath).not.toHaveBeenCalled();
    });

    it('removes the shim dir from the user PATH on uninstall', async () => {
      await register();
      readUserPath.mockResolvedValue(`C:\\bin;${shimDir}`);

      await handlers.get(UNINSTALL)?.();

      expect(writeUserPath).toHaveBeenCalledWith('C:\\bin');
    });
  });
});
