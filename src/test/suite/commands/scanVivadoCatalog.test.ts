import * as vscode from 'vscode';
import { scanVivadoCatalogCommand } from '../../../commands/scanVivadoCatalog';
import { VivadoCatalogScanner } from '../../../services/VivadoCatalogScanner';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';

jest.mock('../../../services/VivadoCatalogScanner');
jest.mock('../../../services/toolchains/resolveToolchainVersion');

const mockScan = jest.fn();
const mockResolveForResource =
  resolveToolchainVersion.resolveToolchainVersionForResource as jest.Mock;

describe('scanVivadoCatalogCommand', () => {
  beforeEach(() => {
    (VivadoCatalogScanner as jest.Mock).mockImplementation(() => ({ scan: mockScan }));
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      (_options: unknown, task: () => Promise<unknown>) => task()
    );
    mockScan.mockResolvedValue({
      count: 3,
      catalogPath: '/cache/vivado/2024.2/catalog.json',
    });
  });

  it('resolves against the active resource and passes the selected Docker version to the scan', async () => {
    const resource = { fsPath: '/workspace/core.ip.yml' } as vscode.Uri;
    const cfg = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;
    (vscode.window as { activeTextEditor?: { document: { uri: vscode.Uri } } }).activeTextEditor = {
      document: { uri: resource },
    };
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg);
    mockResolveForResource.mockResolvedValue({ runner: 'docker', version: '2023.1' });

    await scanVivadoCatalogCommand();

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('ipcraft', resource);
    expect(mockResolveForResource).toHaveBeenCalledWith(cfg, 'vivado');
    expect(mockScan).toHaveBeenCalledWith({ runner: 'docker', version: '2023.1' }, cfg, resource);
  });

  it('returns before progress or scan I/O when version selection is cancelled', async () => {
    mockResolveForResource.mockResolvedValue(undefined);

    await scanVivadoCatalogCommand();

    expect(vscode.window.withProgress).not.toHaveBeenCalled();
    expect(VivadoCatalogScanner).not.toHaveBeenCalled();
    expect(mockScan).not.toHaveBeenCalled();
  });
});
