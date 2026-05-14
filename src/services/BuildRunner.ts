import { spawn } from 'child_process';
import * as vscode from 'vscode';

export interface BuildRunOptions {
  cwd: string;
  outputChannel: vscode.OutputChannel;
}

export interface BuildResult {
  success: boolean;
  exitCode: number;
}

export function runProcess(
  executable: string,
  args: string[],
  options: BuildRunOptions
): Promise<BuildResult> {
  const { cwd, outputChannel } = options;
  outputChannel.appendLine(`\n> ${executable} ${args.join(' ')}`);
  outputChannel.appendLine(`  cwd: ${cwd}\n`);

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(executable, args, { cwd, stdio: 'pipe' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[ERROR] Failed to start process: ${msg}`);
      resolve({ success: false, exitCode: -1 });
      return;
    }

    proc.stdout?.on('data', (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => outputChannel.appendLine(line));
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      chunk
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .forEach((line) => outputChannel.appendLine(`[ERR] ${line}`));
    });

    proc.on('error', (err) => {
      outputChannel.appendLine(`[ERROR] ${err.message}`);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        outputChannel.appendLine(
          `       '${executable}' not found — is it installed and in your PATH?\n` +
            `       Configure the path in Settings → IPCraft.`
        );
      }
      resolve({ success: false, exitCode: -1 });
    });

    proc.on('close', (code) => {
      const exitCode = code ?? -1;
      outputChannel.appendLine(`\n[exit ${exitCode}]`);
      resolve({ success: exitCode === 0, exitCode });
    });
  });
}
