import { runProcess } from '../../../services/BuildRunner';

const channel = () => {
  const lines: string[] = [];
  return { lines, appendLine: (line: string) => void lines.push(line) };
};

const node = process.execPath;
const sleeper = ['-e', 'console.log("started"); setTimeout(() => {}, 60000);'];

describe('runProcess', () => {
  it('reports the exit code of a process that finishes', async () => {
    const out = channel();
    const result = await runProcess(node, ['-e', 'console.log("hi"); process.exit(3)'], {
      cwd: process.cwd(),
      outputChannel: out,
    });
    expect(result).toEqual({ success: false, exitCode: 3 });
    expect(out.lines).toContain('hi');
  });

  it('kills the process when the signal aborts and reports a failure', async () => {
    const out = channel();
    const abort = new AbortController();
    const running = runProcess(node, sleeper, {
      cwd: process.cwd(),
      outputChannel: out,
      signal: abort.signal,
    });
    await new Promise<void>((resolve) => {
      const wait = setInterval(() => {
        if (out.lines.includes('started')) {
          clearInterval(wait);
          resolve();
        }
      }, 10);
    });
    abort.abort();
    const result = await running;
    expect(result.success).toBe(false);
    expect(out.lines).toContain('\n[CANCELLED] Process killed');
  }, 20000);

  it('does not start a process that is already aborted for long', async () => {
    const abort = new AbortController();
    abort.abort();
    const result = await runProcess(node, sleeper, {
      cwd: process.cwd(),
      outputChannel: channel(),
      signal: abort.signal,
    });
    expect(result.success).toBe(false);
  }, 20000);

  it('leaves a process alone when its signal never aborts', async () => {
    const abort = new AbortController();
    const result = await runProcess(node, ['-e', ''], {
      cwd: process.cwd(),
      outputChannel: channel(),
      signal: abort.signal,
    });
    expect(result).toEqual({ success: true, exitCode: 0 });
    expect(() => abort.abort()).not.toThrow();
  });

  it('gives the child a closed stdin, so a tool that waits for input sees its end', async () => {
    const out = channel();
    const waitForStdin =
      'process.stdin.on("end", () => process.exit(3)); process.stdin.resume(); console.log("waiting");';
    const result = await runProcess(node, ['-e', waitForStdin], {
      cwd: process.cwd(),
      outputChannel: out,
      timeoutMs: 15000,
    });
    expect(result).toEqual({ success: false, exitCode: 3 });
    expect(out.lines).not.toContain('\n[TIMEOUT] Process killed after 15000ms');
  }, 20000);
});
