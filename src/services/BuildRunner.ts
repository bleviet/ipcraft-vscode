import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtraMountSpec } from './toolchains/LaunchableTool';
import {
  createDockerContainerName,
  terminateDockerProcess,
  terminateProcessTree,
  type ProcessTreeTerminator,
} from './ProcessTreeTermination';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

export interface DockerOptions {
  /** Docker image to run the tool inside (e.g. `cvsoc/quartus:23.1`). */
  image: string;
  /**
   * Host directory mounted as `/work` inside the container.
   * All absolute path arguments under this directory are translated
   * to their `/work/…` equivalents automatically.
   */
  mountBase: string;
  /** Docker image pull behavior. Omitted for the existing Docker default. */
  pull?: 'always' | 'missing' | 'never';
}

export interface BuildRunOptions {
  cwd: string;
  outputChannel: Pick<vscode.OutputChannel, 'appendLine'>;
  docker?: DockerOptions;
  /** Extra environment variables forwarded to the child process (local) or as
   *  `-e KEY=VALUE` flags (Docker). Merged on top of the inherited process env. */
  env?: Record<string, string>;
  /** Additional Docker bind-mounts beyond the primary `mountBase:/work` one.
   *  Ignored when running locally. */
  extraMounts?: ExtraMountSpec[];
  /** Hard-kill timeout in milliseconds. Undefined = no timeout. */
  timeoutMs?: number;
  /** Stops the launched process when cancellation is requested. */
  cancellationToken?: vscode.CancellationToken;
  /** Observes complete output lines after they have been copied to the channel. */
  onOutputLine?: (line: string, source: 'stdout' | 'stderr') => void;
  /**
   * Terminates the complete process tree rooted at the launched child. The
   * default uses a dedicated POSIX process group or Windows `taskkill /T`.
   * Tests and specialized hosts may replace it without changing run callers.
   */
  terminateProcessTree?: ProcessTreeTerminator;
}

export { terminateProcessTree, type ProcessTreeTerminator } from './ProcessTreeTermination';

export interface BuildResult {
  success: boolean;
  exitCode: number;
  cancelled?: boolean;
  diagnostic?: string;
}

const CONTAINER_MOUNT = '/work';

function applyDocker(
  executable: string,
  args: string[],
  cwd: string,
  docker: DockerOptions,
  env: Record<string, string>,
  extraMounts: ExtraMountSpec[],
  containerName?: string
): { executable: string; args: string[]; cwd: string } {
  const base = path.normalize(docker.mountBase);
  const relCwd = path.relative(base, cwd).replace(/\\/g, '/');
  const containerCwd = relCwd ? `${CONTAINER_MOUNT}/${relCwd}` : CONTAINER_MOUNT;

  const translatedArgs = args.map((arg) => {
    const assignment = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    const value = assignment?.[2] ?? arg;
    const norm = path.normalize(value);
    if (path.isAbsolute(norm) && norm.startsWith(base + path.sep)) {
      const translated = CONTAINER_MOUNT + '/' + path.relative(base, norm).replace(/\\/g, '/');
      return assignment ? `${assignment[1]}=${translated}` : translated;
    }
    return arg;
  });

  const envFlags = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
  const mountFlags = extraMounts.flatMap(({ host, container, ro }) => [
    '-v',
    `${host}:${container}${ro ? ':ro' : ''}`,
  ]);

  return {
    executable: 'docker',
    args: [
      'run',
      '--rm',
      ...(docker.pull ? ['--pull', docker.pull] : []),
      ...(containerName ? ['--name', containerName] : []),
      '-v',
      `${base}:${CONTAINER_MOUNT}`,
      ...mountFlags,
      ...envFlags,
      '-w',
      containerCwd,
      docker.image,
      executable,
      ...translatedArgs,
    ],
    cwd,
  };
}

