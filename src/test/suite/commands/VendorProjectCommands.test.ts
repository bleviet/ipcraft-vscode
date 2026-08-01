import * as vscode from 'vscode';
import {
  runCreateVivadoProjectStep,
  runCreateQuartusProjectStep,
  generateVivadoProject,
  generateQuartusProject,
  generateAndBuildVivado,
  generateAndBuildQuartus,
} from '../../../commands/VendorProjectCommands';
import * as projectCreator from '../../../commands/projectCreator';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';
import * as buildOutputChannel from '../../../services/BuildOutputChannel';
import * as generationEngine from '../../../services/GenerationEngine';
import * as pickBoard from '../../../utils/pickBoard';
import { CONFIG_KEY_IPCRAFT } from '../../../utils/configKeys';

jest.mock('../../../commands/projectCreator');
jest.mock('../../../services/toolchains/resolveToolchainVersion');
jest.mock('../../../services/BuildOutputChannel');
jest.mock('../../../services/GenerationEngine');
jest.mock('../../../utils/pickBoard');

const mockCreateVivadoProject = projectCreator.createVivadoProject as jest.Mock;
const mockCreateQuartusProject = projectCreator.createQuartusProject as jest.Mock;
const mockResolveForCreate = resolveToolchainVersion.resolveToolchainVersionForCreate as jest.Mock;
const mockResolveForResource =
  resolveToolchainVersion.resolveToolchainVersionForResource as jest.Mock;

