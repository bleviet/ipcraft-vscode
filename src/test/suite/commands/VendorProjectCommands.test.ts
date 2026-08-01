import * as vscode from 'vscode';
import {
  runCreateVivadoProjectStep,
  runCreateQuartusProjectStep,
} from '../../../commands/VendorProjectCommands';
import * as projectCreator from '../../../commands/projectCreator';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';
import * as buildOutputChannel from '../../../services/BuildOutputChannel';

jest.mock('../../../commands/projectCreator');
jest.mock('../../../services/toolchains/resolveToolchainVersion');
jest.mock('../../../services/BuildOutputChannel');

const mockCreateVivadoProject = projectCreator.createVivadoProject as jest.Mock;
const mockCreateQuartusProject = projectCreator.createQuartusProject as jest.Mock;
const mockResolveForCreate = resolveToolchainVersion.resolveToolchainVersionForCreate as jest.Mock;

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
        '2024.2'
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
        undefined
      );
    });
  });
});