export function runProcess(
  executable: string,
  args: string[],
  options: BuildRunOptions
): Promise<BuildResult> {
  const {
    cwd,
    outputChannel,
    docker,
    env = {},
    extraMounts = [],
    timeoutMs,
    cancellationToken,
    onOutputLine,
    terminateProcessTree: terminateTree = terminateProcessTree,
  } = options;

  let spawnExe = executable;
  let spawnArgs = args;
  let spawnCwd = cwd;
  const usesTreeTermination = cancellationToken !== undefined || timeoutMs !== undefined;
  const dockerContainerName =
    docker?.image && usesTreeTermination ? createDockerContainerName() : undefined;

  if (docker?.image) {
    const dockerized = applyDocker(
      executable,
      args,
      cwd,
      docker,
      env,
      extraMounts,
      dockerContainerName
    );
    spawnExe = dockerized.executable;
    spawnArgs = dockerized.args;
    spawnCwd = dockerized.cwd;
  }

  outputChannel.appendLine(`\n> ${spawnExe} ${spawnArgs.join(' ')}`);
  outputChannel.appendLine(`  cwd: ${spawnCwd}\n`);

  if (cancellationToken?.isCancellationRequested) {
    outputChannel.appendLine('[CANCELLED] Process was not started.');
    return Promise.resolve({ success: false, exitCode: -1, cancelled: true });
  }

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      const spawnEnv = docker?.image ? undefined : { ...process.env, ...env };
      proc = spawn(spawnExe, spawnArgs, {
        cwd: spawnCwd,
        env: spawnEnv,
        stdio: 'pipe',
        // Cancellation needs a process-group boundary on POSIX so descendants
        // can be signalled without touching unrelated processes.
        detached: usesTreeTermination && process.platform !== 'win32',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[ERROR] Failed to start process: ${msg}`);
      resolve({ success: false, exitCode: -1 });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    let timedOut = false;
    let terminationRequested = false;
    let terminationPromise: Promise<void> | undefined;
    let terminationError: Error | undefined;
    let settled = false;
    let completionStarted = false;
    const cancellationState: { subscription?: vscode.Disposable } = {};
    const settle = (result: BuildResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      cancellationState.subscription?.dispose();
      resolve(result);
    };
    const recordTerminationError = (error: unknown): void => {
      terminationError = error instanceof Error ? error : new Error(String(error));
      const diagnostic = `Failed to terminate process tree: ${terminationError.message}`;
      outputChannel.appendLine(`[ERROR] ${diagnostic}`);
      settle({ success: false, exitCode: -1, diagnostic });
    };
    const requestTermination = (): void => {
      if (terminationRequested) {
        return;
      }
      terminationRequested = true;
      try {
        const termination = dockerContainerName
          ? terminateDockerProcess(proc, dockerContainerName, terminateTree)
          : Promise.resolve(terminateTree(proc));
        terminationPromise = termination.catch((error: unknown) => {
          recordTerminationError(error);
        });
      } catch (error) {
        terminationPromise = Promise.resolve();
        recordTerminationError(error);
      }
    };
    const completeAfterTermination = (result: BuildResult): void => {
      if (completionStarted) {
        return;
      }
      completionStarted = true;
      void (async () => {
        if (terminationRequested) {
          await terminationPromise;
        }
        settle(
          terminationError
            ? {
                success: false,
                exitCode: -1,
                diagnostic: `Failed to terminate process tree: ${terminationError.message}`,
              }
            : result
        );
      })();
    };
    cancellationState.subscription = cancellationToken?.onCancellationRequested(() => {
      cancelled = true;
      outputChannel.appendLine('\n[CANCELLED] Process termination requested.');
      requestTermination();
    });
    if (settled) {
      cancellationState.subscription?.dispose();
    }
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        outputChannel.appendLine(`\n[TIMEOUT] Process killed after ${timeoutMs}ms`);
        requestTermination();
      }, timeoutMs);
    }

    const stdout = createLineForwarder((line) => {
      outputChannel.appendLine(line);
      onOutputLine?.(line, 'stdout');
    });
    const stderr = createLineForwarder((line) => {
      outputChannel.appendLine(`[ERR] ${line}`);
      onOutputLine?.(line, 'stderr');
    });
    proc.stdout?.on('data', stdout.accept);
    proc.stderr?.on('data', stderr.accept);

    proc.on('error', (err) => {
      if (settled) {
        return;
      }
      stdout.flush();
      stderr.flush();
      outputChannel.appendLine(`[ERROR] ${err.message}`);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        if (docker?.image) {
          outputChannel.appendLine(
            `       'docker' not found — is Docker installed and in your PATH?`
          );
        } else {
          outputChannel.appendLine(
            `       '${spawnExe}' not found — is it installed and in your PATH?\n` +
              `       Configure the path in Settings → IPCraft.`
          );
        }
      }
      completeAfterTermination({
        success: false,
        exitCode: -1,
        ...(cancelled ? { cancelled: true } : {}),
      });
    });

    proc.on('close', (code) => {
      if (settled) {
        return;
      }
      stdout.flush();
      stderr.flush();
      const exitCode = code ?? -1;
      outputChannel.appendLine(`\n[exit ${exitCode}]`);
      completeAfterTermination({
        success: exitCode === 0 && !cancelled && !timedOut,
        exitCode,
        ...(cancelled ? { cancelled: true } : {}),
        ...(timedOut ? { diagnostic: `Process timed out after ${timeoutMs}ms.` } : {}),
      });
    });
  });
}

function createLineForwarder(forward: (line: string) => void): {
  accept: (chunk: Buffer) => void;
  flush: () => void;
} {
  let pending = '';
  const emitCompleteLines = (): void => {
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    lines.filter(Boolean).forEach(forward);
  };
  return {
    accept(chunk: Buffer): void {
      pending += chunk.toString();
      emitCompleteLines();
    },
    flush(): void {
      if (pending) {
        forward(pending);
        pending = '';
      }
    },
  };
}

export interface GuiLaunchOptions {
  cwd: string;
  docker?: DockerOptions;
  env?: Record<string, string>;
  extraMounts?: ExtraMountSpec[];
  /** X11 forwarding: pass the host DISPLAY socket through. Default: true. */
  x11?: boolean;
}

/**
 * Spawn a detached GUI process (Vivado GUI, Quartus GUI, Platform Designer).
 * Returns immediately — the spawned process outlives VS Code.
 * On ENOENT or other errors, shows a VS Code error notification.
 */
export function spawnGui(
  executable: string,
  args: string[],
  options: GuiLaunchOptions,
  toolDisplayName: string
): void {
  const { cwd, docker, env = {}, extraMounts = [], x11 = true } = options;

  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const customDisplay = cfg.get<string>('gui.display') || process.env.DISPLAY;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const customXAuth = cfg.get<string>('gui.xauthority') || process.env.XAUTHORITY;

  const spawnEnv = { ...process.env, ...env };
  if (customDisplay) {
    spawnEnv.DISPLAY = customDisplay;
  }
  if (customXAuth) {
    spawnEnv.XAUTHORITY = customXAuth;
  }

  let spawnExe = executable;
  let spawnArgs = args;

  if (docker?.image) {
    const x11Flags: string[] =
      x11 && customDisplay
        ? ['-e', `DISPLAY=${customDisplay}`, '-v', '/tmp/.X11-unix:/tmp/.X11-unix']
        : [];
    const envFlags = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    const mountFlags = extraMounts.flatMap(({ host, container, ro }) => [
      '-v',
      `${host}:${container}${ro ? ':ro' : ''}`,
    ]);
    const base = path.normalize(docker.mountBase);
    const toContainer = (p: string) =>
      CONTAINER_MOUNT + '/' + path.relative(base, p).replace(/\\/g, '/');

    const translatedArgs = args.map((a) => {
      const norm = path.normalize(a);
      return path.isAbsolute(norm) && norm.startsWith(base + path.sep) ? toContainer(norm) : a;
    });

    spawnExe = 'docker';
    spawnArgs = [
      'run',
      '--rm',
      ...x11Flags,
      '-v',
      `${base}:${CONTAINER_MOUNT}`,
      ...mountFlags,
      ...envFlags,
      '-w',
      toContainer(cwd),
      docker.image,
      executable,
      ...translatedArgs,
    ];
  }

  const child = spawn(spawnExe, spawnArgs, {
    cwd,
    env: spawnEnv,
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'ENOENT') {
      if (docker?.image) {
        void handleErrorWithUserNotification(
          err,
          'spawnGui.docker',
          `Could not find 'docker'. Is Docker installed and in your PATH?`
        );
      } else {
        void handleErrorWithUserNotification(
          err,
          'spawnGui',
          `Could not find ${toolDisplayName} executable '${executable}'. ` +
            `Check the IPCraft settings for ${toolDisplayName}.`
        );
      }
    } else {
      void handleErrorWithUserNotification(
        err,
        'spawnGui',
        `Failed to start ${toolDisplayName}: ${err.message}`
      );
    }
  });

  child.unref();
}
