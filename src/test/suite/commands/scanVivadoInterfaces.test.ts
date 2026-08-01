import * as vscode from 'vscode';
import { scanVivadoInterfacesCommand } from '../../../commands/scanVivadoInterfaces';
import { VivadoInterfaceScanner } from '../../../services/VivadoInterfaceScanner';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';
import * as errorHandler from '../../../utils/ErrorHandler';

jest.mock('../../../services/VivadoInterfaceScanner');
jest.mock('../../../services/toolchains/resolveToolchainVersion');
jest.mock('../../../utils/ErrorHandler');

const mockScan = jest.fn();
const mockResolveLocalVivado =
  resolveToolchainVersion.resolveLocalVivadoVersionForInterfaceScan as jest.Mock;
const mockHandleError = errorHandler.handleErrorWithUserNotification as jest.Mock;

describe('scanVivadoInterfacesCommand', () => {
  beforeEach(() => {
    (VivadoInterfaceScanner as jest.Mock).mockImplementation(() => ({ scan: mockScan }));
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: () => Promise<unknown>) => task()
    );
    mockScan.mockResolvedValue({
      count: 2,
      version: '2024.2',
      cacheDir: '/cache/vivado/2024.2/bus_definitions',
    });
  });

  it('passes the selected local Vivado version to the interface scan', async () => {
    const resource = { fsPath: '/workspace/core.ip.yml' } as vscode.Uri;
    const cfg = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;
    (vscode.window as { activeTextEditor?: { document: { uri: vscode.Uri } } }).activeTextEditor = {
      document: { uri: resource },
    };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg);
    mockResolveLocalVivado.mockResolvedValue({ runner: 'local', version: '2024.2' });

    await scanVivadoInterfacesCommand();

    expect(mockScan).toHaveBeenCalledWith({ runner: 'local', version: '2024.2' }, cfg, resource);
  });

  it('returns before progress or scan I/O when version selection is cancelled', async () => {
    mockResolveLocalVivado.mockResolvedValue(undefined);

    await scanVivadoInterfacesCommand();

    expect(vscode.window.withProgress).not.toHaveBeenCalled();
    expect(VivadoInterfaceScanner).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });

  it('preserves user notification for interface scan failures', async () => {
    const error = new Error('interfaces unavailable');
    mockResolveLocalVivado.mockResolvedValue(null);
    mockScan.mockRejectedValue(error);

    await scanVivadoInterfacesCommand();

    expect(mockHandleError).toHaveBeenCalledWith(
      error,
      'scanVivadoInterfaces',
      'Vivado interface scan failed: interfaces unavailable'
    );
  });
});
