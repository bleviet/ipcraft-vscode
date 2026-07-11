import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import { RegisterTransportError, type RegisterTransport } from './RegisterTransport';

export interface SystemConsoleTransportOptions {
  /** system-console executable — override for tests or a non-PATH install. Default 'system-console'. */
  executable?: string;
  /** Per-transaction timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Raw System Console dialogue sink — the "IPCraft Register Debug" Output Channel. */
  outputChannel?: vscode.OutputChannel;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Altera System Console transport: register peek/poke over JTAG via a
 * JTAG-to-Avalon-MM master (see altera_test_system.qsys.j2 includeDebugMaster).
 *
 * One `system-console --cli` process per transaction, not a persistent
 * subprocess. System Console discovers JTAG services at startup; a long-lived
 * process can miss the master service if `jtagd` isn't ready yet when it
 * starts, or a target attaches after the process is already up. This was
 * validated end-to-end on a DE10-Nano (see
 * examples/led_avmm/docs/systemconsole_implementation_plan.md #8 and
 * examples/led_avmm/altera/debug/debug_console.py, the Python prototype this
 * class ports 1:1). Because each transaction gets its own process, a single
 * `@@END` sentinel is sufficient — no per-request ID is needed.
 */
export class SystemConsoleTransport implements RegisterTransport {
  private masterPath: string | undefined;
  private currentProc: ChildProcess | undefined;
  private disposed = false;

  constructor(private readonly options: SystemConsoleTransportOptions = {}) {}

  async connect(): Promise<void> {
    const tcl = [
      'set _paths [get_service_paths master]',
      'if {[llength $_paths] == 0} {',
      '  puts "@@ERROR no_master"',
      '} else {',
      '  puts "@@MP [lindex $_paths 0]"',
      '}',
      'puts "@@END"',
    ].join('\n');

    const response = await this.runTcl(tcl);
    for (const rawLine of response.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('@@MP ')) {
        this.masterPath = stripBraces(line.slice(5).trim());
        return;
      }
      if (line.startsWith('@@ERROR')) {
        throw new RegisterTransportError(
          'No JTAG-to-Avalon-MM master service found. Ensure the debug variant ' +
            'bitstream (with a JTAG debug master) is programmed onto the board.',
          'setup'
        );
      }
    }
    throw new RegisterTransportError('Failed to discover JTAG master service', 'setup');
  }

