import { existsSync } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type {
  DiscoveredSystem,
  SystemVerificationConfig,
  SystemVerificationPlan,
  SystemVerificationResult,
} from '../../../domain/systemVerification.types';
import {
  generateSystemTestbench,
  runSystemTestbench,
  type GenerateSystemTestbenchDependencies,
  type RunSystemTestbenchDependencies,
} from '../../../commands/SystemVerificationCommands';
import type { SystemVerificationRunEvent } from '../../../services/systemVerification/SystemVerificationRunner';

const discovered: DiscoveredSystem = {
  designName: 'system',
  wrapperLanguage: 'VHDL',
  boundaryInterfaces: [
    {
      path: '/S_AXI_TEST',
      mode: 'Slave',
      protocol: 'AXI4LITE',
      addressWidth: 32,
      dataWidth: 32,
      signals: [],
    },
    {
      path: '/M_AXI_FULL',
      mode: 'Slave',
      protocol: 'AXI4',
      addressWidth: 32,
      dataWidth: 32,
      signals: [],
    },
  ],
  boundaryPorts: [
    { path: '/sys_clk', type: 'clock', direction: 'in', width: 1 },
    { path: '/sys_rst_n', type: 'reset', direction: 'in', width: 1 },
    { path: '/status', type: 'data', direction: 'in', width: 1 },
  ],
  wrapperPorts: [],
  instancePaths: ['/control_0', '/unrelated_0'],
  axiRoutes: [
    {
      driveInterfacePath: '/S_AXI_TEST',
      instancePath: '/control_0',
      protocol: 'AXI4-Lite',
      baseAddress: 0x44a00000,
      addressRange: 0x20,
      busBytes: 4,
      addressWidth: 32,
      addressSegmentPath: '/control_0/S_AXI/reg0',
      mappedSegmentPath: '/S_AXI_TEST/SEG_control_0_reg0',
    },
    {
      driveInterfacePath: '/M_AXI_FULL',
      instancePath: '/unrelated_0',
      protocol: 'AXI4',
      baseAddress: 0x44b00000,
      addressRange: 0x1000,
      busBytes: 4,
      addressWidth: 32,
      addressSegmentPath: '/unrelated_0/S_AXI/reg0',
      mappedSegmentPath: '/M_AXI_FULL/SEG_unrelated_0_reg0',
    },
  ],
};

const plan: SystemVerificationPlan = {
  route: discovered.axiRoutes[0],
  boundaryInterface: discovered.boundaryInterfaces[0],
  clockPort: discovered.boundaryPorts[0],
  resetPort: discovered.boundaryPorts[1],
  wrapperPorts: discovered.wrapperPorts,
  wrapperLanguage: 'VHDL',
  transactions: [],
};

function uri(fsPath: string): vscode.Uri {
  return { scheme: 'file', fsPath } as vscode.Uri;
}

interface TestedInputBoxOptions {
  readonly title: string;
  readonly validateInput: (value: string) => string | undefined;
}

