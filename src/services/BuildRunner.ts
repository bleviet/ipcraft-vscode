import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtraMountSpec } from './toolchains/LaunchableTool';

export interface DockerOptions {
  /** Docker image to run the tool inside (e.g. `cvsoc/quartus:23.1`). */
  image: string;
  /**
   * Host directory mounted as `/work` inside the container.
   * All absolute path arguments under this directory are translated
   * to their `/work/…` equivalents automatically.
   */
  mountBase: string;
}

export interface BuildRunOptions {
  cwd: string;
  outputChannel: vscode.OutputChannel;
  docker?: DockerOptions;
  /** Extra environment variables forwarded to the child process (local) or as
   *  `-e KEY=VALUE` flags (Docker). Merged on top of the inherited process env. */
  env?: Record<string, string>;
  /** Additional Docker bind-mounts beyond the primary `mountBase:/work` one.
   *  Ignored when running locally. */
  extraMounts?: ExtraMountSpec[];
  /** Hard-kill timeout in milliseconds. Undefined = no timeout. */
  timeoutMs?: number;
}

export interface BuildResult {
  success: boolean;
  exitCode: number;
}

const CONTAINER_MOUNT = '/work';

function applyDocker(
  executable: string,
  args: string[],
  cwd: string,
  docker: DockerOptions,
  env: Record<string, string>,
  extraMounts: ExtraMountSpec[]
): { executable: string; args: string[]; cwd: string } {
  const base = path.normalize(docker.mountBase);
  const relCwd = path.relative(base, cwd).replace(/\\/g, '/');
  const containerCwd = relCwd ? `${CONTAINER_MOUNT}/${relCwd}` : CONTAINER_MOUNT;

  const translatedArgs = args.map((arg) => {
    const norm = path.normalize(arg);
    if (path.isAbsolute(norm) && norm.startsWith(base + path.sep)) {
      return CONTAINER_MOUNT + '/' + path.relative(base, norm).replace(/\\/g, '/');
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
  const { cwd, outputChannel, docker, env = {}, extraMounts = [], timeoutMs } = options;

  let spawnExe = executable;
  let spawnArgs = args;
  let spawnCwd = cwd;

  if (docker?.image) {
    const dockerized = applyDocker(executable, args, cwd, docker, env, extraMounts);
    spawnExe = dockerized.executable;
    spawnArgs = dockerized.args;
    spawnCwd = dockerized.cwd;
  }

  outputChannel.appendLine(`\n> ${spawnExe} ${spawnArgs.join(' ')}`);
  outputChannel.appendLine(`  cwd: ${spawnCwd}\n`);

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      const spawnEnv = docker?.image ? undefined : { ...process.env, ...env };
      proc = spawn(spawnExe, spawnArgs, { cwd: spawnCwd, env: spawnEnv, stdio: 'pipe' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      outputChannel.appendLine(`[ERROR] Failed to start process: ${msg}`);
      resolve({ success: false, exitCode: -1 });
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        outputChannel.appendLine(`\n[TIMEOUT] Process killed after ${timeoutMs}ms`);
        proc.kill();
      }, timeoutMs);
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
      clearTimeout(timer);
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
      resolve({ success: false, exitCode: -1 });
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      outputChannel.appendLine(`\n[exit ${exitCode}]`);
      resolve({ success: exitCode === 0, exitCode });
    });
  });
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

  let spawnExe = executable;
  let spawnArgs = args;

  if (docker?.image) {
    const x11Flags: string[] =
      x11 && process.env.DISPLAY
        ? ['-e', `DISPLAY=${process.env.DISPLAY}`, '-v', '/tmp/.X11-unix:/tmp/.X11-unix']
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
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', (err: Error & { code?: string }) => {
    if (err.code === 'ENOENT') {
      if (docker?.image) {
        void vscode.window.showErrorMessage(
          `Could not find 'docker'. Is Docker installed and in your PATH?`
        );
      } else {
        void vscode.window.showErrorMessage(
          `Could not find ${toolDisplayName} executable '${executable}'. ` +
            `Check the IPCraft settings for ${toolDisplayName}.`
        );
      }
    } else {
      void vscode.window.showErrorMessage(`Failed to start ${toolDisplayName}: ${err.message}`);
    }
  });

  child.unref();
}
