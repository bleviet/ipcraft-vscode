import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { runProcess, type BuildRunOptions } from '../../../services/BuildRunner';

jest.mock('child_process');

const spawn = childProcess.spawn as jest.Mock;

describe('runProcess', () => {
  it('kills a running process when its cancellation token fires', async () => {
    const process = new EventEmitter() as EventEmitter & {
      kill: jest.Mock;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    process.kill = jest.fn();
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    spawn.mockReturnValue(process);

    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn((listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      }),
    };
    const outputChannel = { appendLine: jest.fn() };

    const pending = runProcess('vivado', ['-mode', 'batch'], {
      cwd: '/tmp/discovery',
      outputChannel,
      cancellationToken,
    } as unknown as BuildRunOptions);
    cancel?.();
    process.emit('close', null);

    await expect(pending).resolves.toMatchObject({ success: false, cancelled: true });
    expect(process.kill).toHaveBeenCalled();
  });

  it('uses the process-tree terminator once and resolves only after the child closes', async () => {
    const process = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: jest.Mock;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    process.pid = 4812;
    process.kill = jest.fn();
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    spawn.mockReturnValue(process);

    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn((listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      }),
    };
    const terminateProcessTree = jest.fn();
    const settled = jest.fn();

    const pending = runProcess('make', ['run'], {
      cwd: '/tmp/run',
      outputChannel: { appendLine: jest.fn() },
      cancellationToken,
      terminateProcessTree,
    } as unknown as BuildRunOptions);
    void pending.then(settled);
    cancel?.();
    cancel?.();
    await Promise.resolve();

    expect(terminateProcessTree).toHaveBeenCalledTimes(1);
    expect(terminateProcessTree).toHaveBeenCalledWith(process);
    expect(settled).not.toHaveBeenCalled();

    process.emit('close', null);
    process.emit('close', null);

    await expect(pending).resolves.toEqual({ success: false, exitCode: -1, cancelled: true });
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('reports a synchronous process-tree termination failure as a typed diagnostic', async () => {
    const child = fakeProcess(4812);
    spawn.mockReturnValue(child);
    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      },
    };
    const terminate = jest.fn(() => {
      throw new Error('taskkill exited 1');
    });

    const pending = runProcess('make', ['run'], {
      cwd: '/tmp/run',
      outputChannel: { appendLine: jest.fn() },
      cancellationToken,
      terminateProcessTree: terminate,
    } as unknown as BuildRunOptions);
    cancel?.();

    await expect(pending).resolves.toEqual({
      success: false,
      exitCode: -1,
      diagnostic: 'Failed to terminate process tree: taskkill exited 1',
    });
  });

  it('creates a POSIX process group and awaits timeout-driven tree termination', async () => {
    if (process.platform === 'win32') {
      return;
    }
    jest.useFakeTimers();
    const child = fakeProcess(4812);
    spawn.mockReturnValue(child);
    let finishTermination: (() => void) | undefined;
    const terminate = jest.fn(
      async () =>
        await new Promise<void>((resolve) => {
          finishTermination = resolve;
        })
    );
    const settled = jest.fn();

    try {
      const pending = runProcess('make', ['run'], {
        cwd: '/tmp/run',
        outputChannel: { appendLine: jest.fn() },
        timeoutMs: 100,
        terminateProcessTree: terminate,
      });
      void pending.then(settled);

      expect((spawn.mock.calls[0][2] as { detached: boolean }).detached).toBe(true);
      await jest.advanceTimersByTimeAsync(100);
      expect(terminate).toHaveBeenCalledWith(child);
      child.emit('close', null);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      finishTermination?.();
      await expect(pending).resolves.toEqual({
        success: false,
        exitCode: -1,
        diagnostic: 'Process timed out after 100ms.',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('reports timeout failure when termination makes the child exit successfully', async () => {
    jest.useFakeTimers();
    const child = fakeProcess(4814);
    spawn.mockReturnValue(child);
    const terminate = jest.fn(async () => undefined);

    try {
      const pending = runProcess('make', ['run'], {
        cwd: '/tmp/run',
        outputChannel: { appendLine: jest.fn() },
        timeoutMs: 100,
        terminateProcessTree: terminate,
      });

      await jest.advanceTimersByTimeAsync(100);
      child.emit('close', 0);

      await expect(pending).resolves.toEqual({
        success: false,
        exitCode: 0,
        diagnostic: 'Process timed out after 100ms.',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('names, removes, and awaits its Docker container on timeout', async () => {
    jest.useFakeTimers();
    const main = fakeProcess(4813);
    const dockerCleanup = fakeProcess();
    const dockerInspection = fakeProcess();
    spawn
      .mockReturnValueOnce(main)
      .mockReturnValueOnce(dockerCleanup)
      .mockReturnValueOnce(dockerInspection);
    const settled = jest.fn();

    try {
      const pending = runProcess('make', ['run'], {
        cwd: '/workspace',
        outputChannel: { appendLine: jest.fn() },
        docker: { image: 'vivado:2025.1', mountBase: '/workspace' },
        timeoutMs: 100,
        terminateProcessTree: jest.fn(),
      });
      void pending.then(settled);
      const launchArgs = spawn.mock.calls[0][1] as string[];
      const nameIndex = launchArgs.indexOf('--name');

      await jest.advanceTimersByTimeAsync(100);
      main.emit('close', null);
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      if (nameIndex >= 0) {
        dockerCleanup.emit('close', 0);
        await Promise.resolve();
        dockerInspection.emit('close', 0);
      }

      await expect(pending).resolves.toEqual({
        success: false,
        exitCode: -1,
        diagnostic: 'Process timed out after 100ms.',
      });
      expect(nameIndex).toBeGreaterThan(-1);
      const containerName = launchArgs[nameIndex + 1];
      expect(spawn).toHaveBeenNthCalledWith(
        2,
        'docker',
        ['rm', '-f', containerName],
        expect.objectContaining({ stdio: 'ignore' })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('escalates cancellation to SIGKILL when the POSIX child tree ignores SIGTERM', async () => {
    if (process.platform === 'win32') {
      return;
    }
    jest.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & {
      pid: number;
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      kill: jest.Mock;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    child.pid = 4812;
    child.exitCode = null;
    child.signalCode = null;
    child.kill = jest.fn();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    spawn.mockReturnValue(child);
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      },
    };

    try {
      const pending = runProcess('make', ['run'], {
        cwd: '/tmp/run',
        outputChannel: { appendLine: jest.fn() },
        cancellationToken,
      } as unknown as BuildRunOptions);
      cancel?.();
      child.signalCode = 'SIGTERM';
      child.emit('close', null);
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(2_100);

      expect(kill).toHaveBeenCalledWith(-4812, 'SIGTERM');
      expect(kill).toHaveBeenCalledWith(-4812, 'SIGKILL');

      await expect(pending).resolves.toMatchObject({ cancelled: true });
    } finally {
      kill.mockRestore();
      jest.useRealTimers();
    }
  });

  it('forwards output lines to a structured observer without changing channel output', async () => {
    const child = new EventEmitter() as EventEmitter & {
      kill: jest.Mock;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    child.kill = jest.fn();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    spawn.mockReturnValue(child);
    const onOutputLine = jest.fn();

    const pending = runProcess('make', ['run'], {
      cwd: '/tmp/run',
      outputChannel: { appendLine: jest.fn() },
      onOutputLine,
    });
    child.stdout.emit('data', Buffer.from('IPCRAFT_LIFE'));
    child.stdout.emit('data', Buffer.from('CYCLE:discover\n'));
    child.stderr.emit('data', Buffer.from('diagnostic\n'));
    child.emit('close', 0);
    await pending;

    expect(onOutputLine).toHaveBeenNthCalledWith(1, 'IPCRAFT_LIFECYCLE:discover', 'stdout');
    expect(onOutputLine).toHaveBeenNthCalledWith(2, 'diagnostic', 'stderr');
  });

  it('translates Make assignments and removes only its named Docker container on cancellation', async () => {
    const main = new EventEmitter() as EventEmitter & {
      pid: number;
      kill: jest.Mock;
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    main.pid = 4812;
    main.kill = jest.fn();
    main.stdout = new EventEmitter();
    main.stderr = new EventEmitter();
    const dockerCleanup = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    dockerCleanup.stdout = new EventEmitter();
    dockerCleanup.stderr = new EventEmitter();
    const dockerInspection = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      stdout: EventEmitter;
    };
    dockerInspection.stdout = new EventEmitter();
    dockerInspection.stderr = new EventEmitter();
    spawn
      .mockReturnValueOnce(main)
      .mockReturnValueOnce(dockerCleanup)
      .mockReturnValueOnce(dockerInspection);
    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      },
    };
    const terminate = jest.fn();

    const pending = runProcess('make', ['run', 'RUN_DIR=/workspace/.ipcraft/run', 'WAVES=1'], {
      cwd: '/workspace/verification',
      outputChannel: { appendLine: jest.fn() },
      docker: { image: 'vivado:2025.1', mountBase: '/workspace' },
      cancellationToken,
      terminateProcessTree: terminate,
    } as unknown as BuildRunOptions);
    const launchArgs = spawn.mock.calls[0][1] as string[];
    const nameIndex = launchArgs.indexOf('--name');
    expect(nameIndex).toBeGreaterThan(-1);
    expect(launchArgs).toContain('RUN_DIR=/work/.ipcraft/run');
    const containerName = launchArgs[nameIndex + 1];

    cancel?.();
    expect(terminate).toHaveBeenCalledWith(main);
    await Promise.resolve();
    dockerCleanup.stderr.emit('data', Buffer.from('temporary Docker cleanup error'));
    dockerCleanup.emit('close', 1);
    await Promise.resolve();
    dockerInspection.emit('close', 0);
    main.emit('close', null);

    await expect(pending).resolves.toMatchObject({ cancelled: true });
    expect(spawn).toHaveBeenNthCalledWith(
      2,
      'docker',
      ['rm', '-f', containerName],
      expect.objectContaining({ stdio: 'ignore' })
    );
    expect(spawn).toHaveBeenNthCalledWith(
      3,
      'docker',
      ['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}'],
      expect.objectContaining({ stdio: 'pipe' })
    );
    expect(terminate).toHaveBeenCalledWith(main);
  });

  it('does not report cancellation complete when the named Docker container still exists', async () => {
    const main = fakeProcess(4813);
    const dockerCleanup = fakeProcess();
    const dockerInspection = fakeProcess();
    spawn
      .mockReturnValueOnce(main)
      .mockReturnValueOnce(dockerCleanup)
      .mockReturnValueOnce(dockerInspection);
    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      },
    };
    const outputChannel = { appendLine: jest.fn() };
    const terminate = jest.fn();

    const pending = runProcess('make', ['run'], {
      cwd: '/workspace',
      outputChannel,
      docker: { image: 'vivado:2025.1', mountBase: '/workspace' },
      cancellationToken,
      terminateProcessTree: terminate,
    } as unknown as BuildRunOptions);
    const launchArgs = spawn.mock.calls[0][1] as string[];
    const containerName = launchArgs[launchArgs.indexOf('--name') + 1];

    cancel?.();
    expect(terminate).toHaveBeenCalledWith(main);
    await Promise.resolve();
    dockerCleanup.emit('close', 0);
    await Promise.resolve();
    dockerInspection.stdout.emit('data', Buffer.from(`${containerName}\n`));
    dockerInspection.emit('close', 0);
    await Promise.resolve();

    await expect(pending).resolves.toEqual({
      success: false,
      exitCode: -1,
      diagnostic: expect.stringContaining('Failed to terminate process tree'),
    });
    expect(outputChannel.appendLine).toHaveBeenCalledWith(
      expect.stringContaining('Failed to terminate process tree')
    );
    expect(terminate).toHaveBeenCalledWith(main);
  });

  it('cancels only its spawned process group and leaves an unrelated process alive', async () => {
    jest.unmock('child_process');
    const realChildProcess = jest.requireActual<typeof import('child_process')>('child_process');
    spawn.mockImplementation(realChildProcess.spawn);
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-process-tree-'));
    const childPidPath = path.join(tempDirectory, 'child.pid');
    const unrelated = realChildProcess.spawn(process.execPath, [
      '-e',
      'setInterval(() => {}, 1000)',
    ]);
    let childPid: number | undefined;
    let cancel: (() => void) | undefined;
    const cancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: (listener: () => void) => {
        cancel = listener;
        return { dispose: jest.fn() };
      },
    };
    const parentScript = [
      "const fs = require('fs')",
      "const cp = require('child_process')",
      "const child = cp.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio: 'ignore'})",
      `fs.writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid))`,
      'setInterval(() => {}, 1000)',
    ].join(';');

    try {
      const pending = runProcess(process.execPath, ['-e', parentScript], {
        cwd: tempDirectory,
        outputChannel: { appendLine: jest.fn() },
        cancellationToken,
      } as unknown as BuildRunOptions);
      await waitForFile(childPidPath);
      childPid = Number(await fs.readFile(childPidPath, 'utf8'));

      cancel?.();
      await expect(pending).resolves.toMatchObject({ success: false, cancelled: true });

      await expectProcessToExit(childPid);
      expect(isProcessAlive(unrelated.pid!)).toBe(true);
    } finally {
      if (childPid !== undefined && isProcessAlive(childPid)) {
        process.kill(childPid);
      }
      unrelated.kill();
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
  });
});

async function waitForFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.stat(filePath);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function expectProcessToExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Process ${pid} was not terminated`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function fakeProcess(pid?: number): EventEmitter & {
  pid?: number;
  kill: jest.Mock;
  stderr: EventEmitter;
  stdout: EventEmitter;
} {
  const child = new EventEmitter() as EventEmitter & {
    pid?: number;
    kill: jest.Mock;
    stderr: EventEmitter;
    stdout: EventEmitter;
  };
  child.pid = pid;
  child.kill = jest.fn();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}
