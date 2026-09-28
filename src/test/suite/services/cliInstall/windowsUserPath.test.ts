import { execFile } from 'child_process';
import {
  addToWindowsUserPath,
  removeFromWindowsUserPath,
} from '../../../../services/cliInstall/windowsUserPath';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

const mockExecFile = execFile as unknown as jest.Mock;

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('windowsUserPath', () => {
  beforeEach(() => {
    mockExecFile.mockReset();
  });

  it('addToWindowsUserPath reads the current user PATH, appends the dir, and writes it back', async () => {
    const calls: string[] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        const command = args[args.length - 1];
        calls.push(command);
        if (command.includes('GetEnvironmentVariable')) {
          cb(null, 'C:\\Windows\\System32;C:\\Windows', '');
        } else {
          cb(null, '', '');
        }
      }
    );

    await addToWindowsUserPath('C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft');

    expect(mockExecFile).toHaveBeenCalledTimes(2);
    expect(calls[0]).toContain("GetEnvironmentVariable('Path','User')");
    expect(calls[1]).toContain(
      "SetEnvironmentVariable('Path', 'C:\\Windows\\System32;C:\\Windows;C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft', 'User')"
    );
  });

  it('addToWindowsUserPath does not duplicate an entry already on PATH', async () => {
    const calls: string[] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        const command = args[args.length - 1];
        calls.push(command);
        if (command.includes('GetEnvironmentVariable')) {
          cb(null, 'C:\\Windows;C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft', '');
        } else {
          cb(null, '', '');
        }
      }
    );

    await addToWindowsUserPath('C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft');

    expect(calls[1]).toContain(
      "SetEnvironmentVariable('Path', 'C:\\Windows;C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft', 'User')"
    );
  });

  it('removeFromWindowsUserPath drops the dir from the current user PATH', async () => {
    const calls: string[] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        const command = args[args.length - 1];
        calls.push(command);
        if (command.includes('GetEnvironmentVariable')) {
          cb(
            null,
            'C:\\Windows;C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft;C:\\Windows\\System32',
            ''
          );
        } else {
          cb(null, '', '');
        }
      }
    );

    await removeFromWindowsUserPath('C:\\Users\\alice\\AppData\\Local\\Programs\\ipcraft');

    expect(calls[1]).toContain(
      "SetEnvironmentVariable('Path', 'C:\\Windows;C:\\Windows\\System32', 'User')"
    );
  });

  it('escapes a single quote in the dir before interpolating into PowerShell', async () => {
    const calls: string[] = [];
    mockExecFile.mockImplementation(
      (_cmd: string, args: string[], _opts: unknown, cb: ExecFileCallback) => {
        const command = args[args.length - 1];
        calls.push(command);
        cb(null, '', '');
      }
    );

    await addToWindowsUserPath("C:\\Users\\o'brien\\bin");

    expect(calls[1]).toContain("C:\\Users\\o''brien\\bin");
  });

  it('rejects when PowerShell fails', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCallback) => {
        cb(new Error('powershell.exe not found'), '', '');
      }
    );

    await expect(addToWindowsUserPath('C:\\bin')).rejects.toThrow('powershell.exe not found');
  });
});
