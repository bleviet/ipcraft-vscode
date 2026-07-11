import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { SystemConsoleTransport } from '../../../../services/transport/SystemConsoleTransport';
import { RegisterTransportError } from '../../../../services/transport/RegisterTransport';

jest.mock('child_process');
jest.mock('fs');

const mockSpawn = childProcess.spawn as jest.Mock;

class FakeChildProcess extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: jest.fn(), end: jest.fn() };
  kill = jest.fn();
}

function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('SystemConsoleTransport', () => {
  let fakeChild: FakeChildProcess;
  let writeFileSyncSpy: jest.Mock;

  beforeEach(() => {
    fakeChild = new FakeChildProcess();
    mockSpawn.mockReset();
    mockSpawn.mockImplementation(() => fakeChild as unknown as childProcess.ChildProcess);
    writeFileSyncSpy = fs.writeFileSync as jest.Mock;
    writeFileSyncSpy.mockReset();
    (fs.unlink as unknown as jest.Mock).mockReset();
  });

  function lastWrittenTcl(): string {
    const call = writeFileSyncSpy.mock.calls[writeFileSyncSpy.mock.calls.length - 1];
    return call[1] as string;
  }

  it('connect() discovers the master path via get_service_paths', async () => {
    const transport = new SystemConsoleTransport();
    const promise = transport.connect();
    await nextTick();

    expect(lastWrittenTcl()).toContain('get_service_paths master');

    fakeChild.stdout.emit('data', Buffer.from('@@MP /devices/USB-Blaster/master\n@@END\n'));
    fakeChild.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('connect() throws a setup error when get_service_paths returns empty', async () => {
    const transport = new SystemConsoleTransport();
    const promise = transport.connect();
    await nextTick();

    fakeChild.stdout.emit('data', Buffer.from('@@ERROR no_master\n@@END\n'));
    fakeChild.emit('close', 0);

    await expect(promise).rejects.toMatchObject<Partial<RegisterTransportError>>({
      category: 'setup',
    });
  });

  it('read32() issues master_read_32 with the byte address and parses @@VAL', async () => {
    const transport = new SystemConsoleTransport();
    const connectPromise = transport.connect();
    await nextTick();
    fakeChild.stdout.emit('data', Buffer.from('@@MP /devices/USB-Blaster/master\n@@END\n'));
    fakeChild.emit('close', 0);
    await connectPromise;

    fakeChild = new FakeChildProcess();
    mockSpawn.mockImplementation(() => fakeChild as unknown as childProcess.ChildProcess);

    const readPromise = transport.read32(0x00010010);
    await nextTick();

    const tcl = lastWrittenTcl();
    expect(tcl).toContain('set mp {/devices/USB-Blaster/master}');
    expect(tcl).toContain('master_read_32 $mp 65552 1');

    fakeChild.stdout.emit('data', Buffer.from('@@VAL 256\n@@END\n'));
    fakeChild.emit('close', 0);

    await expect(readPromise).resolves.toBe(256);
  });

  it('write32() issues master_write_32 with the value and parses @@WROTE', async () => {
    const transport = new SystemConsoleTransport();
    const connectPromise = transport.connect();
    await nextTick();
    fakeChild.stdout.emit('data', Buffer.from('@@MP /devices/USB-Blaster/master\n@@END\n'));
    fakeChild.emit('close', 0);
    await connectPromise;

    fakeChild = new FakeChildProcess();
    mockSpawn.mockImplementation(() => fakeChild as unknown as childProcess.ChildProcess);

    const writePromise = transport.write32(0x00010014, 0xff);
    await nextTick();

    const tcl = lastWrittenTcl();
    expect(tcl).toContain('master_write_32 $mp 65556 [list 255]');

    fakeChild.stdout.emit('data', Buffer.from('@@WROTE\n@@END\n'));
    fakeChild.emit('close', 0);

    await expect(writePromise).resolves.toBeUndefined();
  });

  it('tolerates chunked/interleaved stdout when parsing the sentinel', async () => {
    const transport = new SystemConsoleTransport();
    const promise = transport.connect();
    await nextTick();

    // Split the response across multiple 'data' events, including prompt-wrap noise.
    fakeChild.stdout.emit('data', Buffer.from('% source /tmp/foo.tcl\n% @@'));
    fakeChild.stdout.emit('data', Buffer.from('MP /devices/USB-Blaster'));
    fakeChild.stdout.emit('data', Buffer.from('/master\n'));
    fakeChild.stdout.emit('data', Buffer.from('@@END\n'));
    fakeChild.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('read32() before connect() throws a connection error without spawning', async () => {
    const transport = new SystemConsoleTransport();
    await expect(transport.read32(0)).rejects.toMatchObject<Partial<RegisterTransportError>>({
      category: 'connection',
    });
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('classifies open_service failure as a connection error', async () => {
    const transport = new SystemConsoleTransport();
    const connectPromise = transport.connect();
    await nextTick();
    fakeChild.stdout.emit('data', Buffer.from('@@MP /devices/USB-Blaster/master\n@@END\n'));
    fakeChild.emit('close', 0);
    await connectPromise;

    fakeChild = new FakeChildProcess();
    mockSpawn.mockImplementation(() => fakeChild as unknown as childProcess.ChildProcess);

    const readPromise = transport.read32(0x10);
    await nextTick();
    fakeChild.stdout.emit('data', Buffer.from('@@ERROR open: no target connected\n@@END\n'));
    fakeChild.emit('close', 0);

    await expect(readPromise).rejects.toMatchObject<Partial<RegisterTransportError>>({
      category: 'connection',
    });
  });

  it('classifies a system-console-not-found spawn error as a setup error', async () => {
    mockSpawn.mockImplementation(() => {
      const child = new FakeChildProcess();
      setTimeout(() => {
        const err = Object.assign(new Error('spawn system-console ENOENT'), { code: 'ENOENT' });
        child.emit('error', err);
      }, 0);
      return child as unknown as childProcess.ChildProcess;
    });

    const transport = new SystemConsoleTransport();
    await expect(transport.connect()).rejects.toMatchObject<Partial<RegisterTransportError>>({
      category: 'setup',
    });
  });

  it('rejects with a transaction error on timeout and kills the process', async () => {
    jest.useFakeTimers();
    const transport = new SystemConsoleTransport({ timeoutMs: 1000 });
    const promise = transport.connect();
    await Promise.resolve(); // let the spawn call happen

    jest.advanceTimersByTime(1000);
    const settled = expect(promise).rejects.toMatchObject<Partial<RegisterTransportError>>({
      category: 'transaction',
    });
    jest.useRealTimers();
    await settled;
    expect(fakeChild.kill).toHaveBeenCalled();
  });

  it('dispose() kills an in-flight process and rejects further transactions', async () => {
    const transport = new SystemConsoleTransport();
    const promise = transport.connect();
    await nextTick();

    transport.dispose();
    expect(fakeChild.kill).toHaveBeenCalled();

    mockSpawn.mockClear();
    await expect(transport.connect()).rejects.toMatchObject<Partial<RegisterTransportError>>({
      category: 'connection',
    });
    expect(mockSpawn).not.toHaveBeenCalled();

    // Let the original in-flight promise settle so it doesn't leak into other tests.
    fakeChild.emit('close', 0);
    await promise.catch(() => undefined);
  });
});