describe('generateSystemTestbench', () => {
  const discoverSystem = jest.fn();
  const buildPlan = jest.fn();
  const scaffoldSystem = jest.fn();
  const stageSystem = jest.fn();
  const dependencies: GenerateSystemTestbenchDependencies = {
    discoverSystem,
    buildPlan,
    scaffoldSystem,
    stageSystem,
  };

  beforeEach(() => {
    (vscode.workspace as { workspaceFolders?: Array<{ uri: vscode.Uri }> }).workspaceFolders = [
      { uri: uri('/work') },
    ];
    (vscode.window.showOpenDialog as jest.Mock).mockResolvedValue([
      uri('/work/hardware/system/recreate_anything.tcl'),
    ]);
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([
      uri('/work/hardware/ip/control.mm.yml'),
    ]);
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
      Buffer.from(`
name: control
addressBlocks:
  - name: registers
    baseAddress: 0
    range: 32
    usage: register
    registers: []
`)
    );
    discoverSystem.mockResolvedValue(discovered);
    buildPlan.mockReturnValue(plan);
    scaffoldSystem.mockReturnValue({ Makefile: 'run:\n' });
    stageSystem.mockResolvedValue({ accepted: true, writtenPaths: ['Makefile'] });
  });

  it('opens a Tcl picker, selects only discovered AXI4-Lite entries, then stages the scaffold', async () => {
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce('system')
      .mockResolvedValueOnce('/S_AXI_TEST')
      .mockResolvedValueOnce('/control_0')
      .mockResolvedValueOnce({
        label: 'control.mm.yml',
        description: 'hardware/ip/control.mm.yml',
        uri: uri('/work/hardware/ip/control.mm.yml'),
      })
      .mockResolvedValueOnce('/sys_clk')
      .mockResolvedValueOnce('/sys_rst_n');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('xc7z020clg484-1')
      .mockResolvedValueOnce('10')
      .mockResolvedValueOnce('active-low')
      .mockResolvedValueOnce('5');

    await generateSystemTestbench(dependencies);

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ filters: { Tcl: ['tcl'] } })
    );
    expect(discoverSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        recreateScript: 'hardware/system/recreate_anything.tcl',
        expectedDesignName: undefined,
        workspaceRoot: '/work',
      })
    );
    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(6);
    expect((vscode.window.showQuickPick as jest.Mock).mock.calls[1][0]).toEqual(['/S_AXI_TEST']);
    expect((vscode.window.showQuickPick as jest.Mock).mock.calls[2][0]).toEqual(['/control_0']);
    const inputOptions = (
      (vscode.window.showInputBox as jest.Mock).mock.calls as Array<[TestedInputBoxOptions]>
    ).map(([options]) => options);
    expect(inputOptions).toHaveLength(4);
    expect(inputOptions[0]).toEqual(
      expect.objectContaining({ title: 'Vivado Part', validateInput: expect.any(Function) })
    );
    expect(inputOptions[0].validateInput('')).toMatch(/cannot be empty/);
    expect(inputOptions[0].validateInput('xc7z020clg484-1')).toBeUndefined();
    expect(inputOptions[1].validateInput('0')).toMatch(/greater than zero/);
    expect(inputOptions[2].validateInput('low')).toMatch(/active-low or active-high/);
    expect(inputOptions[3].validateInput('1.5')).toMatch(/positive integer/);

    const expectedConfig: SystemVerificationConfig = {
      recreateScript: 'hardware/system/recreate_anything.tcl',
      part: 'xc7z020clg484-1',
      designName: 'system',
      clockPath: '/sys_clk',
      clockPeriodNs: 10,
      resetPath: '/sys_rst_n',
      resetActiveLow: true,
      resetCycles: 5,
      target: {
        driveInterfacePath: '/S_AXI_TEST',
        instancePath: '/control_0',
        memoryMap: '../../ip/control.mm.yml',
      },
    };
    expect(buildPlan).toHaveBeenCalledWith(expectedConfig, discovered, expect.any(Object));
    expect(stageSystem).toHaveBeenCalledWith(
      { Makefile: 'run:\n' },
      path.join('/work/hardware/system', 'verification')
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
  });

  it('stops without staging and removes discovery scratch when a selection is cancelled', async () => {
    let scratchDir = '';
    discoverSystem.mockImplementation(
      async (request: { scratchDir: string }): Promise<DiscoveredSystem> => {
        scratchDir = request.scratchDir;
        expect(existsSync(scratchDir)).toBe(true);
        return discovered;
      }
    );
    (vscode.window.showQuickPick as jest.Mock).mockResolvedValueOnce(undefined);

    await generateSystemTestbench(dependencies);

    expect(stageSystem).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(scratchDir).not.toBe('');
    expect(existsSync(scratchDir)).toBe(false);
  });

  it('stops without typed clock or reset fallbacks when discovery has no boundary ports', async () => {
    discoverSystem.mockResolvedValue({ ...discovered, boundaryPorts: [] });
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce('system')
      .mockResolvedValueOnce('/S_AXI_TEST')
      .mockResolvedValueOnce('/control_0')
      .mockResolvedValueOnce({
        label: 'control.mm.yml',
        description: 'hardware/ip/control.mm.yml',
        uri: uri('/work/hardware/ip/control.mm.yml'),
      });

    await generateSystemTestbench(dependencies);

    expect(vscode.window.showQuickPick).toHaveBeenCalledTimes(4);
    expect(vscode.window.showInputBox).not.toHaveBeenCalled();
    expect(stageSystem).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('boundary ports')
    );
  });

  it('excludes ambiguous interface and instance route pairs before selection', async () => {
    discoverSystem.mockResolvedValue({
      ...discovered,
      instancePaths: ['/control_0', '/neighbor_0'],
      axiRoutes: [
        discovered.axiRoutes[0],
        { ...discovered.axiRoutes[0], baseAddress: 0x44b00000 },
        {
          ...discovered.axiRoutes[0],
          instancePath: '/neighbor_0',
          baseAddress: 0x44c00000,
        },
      ],
    });
    (vscode.window.showQuickPick as jest.Mock)
      .mockResolvedValueOnce('system')
      .mockResolvedValueOnce('/S_AXI_TEST')
      .mockResolvedValueOnce('/neighbor_0')
      .mockResolvedValueOnce({
        label: 'control.mm.yml',
        description: 'hardware/ip/control.mm.yml',
        uri: uri('/work/hardware/ip/control.mm.yml'),
      })
      .mockResolvedValueOnce('/sys_clk')
      .mockResolvedValueOnce('/sys_rst_n');
    (vscode.window.showInputBox as jest.Mock)
      .mockResolvedValueOnce('xc7z020clg484-1')
      .mockResolvedValueOnce('10')
      .mockResolvedValueOnce('active-low')
      .mockResolvedValueOnce('5');

    await generateSystemTestbench(dependencies);

    expect((vscode.window.showQuickPick as jest.Mock).mock.calls[2][0]).toEqual(['/neighbor_0']);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringMatching(/control_0.*more than one AXI4-Lite route/)
    );
    expect(buildPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.objectContaining({ instancePath: '/neighbor_0' }),
      }),
      expect.any(Object),
      expect.any(Object)
    );
  });
});

