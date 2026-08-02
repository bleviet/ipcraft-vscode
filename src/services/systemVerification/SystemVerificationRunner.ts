import { spawnSync } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import Ajv from 'ajv';
import * as vscode from 'vscode';
import type {
  SystemVerificationLifecycleEvent,
  SystemVerificationResult,
  SystemVerificationRouteSummary,
  SystemVerificationStage,
} from '../../domain/systemVerification.types';
import { Logger } from '../../utils/Logger';
import { runProcess, type BuildResult, type DockerOptions } from '../BuildRunner';
import type { ExtraMountSpec } from '../toolchains/LaunchableTool';
import { getToolchain } from '../toolchains/registry';

const processLifecycleStages: ReadonlyArray<SystemVerificationStage> = [
  'discover',
  'plan',
  'compile',
  'run',
];
const lifecycleMarkerPrefix = 'IPCRAFT_LIFECYCLE:';
const resultFileName = 'result.json';
const logFileName = 'system-verification.log';
const waveformExtensions = new Set(['.wdb', '.vcd', '.fst']);

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['outcome'],
  properties: {
    outcome: { enum: ['passed', 'failed', 'cancelled'] },
    firstFailure: { type: 'string', minLength: 1 },
    route: {
      type: 'object',
      additionalProperties: false,
      required: ['driveInterfacePath', 'instancePath', 'baseAddress'],
      properties: {
        driveInterfacePath: { type: 'string', minLength: 1 },
        instancePath: { type: 'string', minLength: 1 },
        baseAddress: { type: 'integer', minimum: 0 },
      },
    },
  },
  allOf: [
    {
      if: { properties: { outcome: { const: 'passed' } } },
      then: { required: ['route'] },
    },
  ],
} as const;

const resultValidator = new Ajv({ allErrors: true, strict: false }).compile(resultSchema);

interface ParsedRunResult {
  readonly outcome: 'passed' | 'failed' | 'cancelled';
  readonly firstFailure?: string;
  readonly route?: SystemVerificationRouteSummary;
}

export interface SystemVerificationRunRequest {
  readonly configPath: string;
  readonly workspaceRoot: string;
  readonly workspaceConfiguration: vscode.WorkspaceConfiguration;
  readonly waves?: boolean;
}

export interface SystemVerificationRunEvent extends SystemVerificationLifecycleEvent {
  readonly runDirectory: string;
  readonly logsPath: string;
  readonly waveformPath?: string;
  readonly route?: SystemVerificationRouteSummary;
}

export interface SystemVerificationVivadoLaunch {
  readonly vivadoCommand: string;
  readonly docker?: DockerOptions;
  readonly env?: Record<string, string>;
  readonly extraMounts?: ExtraMountSpec[];
}

export type SystemVerificationProcessProbe = (
  executable: string,
  args: string[],
  options: {
    cwd: string;
    outputChannel: Pick<vscode.OutputChannel, 'appendLine'>;
    cancellationToken: vscode.CancellationToken;
    env: Record<string, string>;
    docker?: DockerOptions;
    extraMounts?: ExtraMountSpec[];
    onOutputLine: (line: string) => void;
  }
) => Promise<BuildResult>;

export interface SystemVerificationDockerPreflightResult {
  readonly available: boolean;
  readonly cancelled?: boolean;
  readonly diagnostic?: string;
}

export interface SystemVerificationRunnerDependencies {
  readonly runProcess: SystemVerificationProcessProbe;
  readonly verifyGnuMake: () => boolean;
  readonly verifyDockerEnvironment: (
    launch: SystemVerificationVivadoLaunch,
    cancellationToken: vscode.CancellationToken,
    outputChannel: Pick<vscode.OutputChannel, 'appendLine'>
  ) => Promise<SystemVerificationDockerPreflightResult>;
  readonly verifyVivado: (
    request: SystemVerificationRunRequest
  ) => SystemVerificationVivadoLaunch | undefined;
  readonly outputChannel: Pick<vscode.OutputChannel, 'appendLine'>;
  readonly now: () => number;
}

let outputChannel: vscode.OutputChannel | undefined;

/** Dedicated raw output channel for system-verification runs. */
export function getSystemVerificationOutputChannel(): vscode.OutputChannel {
  outputChannel ??= vscode.window.createOutputChannel('IPCraft System Verification');
  return outputChannel;
}

/** Runs the tracked Makefile and converts its schema-checked artifact to a typed result. */
export class SystemVerificationRunner {
  private readonly logger = new Logger('SystemVerificationRunner');

