import { spawn } from 'child_process';
import { randomUUID } from 'crypto';

export type ProcessTreeTerminator = (child: ReturnType<typeof spawn>) => void | Promise<void>;

/** Create a tree terminator for the host platform. The parameter is a testable OS boundary. */
export function createProcessTreeTerminator(
  platform: NodeJS.Platform = process.platform
): ProcessTreeTerminator {
  return async (child) => {
    const pid = child.pid;
    if (pid !== undefined && platform === 'win32') {
      const exitCode = await new Promise<number>((resolve) => {
        const taskkill = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        taskkill.once('error', () => resolve(-1));
        taskkill.once('close', (code) => resolve(code ?? -1));
      });
      if (exitCode !== 0) {
        throw new Error(`taskkill failed for process tree ${pid} with exit code ${exitCode}.`);
      }
      return;
    }

    if (pid !== undefined) {
      signalPosixProcessGroup(pid, 'SIGTERM');
    }
    child.kill('SIGTERM');
    await cancellationGracePeriod();
    if (pid !== undefined) {
      signalPosixProcessGroup(pid, 'SIGKILL');
    }
    try {
      child.kill('SIGKILL');
    } catch {
      // The root child may already have exited while descendants were signalled.
    }
  };
}

/** Terminate only the process tree rooted at `child`. */
export const terminateProcessTree = createProcessTreeTerminator();

function signalPosixProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    const processError = error as NodeJS.ErrnoException;
    if (processError.code === 'ESRCH') {
      return;
    }
    const detail = processError.code
      ? `${processError.code}: ${processError.message}`
      : error instanceof Error
        ? error.message
        : String(error);
    throw new Error(`Failed to signal process group ${-pid} with ${signal}: ${detail}`);
  }
}

export function createDockerContainerName(): string {
  return `ipcraft-${process.pid}-${randomUUID()}`;
}

/** Stop the client tree first, then remove and verify its exact daemon-owned container. */
export async function terminateDockerProcess(
  child: ReturnType<typeof spawn>,
  containerName: string,
  terminateTree: ProcessTreeTerminator
): Promise<void> {
  try {
    await terminateTree(child);
  } finally {
    await removeDockerContainer(containerName);
  }
}

function cancellationGracePeriod(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000);
    timer.unref?.();
  });
}

async function removeDockerContainer(containerName: string): Promise<void> {
  const removal = await runDockerControl(['rm', '-f', containerName], 'ignore');
  const inspection = await runDockerControl(
    ['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}'],
    'pipe'
  );
  if (inspection.exitCode !== 0) {
    throw new Error(
      `Could not confirm removal of Docker container ${containerName}: ${inspection.stderr || removal.stderr || `docker ps exited ${inspection.exitCode}`}`
    );
  }
  if (inspection.stdout.split(/\r?\n/).some((line) => line.trim() === containerName)) {
    throw new Error(
      `Docker container ${containerName} is still running after cleanup: ${removal.stderr || `docker rm exited ${removal.exitCode}`}`
    );
  }
}

function runDockerControl(
  args: string[],
  stdio: 'ignore' | 'pipe'
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const finish = (exitCode: number): void => {
      if (!settled) {
        settled = true;
        resolve({ exitCode, stdout, stderr });
      }
    };
    try {
      const control = spawn('docker', args, { stdio, windowsHide: true });
      control.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      control.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      control.once('error', () => finish(-1));
      control.once('close', (code) => finish(code ?? -1));
    } catch (error) {
      stderr = error instanceof Error ? error.message : String(error);
      finish(-1);
    }
  });
}