describe('runSystemTestbench', () => {
  const configPath = '/work/hardware/system/verification/system-verification.yml';
  const cancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
  } as unknown as vscode.CancellationToken;
  const initialEvent: SystemVerificationRunEvent = {
    stage: 'preflight',
    timestamp: 1_000,
    runDirectory: '/work/.ipcraft/system-verification/run-a',
    logsPath: '/work/.ipcraft/system-verification/run-a/system-verification.log',
  };
  const result: SystemVerificationResult = {
    outcome: 'passed',
    runDirectory: initialEvent.runDirectory,
    logsPath: initialEvent.logsPath,
  };
  const runner = { run: jest.fn() };
  const runPanel = {
    show: jest.fn(() => ({ update: jest.fn(), complete: jest.fn() })),
  };
  const readConfig = jest.fn();
  const resolveRealPath = jest.fn();
  const dependencies: RunSystemTestbenchDependencies = {
    runner,
    runPanel,
    readConfig,
    resolveRealPath,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace as { workspaceFolders?: Array<{ uri: vscode.Uri }> }).workspaceFolders = [
      { uri: uri('/work') },
    ];
    (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => uri(fsPath));
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: jest.fn() });
    resolveRealPath.mockImplementation(async (filePath: string) => filePath);
    readConfig.mockResolvedValue({
      recreateScript: 'hardware/system/recreate.tcl',
      part: 'xc7z020clg484-1',
      designName: 'system',
      clockPath: '/sys_clk',
      clockPeriodNs: 10,
      resetPath: '/sys_rst_n',
      resetActiveLow: true,
      resetCycles: 5,
      target: {
        driveInterfacePath: '/S_AXI_TEST',
        instancePath: '/control_0',
        memoryMap: '../ip/control.mm.yml',
      },
    });
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      async (
        _options: unknown,
        task: (
          progress: vscode.Progress<{ message?: string; increment?: number }>,
          token: vscode.CancellationToken
        ) => PromiseLike<unknown>
      ): Promise<unknown> => await task({ report: jest.fn() }, cancellationToken)
    );
    runner.run.mockImplementation(
      async (_request: unknown, onEvent: (event: SystemVerificationRunEvent) => void) => {
        onEvent(initialEvent);
        return result;
      }
    );
  });

  it('uses the selected tracked configuration and starts the run panel', async () => {
    await runSystemTestbench(dependencies, vscode.Uri.file(configPath));

    expect(runner.run).toHaveBeenCalledWith(
      expect.objectContaining({ configPath, workspaceRoot: '/work' }),
      expect.any(Function),
      cancellationToken
    );
    expect(runPanel.show).toHaveBeenCalledWith({}, initialEvent);
    expect(readConfig).toHaveBeenCalledWith(configPath);
  });

  it('completes the panel and reports an ordinary typed preflight failure', async () => {
    const failedResult: SystemVerificationResult = {
      outcome: 'failed',
      runDirectory: initialEvent.runDirectory,
      logsPath: initialEvent.logsPath,
      firstFailure: 'GNU Make was not found',
    };
    const panel = { update: jest.fn(), complete: jest.fn() };
    runPanel.show.mockReturnValue(panel);
    runner.run.mockImplementation(
      async (_request: unknown, onEvent: (event: SystemVerificationRunEvent) => void) => {
        onEvent(initialEvent);
        return failedResult;
      }
    );

    await runSystemTestbench(dependencies, vscode.Uri.file(configPath));

    expect(panel.complete).toHaveBeenCalledWith(failedResult, {
      ...initialEvent,
      stage: 'complete',
    });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('GNU Make')
    );
  });

  it('rejects a non-file resource before loading configuration or starting the runner', async () => {
    await runSystemTestbench(dependencies, {
      scheme: 'untitled',
      fsPath: configPath,
    } as vscode.Uri);

    expect(readConfig).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('tracked system-verification.yml')
    );
  });

  it('rejects a system-verification symlink that resolves outside the workspace', async () => {
    resolveRealPath.mockImplementation(async (filePath: string) =>
      filePath === configPath ? '/outside/system-verification.yml' : filePath
    );

    await runSystemTestbench(dependencies, vscode.Uri.file(configPath));

    expect(readConfig).not.toHaveBeenCalled();
    expect(runner.run).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('inside an open workspace folder')
    );
  });

  it('reports typed completion through the panel', async () => {
    const panel = { update: jest.fn(), complete: jest.fn() };
    runPanel.show.mockReturnValue(panel);

    await runSystemTestbench(dependencies, vscode.Uri.file(configPath));

    expect(panel.complete).toHaveBeenCalledWith(result, {
      ...initialEvent,
      stage: 'complete',
    });
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('passed')
    );
  });
});
