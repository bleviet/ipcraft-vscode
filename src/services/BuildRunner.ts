import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

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
  docker: DockerOptions
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

  return {
    executable: 'docker',
    args: [
      'run',
      '--rm',
      '-v',
      `${base}:${CONTAINER_MOUNT}`,
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
  const { cwd, outputChannel, docker } = options;

  let spawnExe = executable;
  let spawnArgs = args;
  let spawnCwd = cwd;

  if (docker?.image) {
    const dockerized = applyDocker(executable, args, cwd, docker);
    spawnExe = dockerized.executable;
    spawnArgs = dockerized.args;
    spawnCwd = dockerized.cwd;
  }

  outputChannel.appendLine(`\n> ${spawnExe} ${spawnArgs.join(' ')}`);
  outputChannel.appendLine(`  cwd: ${spawnCwd}\n`);

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(spawnExe, spawnArgs, { cwd: spawnCwd, stdio: 'pipe' });
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
      const exitCode = code ?? -1;
      outputChannel.appendLine(`\n[exit ${exitCode}]`);
      resolve({ success: exitCode === 0, exitCode });
    });
  });
}