  async read32(addr: number): Promise<number> {
    const mp = this.requireMasterPath();
    const tcl = [
      `set mp {${mp}}`,
      'if {[catch {open_service master $mp} err]} {',
      '  puts "@@ERROR open: $err"',
      '  puts "@@END"',
      '  return',
      '}',
      `set _r [master_read_32 $mp ${addr} 1]`,
      'close_service master $mp',
      'puts "@@VAL $_r"',
      'puts "@@END"',
    ].join('\n');

    const response = await this.runTcl(tcl);
    for (const rawLine of response.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('@@VAL ')) {
        const raw = stripBraces(line.slice(6).trim());
        const value = Number(raw);
        if (!Number.isFinite(value)) {
          throw new RegisterTransportError(`Could not parse read value: ${raw}`, 'transaction');
        }
        return value >>> 0;
      }
      if (line.startsWith('@@ERROR')) {
        throw this.classifyTclError(line);
      }
    }
    throw new RegisterTransportError(`No value in response: ${response}`, 'transaction');
  }

  async write32(addr: number, value: number): Promise<void> {
    const mp = this.requireMasterPath();
    const tcl = [
      `set mp {${mp}}`,
      'if {[catch {open_service master $mp} err]} {',
      '  puts "@@ERROR open: $err"',
      '  puts "@@END"',
      '  return',
      '}',
      `master_write_32 $mp ${addr} [list ${value}]`,
      'close_service master $mp',
      'puts "@@WROTE"',
      'puts "@@END"',
    ].join('\n');

    const response = await this.runTcl(tcl);
    for (const rawLine of response.split('\n')) {
      const line = rawLine.trim();
      if (line.startsWith('@@WROTE')) {
        return;
      }
      if (line.startsWith('@@ERROR')) {
        throw this.classifyTclError(line);
      }
    }
    throw new RegisterTransportError(`No confirmation in response: ${response}`, 'transaction');
  }

  dispose(): void {
    this.disposed = true;
    this.currentProc?.kill();
    this.currentProc = undefined;
  }

  private requireMasterPath(): string {
    if (!this.masterPath) {
      throw new RegisterTransportError('Not connected — call connect() first', 'connection');
    }
    return this.masterPath;
  }

  private classifyTclError(line: string): RegisterTransportError {
    if (line.includes('open:')) {
      return new RegisterTransportError(line, 'connection');
    }
    return new RegisterTransportError(line, 'transaction');
  }

  /**
   * Writes `tclScript` to a temp file and pipes `source <file>` into a fresh
   * `system-console --cli` process, returning all output up to `@@END`.
   * Sourcing a file (rather than inlining commands on stdin) avoids
   * System Console's ~80-column echo wrapping, which otherwise splits long
   * commands like `master_read_32 <long-path> <addr> 1` across multiple
   * lines and breaks sentinel parsing (validated on hardware).
   */
  private runTcl(tclScript: string): Promise<string> {
    if (this.disposed) {
      return Promise.reject(new RegisterTransportError('Transport disposed', 'connection'));
    }
    const executable = this.options.executable ?? 'system-console';
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const tmpPath = path.join(
      os.tmpdir(),
      `ipcraft-sc-${Date.now()}-${Math.random().toString(36).slice(2)}.tcl`
    );
    fs.writeFileSync(tmpPath, tclScript, 'utf8');

    this.options.outputChannel?.appendLine(`\n> source ${tmpPath}`);
    this.options.outputChannel?.appendLine(tclScript);

    return new Promise((resolve, reject) => {
      let proc: ChildProcess;
      try {
        proc = spawn(executable, ['--cli'], { stdio: 'pipe' });
      } catch (err) {
        this.cleanupTmp(tmpPath);
        reject(this.spawnError(err));
        return;
      }
      this.currentProc = proc;

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        proc.kill();
        this.cleanupTmp(tmpPath);
        reject(
          new RegisterTransportError(`system-console timed out after ${timeoutMs}ms`, 'transaction')
        );
      }, timeoutMs);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.cleanupTmp(tmpPath);
        reject(this.spawnError(err));
      });

      proc.on('close', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.currentProc = undefined;
        this.cleanupTmp(tmpPath);
        if (stdout) {
          this.options.outputChannel?.appendLine(stdout);
        }
        if (stderr) {
          this.options.outputChannel?.appendLine(`[ERR] ${stderr}`);
        }
        const parsed = extractUntilSentinel(stdout, tmpPath);
        if (parsed === undefined) {
          reject(
            new RegisterTransportError(
              `system-console did not emit @@END. stderr: ${stderr.trim() || '(none)'}`,
              'transaction'
            )
          );
          return;
        }
        resolve(parsed);
      });

      proc.stdin?.write(`source ${tmpPath}\n`);
      proc.stdin?.end();
    });
  }

  private spawnError(err: unknown): RegisterTransportError {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === 'ENOENT') {
      return new RegisterTransportError(
        `'system-console' not found — is a Quartus installation on PATH?`,
        'setup'
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return new RegisterTransportError(msg, 'setup');
  }

  private cleanupTmp(tmpPath: string): void {
    fs.unlink(tmpPath, () => {
      // best-effort cleanup — a leftover temp file is not fatal.
    });
  }
}

function stripBraces(value: string): string {
  return value.replace(/^\{/, '').replace(/\}$/, '');
}

/**
 * Parses combined stdout up to the `@@END` sentinel, stripping System
 * Console's `% ` prompt-wrap prefix and the `source <file>` echo line.
 * Operates on the fully-accumulated string, so it is inherently tolerant of
 * chunked/interleaved stdout — chunk boundaries never affect the result.
 */
function extractUntilSentinel(output: string, tmpPath: string): string | undefined {
  const lines: string[] = [];
  let sawEnd = false;
  for (const rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (line.startsWith('% ')) {
      line = line.slice(2).trim();
    } else if (line === '%') {
      continue;
    }
    if (line === '@@END') {
      sawEnd = true;
      break;
    }
    if (line.startsWith('source ') && line.includes(tmpPath)) {
      continue;
    }
    if (!line) {
      continue;
    }
    lines.push(line);
  }
  return sawEnd ? lines.join('\n') : undefined;
}
