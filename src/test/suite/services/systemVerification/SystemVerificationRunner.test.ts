import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { BuildResult } from '../../../../services/BuildRunner';
import type { SystemVerificationLifecycleEvent } from '../../../../domain/systemVerification.types';
import {
  SystemVerificationRunner,
  verifyDockerExecutionEnvironment,
  type SystemVerificationProcessProbe,
  type SystemVerificationRunnerDependencies,
  type SystemVerificationRunEvent,
  type SystemVerificationRunRequest,
} from '../../../../services/systemVerification/SystemVerificationRunner';

const cancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
} as unknown as vscode.CancellationToken;

const passedResultJson = JSON.stringify({
  outcome: 'passed',
  route: {
    driveInterfacePath: '/S_AXI_TEST',
    instancePath: '/control_0',
    baseAddress: 0x44a00000,
  },
});

describe('SystemVerificationRunner', () => {
  let tempDirectory: string;
  let workspaceRoot: string;
  let verificationDirectory: string;
  let request: SystemVerificationRunRequest;
  let runProcess: jest.Mock<Promise<BuildResult>, unknown[]>;
  let verifyGnuMake: jest.Mock;
  let verifyDockerEnvironment: jest.Mock;
  let verifyVivado: jest.Mock;
  let dependencies: SystemVerificationRunnerDependencies;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-runner-test-'));
    workspaceRoot = path.join(tempDirectory, 'workspace');
    verificationDirectory = path.join(workspaceRoot, 'hardware', 'system', 'verification');
    await fs.mkdir(verificationDirectory, { recursive: true });
    request = {
      configPath: path.join(verificationDirectory, 'system-verification.yml'),
      workspaceRoot,
      workspaceConfiguration: {} as vscode.WorkspaceConfiguration,
      waves: true,
    };
    runProcess = jest.fn();
    verifyGnuMake = jest.fn(() => true);
    verifyDockerEnvironment = jest.fn(async () => ({ available: true }));
    verifyVivado = jest.fn(() => ({ vivadoCommand: '/opt/Vivado/2025.1/bin/vivado' }));
    dependencies = {
      runProcess,
      verifyGnuMake,
      verifyDockerEnvironment,
      verifyVivado,
      outputChannel: { appendLine: jest.fn() },
      now: jest
        .fn()
        .mockReturnValueOnce(100)
        .mockReturnValueOnce(99)
        .mockReturnValueOnce(101)
        .mockReturnValueOnce(101)
        .mockReturnValueOnce(105)
        .mockReturnValueOnce(104)
        .mockReturnValue(110),
    };
  });

  afterEach(async () => {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  });

  it('preflights GNU Make before invoking make run', async () => {
    verifyGnuMake.mockReturnValue(false);
    const runner = new SystemVerificationRunner(dependencies);
    const onEvent = jest.fn();

    await expect(runner.run(request, onEvent, cancellationToken)).resolves.toMatchObject({
      outcome: 'failed',
      firstFailure: expect.stringContaining('GNU Make'),
    });

    expect(verifyVivado).toHaveBeenCalledWith(request);
    expect(runProcess).not.toHaveBeenCalled();
    expect(
      onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
    ).toEqual(['preflight', 'complete']);
    const runRoot = path.join(workspaceRoot, '.ipcraft', 'system-verification');
    const allocatedRuns = await fs.readdir(runRoot);
    expect(allocatedRuns).toHaveLength(1);
    await expect(
      fs.readFile(path.join(runRoot, allocatedRuns[0], 'system-verification.log'), 'utf8')
    ).resolves.toContain('GNU Make');
  });

  it('preflights the configured Vivado toolchain before invoking make run', async () => {
    verifyVivado.mockReturnValue(undefined);
    const runner = new SystemVerificationRunner(dependencies);
    const onEvent = jest.fn();

    await expect(runner.run(request, onEvent, cancellationToken)).resolves.toMatchObject({
      outcome: 'failed',
      firstFailure: expect.stringContaining('configured Vivado'),
    });

    expect(runProcess).not.toHaveBeenCalled();
    expect(
      onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
    ).toEqual(['preflight', 'complete']);
  });

  it('emits ordered monotonic events and preserves result paths on a failed simulation', async () => {
    runProcess.mockImplementation(async (_executable, args, options) => {
      const runDirectory = String((args as string[])[1]).slice('RUN_DIR='.length);
      emitLifecycleMarkers(options);
      await fs.mkdir(path.join(runDirectory, 'waves'), { recursive: true });
      await fs.writeFile(
        path.join(runDirectory, 'result.json'),
        JSON.stringify({
          outcome: 'failed',
          firstFailure: 'CONTROL response=SLVERR',
          route: {
            driveInterfacePath: '/S_AXI_TEST',
            instancePath: '/control_0',
            baseAddress: 0x44a00000,
          },
        })
      );
      await fs.writeFile(path.join(runDirectory, 'waves', 'system.wdb'), 'waves');
      return { success: false, exitCode: 1 };
    });
    const onEvent = jest.fn();
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, onEvent, cancellationToken);

    const events = onEvent.mock.calls.map(([event]) => event as SystemVerificationLifecycleEvent);
    expect(events.map((event) => event.stage)).toEqual([
      'preflight',
      'recreate',
      'discover',
      'plan',
      'compile',
      'run',
      'complete',
    ]);
    expect(events.map((event) => event.timestamp)).toEqual([100, 101, 102, 103, 105, 106, 110]);
    expect(events[0]).toMatchObject({
      runDirectory: expect.stringContaining(path.join('.ipcraft', 'system-verification')),
      logsPath: expect.stringMatching(/system-verification\.log$/),
    });
    expect(result).toMatchObject({
      outcome: 'failed',
      firstFailure: 'CONTROL response=SLVERR',
      runDirectory: expect.stringContaining(path.join('.ipcraft', 'system-verification')),
      logsPath: expect.stringMatching(/system-verification\.log$/),
      waveformPath: expect.stringMatching(/system\.wdb$/),
      route: {
        driveInterfacePath: '/S_AXI_TEST',
        instancePath: '/control_0',
        baseAddress: 0x44a00000,
      },
    });
    expect(events.at(-1)).toMatchObject({
      stage: 'complete',
      route: result.route,
    });
    await expect(fs.stat(result.runDirectory)).resolves.toBeDefined();
    await expect(fs.readFile(result.logsPath, 'utf8')).resolves.toContain('make run');
    expect(runProcess).toHaveBeenCalledWith(
      'make',
      ['run', `RUN_DIR=${result.runDirectory}`, 'WAVES=1'],
      expect.objectContaining({
        cwd: verificationDirectory,
        cancellationToken,
        env: { VIVADO: '/opt/Vivado/2025.1/bin/vivado' },
        onOutputLine: expect.any(Function),
        outputChannel: expect.objectContaining({ appendLine: expect.any(Function) }),
      })
    );
  });

  it('routes a configured Docker Vivado launch through BuildRunner', async () => {
    verifyVivado.mockReturnValue({
      vivadoCommand: 'vivado',
      docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
      env: { LM_LICENSE_FILE: '2100@licenses' },
      extraMounts: [{ host: '/licenses', container: '/licenses', ro: true }],
    });
    runProcess.mockImplementation(async (_executable, args, options) => {
      const runDirectory = String((args as string[])[1]).slice('RUN_DIR='.length);
      emitLifecycleMarkers(options);
      await fs.writeFile(path.join(runDirectory, 'result.json'), passedResultJson);
      return { success: true, exitCode: 0 };
    });
    const runner = new SystemVerificationRunner(dependencies);

    await runner.run(request, jest.fn(), cancellationToken);

    expect(verifyGnuMake).not.toHaveBeenCalled();
    expect(verifyDockerEnvironment).toHaveBeenCalledWith(
      expect.objectContaining({
        vivadoCommand: 'vivado',
        docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
      }),
      cancellationToken,
      expect.objectContaining({ appendLine: expect.any(Function) })
    );
    expect(runProcess).toHaveBeenCalledWith(
      'make',
      expect.arrayContaining([expect.stringMatching(/^RUN_DIR=\//), 'WAVES=1']),
      expect.objectContaining({
        docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
        env: { LM_LICENSE_FILE: '2100@licenses', VIVADO: 'vivado' },
        extraMounts: [{ host: '/licenses', container: '/licenses', ro: true }],
      })
    );
  });

  it('returns a typed failure when the Docker image does not provide GNU Make and Vivado', async () => {
    verifyVivado.mockReturnValue({
      vivadoCommand: 'vivado',
      docker: { image: 'missing-vivado:latest', mountBase: workspaceRoot },
    });
    verifyDockerEnvironment.mockResolvedValue({ available: false });
    const runner = new SystemVerificationRunner(dependencies);

    await expect(runner.run(request, jest.fn(), cancellationToken)).resolves.toMatchObject({
      outcome: 'failed',
      firstFailure: expect.stringMatching(/Docker image.*GNU Make.*Vivado/),
    });

    expect(verifyGnuMake).not.toHaveBeenCalled();
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('probes GNU Make and Vivado asynchronously inside the configured Docker image', async () => {
    const probe = jest
      .fn()
      .mockImplementationOnce(
        async (
          _executable: string,
          _args: string[],
          options: Parameters<SystemVerificationProcessProbe>[2]
        ) => {
          options.onOutputLine('GNU Make 4.4');
          return { success: true, exitCode: 0 };
        }
      )
      .mockResolvedValueOnce({ success: true, exitCode: 0 });
    const launch = {
      vivadoCommand: 'vivado',
      docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
      env: { LM_LICENSE_FILE: '2100@licenses' },
      extraMounts: [{ host: '/licenses', container: '/licenses', ro: true }],
    };

    await expect(
      verifyDockerExecutionEnvironment(launch, cancellationToken, { appendLine: jest.fn() }, probe)
    ).resolves.toEqual({ available: true });
    expect(probe).toHaveBeenNthCalledWith(
      1,
      'make',
      ['--version'],
      expect.objectContaining({
        cancellationToken,
        docker: {
          image: 'vivado:2025.1',
          mountBase: workspaceRoot,
          pull: 'never',
        },
        env: { LM_LICENSE_FILE: '2100@licenses' },
        extraMounts: [{ host: '/licenses', container: '/licenses', ro: true }],
      })
    );
    expect(probe).toHaveBeenNthCalledWith(
      2,
      'vivado',
      ['-version'],
      expect.objectContaining({ cancellationToken })
    );
  });

  it('finishes as cancelled when cancellation arrives during Docker preflight', async () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;
    verifyVivado.mockReturnValue({
      vivadoCommand: 'vivado',
      docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
    });
    verifyDockerEnvironment.mockImplementation(async () => {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      return { available: false, cancelled: true };
    });
    const onEvent = jest.fn();
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, onEvent, token);

    expect(result.outcome).toBe('cancelled');
    expect(
      onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
    ).toEqual(['preflight', 'complete']);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('reports Docker preflight termination failure even when the token is cancelled', async () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;
    verifyVivado.mockReturnValue({
      vivadoCommand: 'vivado',
      docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
    });
    verifyDockerEnvironment.mockImplementation(async () => {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      return {
        available: false,
        diagnostic: 'Failed to terminate process tree: Docker container is still running.',
      };
    });
    const onEvent = jest.fn();
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, onEvent, token);

    expect(result).toMatchObject({
      outcome: 'failed',
      firstFailure: 'Failed to terminate process tree: Docker container is still running.',
    });
    expect(
      onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
    ).toEqual(['preflight', 'complete']);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('does not start the Vivado probe after the Make probe is cancelled', async () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;
    const probe = jest.fn<
      ReturnType<SystemVerificationProcessProbe>,
      Parameters<SystemVerificationProcessProbe>
    >(async () => {
      (token as { isCancellationRequested: boolean }).isCancellationRequested = true;
      return { success: false, exitCode: -1, cancelled: true };
    });

    await expect(
      verifyDockerExecutionEnvironment(
        {
          vivadoCommand: 'vivado',
          docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
        },
        token,
        { appendLine: jest.fn() },
        probe
      )
    ).resolves.toEqual({ available: false, cancelled: true });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('make', ['--version'], expect.any(Object));
  });

  it('preserves a Make-probe termination diagnostic when cancellation is requested', async () => {
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;
    const probe = jest.fn<
      ReturnType<SystemVerificationProcessProbe>,
      Parameters<SystemVerificationProcessProbe>
    >(async () => ({
      success: false,
      exitCode: -1,
      diagnostic: 'Failed to terminate process tree: taskkill exited 1.',
    }));

    await expect(
      verifyDockerExecutionEnvironment(
        {
          vivadoCommand: 'vivado',
          docker: { image: 'vivado:2025.1', mountBase: workspaceRoot },
        },
        token,
        { appendLine: jest.fn() },
        probe
      )
    ).resolves.toEqual({
      available: false,
      diagnostic: 'Failed to terminate process tree: taskkill exited 1.',
    });
  });

  it('does not advance lifecycle stages from ordinary terminal output', async () => {
    runProcess.mockImplementation(async (_executable, args, options) => {
      const runDirectory = String((args as string[])[1]).slice('RUN_DIR='.length);
      const callbacks = options as { onOutputLine: (line: string) => void };
      callbacks.onOutputLine('compile run discover plan');
      expect(
        onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
      ).toEqual(['preflight', 'recreate']);
      emitLifecycleMarkers(options);
      await fs.writeFile(path.join(runDirectory, 'result.json'), passedResultJson);
      return { success: true, exitCode: 0 };
    });
    const onEvent = jest.fn();
    const runner = new SystemVerificationRunner(dependencies);

    await runner.run(request, onEvent, cancellationToken);

    expect(
      onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
    ).toEqual(['preflight', 'recreate', 'discover', 'plan', 'compile', 'run', 'complete']);
  });

  it('allocates a different collision-resistant run directory for concurrent runs', async () => {
    runProcess.mockImplementation(async (_executable, args, options) => {
      const runDirectory = String((args as string[])[1]).slice('RUN_DIR='.length);
      emitLifecycleMarkers(options);
      await fs.writeFile(path.join(runDirectory, 'result.json'), passedResultJson);
      return { success: true, exitCode: 0 };
    });
    const runner = new SystemVerificationRunner({ ...dependencies, now: () => 200 });

    const [first, second] = await Promise.all([
      runner.run(request, jest.fn(), cancellationToken),
      runner.run(request, jest.fn(), cancellationToken),
    ]);

    expect(first.runDirectory).not.toBe(second.runDirectory);
    expect(first.outcome).toBe('passed');
    expect(second.outcome).toBe('passed');
  });

  it('treats a nonzero make exit as failure even when result.json claims success', async () => {
    runProcess.mockImplementation(async (_executable, args, options) => {
      const runDirectory = String((args as string[])[1]).slice('RUN_DIR='.length);
      emitLifecycleMarkers(options);
      await fs.writeFile(path.join(runDirectory, 'result.json'), passedResultJson);
      return { success: false, exitCode: 7 };
    });
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, jest.fn(), cancellationToken);

    expect(result.outcome).toBe('failed');
    expect(result.firstFailure).toMatch(/exit code 7/);
  });

  it('returns a failed result with a diagnostic when successful make output is malformed', async () => {
    runProcess.mockImplementation(async (_executable, args, options) => {
      const runDirectory = String((args as string[])[1]).slice('RUN_DIR='.length);
      emitLifecycleMarkers(options);
      await fs.writeFile(
        path.join(runDirectory, 'result.json'),
        JSON.stringify({ ...JSON.parse(passedResultJson), extra: 1 })
      );
      return { success: true, exitCode: 0 };
    });
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, jest.fn(), cancellationToken);

    expect(result).toMatchObject({ outcome: 'failed' });
    expect(result.firstFailure).toMatch(/schema validation/);
  });

  it('returns cancelled and preserves the run directory when make is cancelled', async () => {
    runProcess.mockResolvedValue({ success: false, exitCode: -1, cancelled: true });
    const onEvent = jest.fn();
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, onEvent, cancellationToken);

    expect(result.outcome).toBe('cancelled');
    await expect(fs.stat(result.runDirectory)).resolves.toBeDefined();
    await expect(fs.stat(result.logsPath)).resolves.toBeDefined();
    await expect(
      fs.readFile(path.join(result.runDirectory, 'result.json'), 'utf8').then(JSON.parse)
    ).resolves.toEqual({ outcome: 'cancelled' });
    expect(onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'complete' }));
  });

  it('emits only preflight and complete when already cancelled before preflight', async () => {
    const preCancelledToken = {
      isCancellationRequested: true,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.CancellationToken;
    const onEvent = jest.fn();
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, onEvent, preCancelledToken);

    expect(result.outcome).toBe('cancelled');
    expect(
      onEvent.mock.calls.map(([event]) => (event as SystemVerificationRunEvent).stage)
    ).toEqual(['preflight', 'complete']);
    expect(verifyGnuMake).not.toHaveBeenCalled();
    expect(verifyVivado).not.toHaveBeenCalled();
    expect(verifyDockerEnvironment).not.toHaveBeenCalled();
    expect(runProcess).not.toHaveBeenCalled();
    await expect(fs.stat(result.runDirectory)).resolves.toBeDefined();
    await expect(fs.stat(result.logsPath)).resolves.toBeDefined();
    await expect(
      fs.readFile(path.join(result.runDirectory, 'result.json'), 'utf8').then(JSON.parse)
    ).resolves.toEqual({ outcome: 'cancelled' });
  });

  it('preserves a typed process-termination diagnostic as the first failure', async () => {
    runProcess.mockResolvedValue({
      success: false,
      exitCode: -1,
      diagnostic: 'Failed to terminate process tree: taskkill exited 1.',
    });
    const runner = new SystemVerificationRunner(dependencies);

    const result = await runner.run(request, jest.fn(), cancellationToken);

    expect(result).toMatchObject({
      outcome: 'failed',
      firstFailure: 'Failed to terminate process tree: taskkill exited 1.',
    });
  });
});

function emitLifecycleMarkers(options: unknown): void {
  const callbacks = options as { onOutputLine: (line: string) => void };
  for (const stage of ['discover', 'plan', 'compile', 'run']) {
    callbacks.onOutputLine(`IPCRAFT_LIFECYCLE:${stage}`);
  }
}
