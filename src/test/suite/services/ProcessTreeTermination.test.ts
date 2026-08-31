import { EventEmitter } from 'events';
import * as childProcess from 'child_process';
import { createProcessTreeTerminator } from '../../../services/ProcessTreeTermination';

jest.mock('child_process');

const spawn = childProcess.spawn as jest.Mock;

describe('ProcessTreeTermination', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('surfaces taskkill failure instead of claiming a root-only fallback killed the tree', async () => {
    const child = fakeProcess(4812);
    const taskkill = fakeProcess();
    spawn.mockReturnValue(taskkill);
    const terminate = createProcessTreeTerminator('win32');

    const pending = terminate(child as unknown as ReturnType<typeof childProcess.spawn>);
    taskkill.emit('close', 1);

    await expect(pending).rejects.toThrow(/taskkill.*4812.*exit code 1/i);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('surfaces EPERM from the POSIX process-group SIGTERM instead of killing only the root', async () => {
    jest.useFakeTimers();
    const child = fakeProcess(4812);
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -4812 && signal === 'SIGTERM') {
        throw errnoError('EPERM');
      }
      return true;
    });
    const terminate = createProcessTreeTerminator('linux');

    const pending = terminate(child as unknown as ReturnType<typeof childProcess.spawn>);
    const rejected = expect(pending).rejects.toThrow(/process group -4812.*SIGTERM.*EPERM/i);
    await jest.advanceTimersByTimeAsync(2_100);

    await rejected;
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('surfaces EPERM from the POSIX process-group SIGKILL escalation', async () => {
    jest.useFakeTimers();
    const child = fakeProcess(4812);
    jest.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === -4812 && signal === 'SIGKILL') {
        throw errnoError('EPERM');
      }
      return true;
    });
    const terminate = createProcessTreeTerminator('linux');

    const pending = terminate(child as unknown as ReturnType<typeof childProcess.spawn>);
    const rejected = expect(pending).rejects.toThrow(/process group -4812.*SIGKILL.*EPERM/i);
    await jest.advanceTimersByTimeAsync(2_100);

    await rejected;
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('treats ESRCH as a benign already-exited POSIX process group', async () => {
    jest.useFakeTimers();
    const child = fakeProcess(4812);
    jest.spyOn(process, 'kill').mockImplementation(() => {
      throw errnoError('ESRCH');
    });
    const terminate = createProcessTreeTerminator('linux');

    const pending = terminate(child as unknown as ReturnType<typeof childProcess.spawn>);
    await jest.advanceTimersByTimeAsync(2_100);

    await expect(pending).resolves.toBeUndefined();
    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
  });
});

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
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