describe('VendorProjectCommands', () => {
  beforeEach(() => {
    (buildOutputChannel.getBuildOutputChannel as jest.Mock).mockReturnValue({
      appendLine: jest.fn(),
    });
    jest.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue(undefined);
    // `resetMocks: true` wipes the shared __mocks__/vscode.ts factory
    // implementation before every test, so withProgress must be given a
    // working implementation here rather than relying on the shared default.
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: (...args: unknown[]) => unknown) => task({}, {})
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('runCreateVivadoProjectStep', () => {
    it('does not create a project when the user cancels the version picker', async () => {
      mockResolveForCreate.mockResolvedValue(undefined);

      await runCreateVivadoProjectStep('my_ip', '/ip');

      expect(mockCreateVivadoProject).not.toHaveBeenCalled();
    });

    it('creates the project with the default version when nothing is configured (choice is null)', async () => {
      mockResolveForCreate.mockResolvedValue(null);
      mockCreateVivadoProject.mockResolvedValue(true);

      await runCreateVivadoProjectStep('my_ip', '/ip');

      expect(mockCreateVivadoProject).toHaveBeenCalledWith(
        'my_ip',
        '/ip',
        expect.anything(),
        undefined,
        undefined
      );
    });

    it('creates the project with the chosen version', async () => {
      mockResolveForCreate.mockResolvedValue({ runner: 'local', version: '2024.2' });
      mockCreateVivadoProject.mockResolvedValue(true);

      await runCreateVivadoProjectStep('my_ip', '/ip');

      expect(mockCreateVivadoProject).toHaveBeenCalledWith(
        'my_ip',
        '/ip',
        expect.anything(),
        '2024.2',
        undefined
      );
    });

    it('passes the resource-scoped config selected by the version resolver into creation', async () => {
      const scopedCfg = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;
      (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => ({ fsPath }));
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(scopedCfg);
      mockResolveForCreate.mockResolvedValue({ runner: 'local', version: '2024.2' });
      mockCreateVivadoProject.mockResolvedValue(true);

      await runCreateVivadoProjectStep('my_ip', '/workspace-a/ip');

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(
        CONFIG_KEY_IPCRAFT,
        expect.objectContaining({ fsPath: '/workspace-a/ip' })
      );
      expect(mockCreateVivadoProject).toHaveBeenCalledWith(
        'my_ip',
        '/workspace-a/ip',
        expect.anything(),
        '2024.2',
        scopedCfg
      );
    });
  });

  describe('runCreateQuartusProjectStep', () => {
    it('does not create a project when the user cancels the version picker', async () => {
      mockResolveForCreate.mockResolvedValue(undefined);

      await runCreateQuartusProjectStep('my_ip', '/ip');

      expect(mockCreateQuartusProject).not.toHaveBeenCalled();
    });

    it('creates the project with the default version when nothing is configured (choice is null)', async () => {
      mockResolveForCreate.mockResolvedValue(null);
      mockCreateQuartusProject.mockResolvedValue(true);

      await runCreateQuartusProjectStep('my_ip', '/ip');

      expect(mockCreateQuartusProject).toHaveBeenCalledWith(
        'my_ip',
        '/ip',
        expect.anything(),
        undefined,
        undefined
      );
    });
  });

  describe('Generate & Build', () => {
    const context = {} as vscode.ExtensionContext;
    const resourceRoots = {} as never;
    const ipCoreUri = vscode.Uri.file('/ip/foo.ip.yml');

    beforeEach(() => {
      (generationEngine.readScaffoldPackSetting as jest.Mock).mockReturnValue(undefined);
      (generationEngine.runGenerator as jest.Mock).mockResolvedValue(true);
      (pickBoard.pickVivadoPart as jest.Mock).mockResolvedValue('xc7z020clg484-1');
      (pickBoard.pickQuartusDevice as jest.Mock).mockResolvedValue('5CSEBA6U23I7');
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
      });
    });

    it('stops Vivado Generate & Build when the no-project version picker is cancelled', async () => {
      mockResolveForResource.mockResolvedValue(undefined);

      await generateAndBuildVivado(context, resourceRoots, ipCoreUri);

      expect(generationEngine.runGenerator).not.toHaveBeenCalled();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('forwards the one selected Vivado version to the build command', async () => {
      mockResolveForResource.mockResolvedValue({ runner: 'local', version: '2024.2' });

      await generateAndBuildVivado(context, resourceRoots, ipCoreUri);

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(CONFIG_KEY_IPCRAFT, ipCoreUri);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'fpga-ip-core.buildVivadoOoc',
        ipCoreUri,
        '2024.2'
      );
    });

    it('forwards an explicit Vivado legacy fallback without losing resolution state', async () => {
      mockResolveForResource.mockResolvedValue(null);

      await generateAndBuildVivado(context, resourceRoots, ipCoreUri);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'fpga-ip-core.buildVivadoOoc',
        ipCoreUri,
        null
      );
    });

    it('stops Quartus Generate & Build when the no-project version picker is cancelled', async () => {
      mockResolveForResource.mockResolvedValue(undefined);

      await generateAndBuildQuartus(context, resourceRoots, ipCoreUri);

      expect(generationEngine.runGenerator).not.toHaveBeenCalled();
      expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('forwards the one selected Quartus version to the build command', async () => {
      mockResolveForResource.mockResolvedValue({ runner: 'local', version: '23.1' });

      await generateAndBuildQuartus(context, resourceRoots, ipCoreUri);

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(CONFIG_KEY_IPCRAFT, ipCoreUri);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'fpga-ip-core.buildQuartusCompile',
        ipCoreUri,
        '23.1'
      );
    });

    it('forwards an explicit Quartus legacy fallback without losing resolution state', async () => {
      mockResolveForResource.mockResolvedValue(null);

      await generateAndBuildQuartus(context, resourceRoots, ipCoreUri);

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'fpga-ip-core.buildQuartusCompile',
        ipCoreUri,
        null
      );
    });
  });

  describe('Generate Project resource configuration', () => {
    const context = {} as vscode.ExtensionContext;
    const resourceRoots = {} as never;
    const ipCoreUri = vscode.Uri.file('/workspace-a/ip/foo.ip.yml');

    beforeEach(() => {
      (generationEngine.readScaffoldPackSetting as jest.Mock).mockReturnValue(undefined);
      (generationEngine.runGenerator as jest.Mock).mockResolvedValue(false);
      (pickBoard.pickVivadoPart as jest.Mock).mockResolvedValue('xc7z020clg484-1');
      (pickBoard.pickQuartusDevice as jest.Mock).mockResolvedValue('5CSEBA6U23I7');
      (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
        get: jest.fn((_key: string, defaultValue?: unknown) => defaultValue),
      });
    });

    it('uses the originating resource configuration for Generate Project Vivado', async () => {
      await generateVivadoProject(context, resourceRoots, ipCoreUri);

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(CONFIG_KEY_IPCRAFT, ipCoreUri);
    });

    it('uses the originating resource configuration for Generate Project Quartus', async () => {
      await generateQuartusProject(context, resourceRoots, ipCoreUri);

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith(CONFIG_KEY_IPCRAFT, ipCoreUri);
    });
  });
});
