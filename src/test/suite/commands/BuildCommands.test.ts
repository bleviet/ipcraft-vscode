import * as vscode from 'vscode';
import { registerBuildCommands } from '../../../commands/BuildCommands';
import { listAll } from '../../../services/toolchains/registry';
import { resolveToolchainVersionForOpen } from '../../../services/toolchains/resolveToolchainVersion';
import { safeRegisterCommand } from '../../../utils/vscodeHelpers';
import { getBuildOutputChannel } from '../../../services/BuildOutputChannel';
import type { BuildMode } from '../../../services/toolchains/SynthesisToolchain';
import { CONFIG_KEY_IPCRAFT } from '../../../utils/configKeys';

jest.mock('../../../services/toolchains/registry');
jest.mock('../../../services/toolchains/resolveToolchainVersion');
jest.mock('../../../utils/vscodeHelpers');
jest.mock('../../../services/BuildOutputChannel');

const mockListAll = listAll as jest.Mock;
const mockResolveForOpen = resolveToolchainVersionForOpen as jest.Mock;
const mockSafeRegisterCommand = safeRegisterCommand as jest.Mock;
const mockGetBuildOutputChannel = getBuildOutputChannel as jest.Mock;

describe('BuildCommands version selection', () => {
  const ipCoreUri = vscode.Uri.file('/ip/foo.ip.yml');
  const run = jest.fn().mockResolvedValue({ vendor: 'vivado' });
  const mode = {
    label: 'Vivado OOC Synthesis',
    description: 'Vivado build',
    buildDir: '/ip/xilinx/build/ooc',
    vendor: 'vivado',
    projectFilePath: '/ip/xilinx/build/ooc/foo.xpr',
    run,
  } as unknown as BuildMode;

  beforeEach(() => {
    run.mockResolvedValue({ vendor: 'vivado' });
    mockListAll.mockReturnValue([{ detectBuildModes: jest.fn().mockResolvedValue([mode]) }]);
    mockResolveForOpen.mockResolvedValue({ runner: 'local', version: '2023.2' });
    mockGetBuildOutputChannel.mockReturnValue({ show: jest.fn(), appendLine: jest.fn() });
    (vscode.workspace.fs.readFile as jest.Mock).mockResolvedValue(
      new TextEncoder().encode('vlnv:\n  name: foo\n')
    );
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
    });
  });

  async function invoke(command: string, ...args: unknown[]): Promise<void> {
    const context = { subscriptions: [] } as unknown as vscode.ExtensionContext;
    const treeProvider = { update: jest.fn() };
    const statusBarItem = {};
    registerBuildCommands(
      context,
      treeProvider as never,
      statusBarItem as unknown as vscode.StatusBarItem
    );
    const registration = mockSafeRegisterCommand.mock.calls.find(([, id]) => id === command);
    expect(registration).toBeDefined();
    const handler = registration[2] as (...handlerArgs: unknown[]) => unknown;
    handler(...args);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('runs a direct Vivado build with the project-detected version', async () => {
    await invoke('fpga-ip-core.buildVivadoOoc', ipCoreUri);

    expect(mockResolveForOpen).toHaveBeenCalledWith(
      expect.anything(),
      'vivado',
      '/ip/xilinx/build/ooc/foo.xpr'
    );
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(CONFIG_KEY_IPCRAFT, ipCoreUri);
    expect(run).toHaveBeenCalledWith('2023.2');
  });

  it('does not launch a direct build when project version selection is cancelled', async () => {
    mockResolveForOpen.mockResolvedValue(undefined);

    await invoke('fpga-ip-core.buildVivadoOoc', ipCoreUri);

    expect(run).not.toHaveBeenCalled();
  });

  it('uses a supplied Generate & Build version without resolving again', async () => {
    await invoke('fpga-ip-core.buildVivadoOoc', ipCoreUri, '2024.2');

    expect(mockResolveForOpen).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith('2024.2');
  });

  it('uses an explicit legacy handoff without resolving again', async () => {
    await invoke('fpga-ip-core.buildVivadoOoc', ipCoreUri, null);

    expect(mockResolveForOpen).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(undefined);
  });

  it('runs a direct Quartus build with the project-detected version', async () => {
    const quartusRun = jest.fn().mockResolvedValue({ vendor: 'quartus' });
    const quartusMode = {
      label: 'Quartus Compile',
      description: 'Quartus build',
      buildDir: '/ip/altera/build',
      vendor: 'quartus',
      projectFilePath: '/ip/altera/build/foo.qpf',
      run: quartusRun,
    } as unknown as BuildMode;
    mockListAll.mockReturnValue([{ detectBuildModes: jest.fn().mockResolvedValue([quartusMode]) }]);
    mockResolveForOpen.mockResolvedValue({ runner: 'local', version: '23.1' });

    await invoke('fpga-ip-core.buildQuartusCompile', ipCoreUri);

    expect(mockResolveForOpen).toHaveBeenCalledWith(
      expect.anything(),
      'quartus',
      '/ip/altera/build/foo.qpf'
    );
    expect(quartusRun).toHaveBeenCalledWith('23.1');
  });
});