  constructor(private readonly dependencies: SystemVerificationRunnerDependencies = defaults()) {}

  async run(
    request: SystemVerificationRunRequest,
    onEvent: (event: SystemVerificationRunEvent) => void,
    cancellationToken: vscode.CancellationToken
  ): Promise<SystemVerificationResult> {
    const runDirectory = await allocateRunDirectory(request.workspaceRoot);
    const logsPath = path.join(runDirectory, logFileName);
    await fs.writeFile(logsPath, '', 'utf8');
    const runOutput = createRunOutput(this.dependencies.outputChannel, logsPath);
    const verificationDirectory = path.dirname(path.resolve(request.configPath));
    let lastTimestamp = Number.NEGATIVE_INFINITY;
    const emit = (
      stage: SystemVerificationStage,
      waveformPath?: string,
      route?: SystemVerificationRouteSummary
    ): void => {
      const timestamp = Math.max(this.dependencies.now(), lastTimestamp + 1);
      lastTimestamp = timestamp;
      onEvent({ stage, timestamp, runDirectory, logsPath, waveformPath, route });
    };
    const completeCancelled = async (): Promise<SystemVerificationResult> => {
      runOutput.appendLine('[CANCELLED] System verification was not started.');
      const route = await readExistingResultRoute(runDirectory);
      const result: SystemVerificationResult = {
        outcome: 'cancelled',
        runDirectory,
        logsPath,
        ...(route ? { route } : {}),
      };
      await writeResultAtomically(runDirectory, { outcome: 'cancelled', route });
      emit('complete');
      await runOutput.flush();
      return result;
    };
    const completeFailed = async (diagnostic: string): Promise<SystemVerificationResult> => {
      runOutput.appendLine(`[ERROR] Preflight failed: ${diagnostic}`);
      const result: SystemVerificationResult = {
        outcome: 'failed',
        runDirectory,
        logsPath,
        firstFailure: diagnostic,
      };
      emit('complete');
      await runOutput.flush();
      return result;
    };

    emit('preflight');
    if (cancellationToken.isCancellationRequested) {
      return await completeCancelled();
    }

    let vivadoLaunch: SystemVerificationVivadoLaunch;
    try {
      vivadoLaunch = await this.preflight(request, cancellationToken, runOutput);
    } catch (error) {
      if (error instanceof SystemVerificationPreflightDiagnosticError) {
        return await completeFailed(error.message);
      }
      if (error instanceof SystemVerificationPreflightCancelledError) {
        return await completeCancelled();
      }
      const message = error instanceof Error ? error.message : String(error);
      runOutput.appendLine(`[ERROR] Preflight failed: ${message}`);
      await runOutput.flush();
      this.logger.error(
        'System verification preflight failed',
        error instanceof Error ? error : new Error(message),
        { runDirectory }
      );
      return await completeFailed(message);
    }
    if (cancellationToken.isCancellationRequested) {
      return await completeCancelled();
    }

    const makeArgs = [
      'run',
      `RUN_DIR=${runDirectory}`,
      `WAVES=${request.waves === true ? '1' : '0'}`,
    ];
    runOutput.appendLine(`make ${makeArgs.join(' ')}`);
    this.logger.info('Starting system verification', { runDirectory, verificationDirectory });
    let nextProcessStage = 0;
    const onOutputLine = (line: string): void => {
      const expectedStage = processLifecycleStages[nextProcessStage];
      if (line.includes(`${lifecycleMarkerPrefix}${expectedStage}`)) {
        emit(expectedStage);
        nextProcessStage += 1;
      }
    };

    let buildResult: BuildResult;
    try {
      emit('recreate');
      buildResult = await this.dependencies.runProcess('make', makeArgs, {
        cwd: verificationDirectory,
        outputChannel: runOutput,
        cancellationToken,
        env: { ...vivadoLaunch.env, VIVADO: vivadoLaunch.vivadoCommand },
        docker: vivadoLaunch.docker,
        extraMounts: vivadoLaunch.extraMounts,
        onOutputLine,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runOutput.appendLine(`[ERROR] ${message}`);
      buildResult = { success: false, exitCode: -1 };
    }

    const result = await this.createResult(
      runDirectory,
      logsPath,
      request.waves === true,
      buildResult
    );
    emit('complete', result.waveformPath, result.route);
    await runOutput.flush();
    this.logger.info('System verification completed', {
      outcome: result.outcome,
      runDirectory,
    });
    return result;
  }

  private async preflight(
    request: SystemVerificationRunRequest,
    cancellationToken: vscode.CancellationToken,
    outputChannel: Pick<vscode.OutputChannel, 'appendLine'>
  ): Promise<SystemVerificationVivadoLaunch> {
    const vivadoLaunch = this.dependencies.verifyVivado(request);
    if (!vivadoLaunch) {
      throw new Error('The configured Vivado toolchain is not available.');
    }
    if (vivadoLaunch.docker) {
      const dockerPreflight = await this.dependencies.verifyDockerEnvironment(
        vivadoLaunch,
        cancellationToken,
        outputChannel
      );
      if (dockerPreflight.diagnostic) {
        throw new SystemVerificationPreflightDiagnosticError(dockerPreflight.diagnostic);
      }
      if (dockerPreflight.cancelled || cancellationToken.isCancellationRequested) {
        throw new SystemVerificationPreflightCancelledError();
      }
      if (!dockerPreflight.available) {
        throw new Error(
          'The configured Docker image is unavailable or does not provide GNU Make and Vivado.'
        );
      }
    } else if (!this.dependencies.verifyGnuMake()) {
      throw new Error('GNU Make was not found or `make --version` did not identify GNU Make.');
    }
    return vivadoLaunch;
  }

  private async createResult(
    runDirectory: string,
    logsPath: string,
    waves: boolean,
    buildResult: BuildResult
  ): Promise<SystemVerificationResult> {
    const waveformPath = waves ? await findWaveform(runDirectory) : undefined;
    if (buildResult.cancelled === true) {
      const route = await readExistingResultRoute(runDirectory);
      await writeResultAtomically(runDirectory, { outcome: 'cancelled', route });
      return { outcome: 'cancelled', runDirectory, logsPath, waveformPath, route };
    }

    const parsed = await parseResultFile(path.join(runDirectory, resultFileName));
    if (!buildResult.success || buildResult.exitCode !== 0) {
      const route = parsed.result?.route;
      return {
        outcome: 'failed',
        runDirectory,
        logsPath,
        waveformPath,
        firstFailure:
          buildResult.diagnostic ??
          (parsed.result?.outcome === 'failed' && parsed.result.firstFailure
            ? parsed.result.firstFailure
            : `make run failed with exit code ${buildResult.exitCode}.`),
        ...(route ? { route } : {}),
      };
    }

    if (!parsed.result) {
      return {
        outcome: 'failed',
        runDirectory,
        logsPath,
        waveformPath,
        firstFailure: parsed.diagnostic,
      };
    }

    return {
      outcome: parsed.result.outcome,
      runDirectory,
      logsPath,
      waveformPath,
      firstFailure: parsed.result.firstFailure,
      route: parsed.result.route,
    };
  }
}

export async function runSystemVerification(
  request: SystemVerificationRunRequest,
  onEvent: (event: SystemVerificationRunEvent) => void,
  cancellationToken: vscode.CancellationToken
): Promise<SystemVerificationResult> {
  return await new SystemVerificationRunner().run(request, onEvent, cancellationToken);
}

function defaults(): SystemVerificationRunnerDependencies {
  return {
    runProcess,
    verifyGnuMake: () => {
      const result = spawnSync('make', ['--version'], { encoding: 'utf8', stdio: 'pipe' });
      return result.status === 0 && /^GNU Make\b/m.test(result.stdout ?? '');
    },
    verifyDockerEnvironment: verifyDockerExecutionEnvironment,
    verifyVivado: resolveConfiguredVivadoCommand,
    outputChannel: getSystemVerificationOutputChannel(),
    now: () => Date.now(),
  };
}

/** Probe the same image, mounts, and environment that will execute `make run`. */
export function verifyDockerExecutionEnvironment(
  launch: SystemVerificationVivadoLaunch,
  cancellationToken: vscode.CancellationToken,
  outputChannel: Pick<vscode.OutputChannel, 'appendLine'>,
  probe: SystemVerificationProcessProbe = runProcess
): Promise<SystemVerificationDockerPreflightResult> {
  const docker = launch.docker;
  if (!docker) {
    return Promise.resolve({ available: false });
  }
  return (async () => {
    const makeOutput: string[] = [];
    const options = {
      cwd: docker.mountBase,
      outputChannel,
      cancellationToken,
      env: launch.env ?? {},
      docker: { ...docker, pull: 'never' as const },
      extraMounts: launch.extraMounts,
      onOutputLine: (line: string): void => {
        makeOutput.push(line);
      },
    };
    const make = await probe('make', ['--version'], options);
    if (make.diagnostic) {
      return { available: false, diagnostic: make.diagnostic };
    }
    if (make.cancelled || cancellationToken.isCancellationRequested) {
      return { available: false, cancelled: true };
    }
    if (
      !make.success ||
      make.exitCode !== 0 ||
      !makeOutput.some((line) => /^GNU Make\b/.test(line))
    ) {
      return { available: false };
    }
    const vivado = await probe(launch.vivadoCommand, ['-version'], {
      ...options,
      onOutputLine: () => undefined,
    });
    if (vivado.diagnostic) {
      return { available: false, diagnostic: vivado.diagnostic };
    }
    if (vivado.cancelled || cancellationToken.isCancellationRequested) {
      return { available: false, cancelled: true };
    }
    return { available: vivado.success && vivado.exitCode === 0 };
  })().catch(() => ({ available: false }));
}

class SystemVerificationPreflightCancelledError extends Error {}

class SystemVerificationPreflightDiagnosticError extends Error {}

async function allocateRunDirectory(workspaceRoot: string): Promise<string> {
  const parent = path.join(path.resolve(workspaceRoot), '.ipcraft', 'system-verification');
  await fs.mkdir(parent, { recursive: true });
  return await fs.mkdtemp(path.join(parent, `${Date.now()}-`));
}

function createRunOutput(
  channel: Pick<vscode.OutputChannel, 'appendLine'>,
  logsPath: string
): Pick<vscode.OutputChannel, 'appendLine'> & { flush: () => Promise<void> } {
  let pendingWrite = Promise.resolve();
  let writeFailure: unknown;
  return {
    appendLine(value: string): void {
      channel.appendLine(value);
      pendingWrite = pendingWrite
        .then(async () => {
          await fs.appendFile(logsPath, `${value}\n`, 'utf8');
        })
        .catch((error: unknown) => {
          writeFailure ??= error;
        });
    },
    async flush(): Promise<void> {
      await pendingWrite;
      if (writeFailure) {
        throw writeFailure;
      }
    },
  };
}

function resolveConfiguredVivadoCommand(
  request: SystemVerificationRunRequest
): SystemVerificationVivadoLaunch | undefined {
  const vivado = getToolchain('vivado');
  if (!vivado?.isAvailable(request.workspaceConfiguration)) {
    return undefined;
  }

  const docker = vivado.getDocker(request.workspaceConfiguration, request.workspaceRoot);
  if (docker) {
    const launchEnv = vivado.getLaunchEnv(request.workspaceConfiguration);
    return {
      vivadoCommand: 'vivado',
      docker,
      env: launchEnv.env,
      extraMounts: launchEnv.extraMounts,
    };
  }

  const launcher = vivado.resolve('vivado', request.workspaceConfiguration);
  if (!launcher) {
    return undefined;
  }
  const launchEnv = vivado.getLaunchEnv(request.workspaceConfiguration);
  return {
    vivadoCommand: shellCommand([launcher.exe, ...launcher.prefixArgs]),
    env: launchEnv.env,
    extraMounts: launchEnv.extraMounts,
  };
}

function shellCommand(parts: string[]): string {
  return parts.map(shellQuote).join(' ');
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) {
    return value;
  }
  if (process.platform === 'win32') {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function parseResultFile(
  resultPath: string
): Promise<{ result?: ParsedRunResult; diagnostic: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(resultPath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { diagnostic: `${resultPath}: invalid or missing result JSON: ${message}` };
  }

  if (!resultValidator(parsed)) {
    const diagnostics = (resultValidator.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
      .join('; ');
    return {
      diagnostic: `${resultPath}: result schema validation failed: ${diagnostics}`,
    };
  }
  return { result: parsed, diagnostic: '' };
}

async function readExistingResultRoute(
  runDirectory: string
): Promise<SystemVerificationRouteSummary | undefined> {
  const parsed = await parseResultFile(path.join(runDirectory, resultFileName));
  return parsed.result?.route;
}

async function writeResultAtomically(
  runDirectory: string,
  result: { readonly outcome: 'cancelled'; readonly route?: SystemVerificationRouteSummary }
): Promise<void> {
  const resultPath = path.join(runDirectory, resultFileName);
  const temporaryPath = `${resultPath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(result)}\n`, 'utf8');
  await fs.rename(temporaryPath, resultPath);
}

async function findWaveform(directory: string): Promise<string | undefined> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findWaveform(entryPath);
      if (nested) {
        return nested;
      }
    } else if (entry.isFile() && waveformExtensions.has(path.extname(entry.name).toLowerCase())) {
      return entryPath;
    }
  }
  return undefined;
}
