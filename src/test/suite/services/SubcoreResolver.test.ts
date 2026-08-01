import * as vscode from 'vscode';
import { SubcoreResolver } from '../../../services/SubcoreResolver';
import { VivadoCatalogScanner } from '../../../services/VivadoCatalogScanner';

jest.mock('../../../services/VivadoCatalogScanner');

const mockLoadCachedCatalog = jest.fn();

describe('SubcoreResolver Vivado catalog cache', () => {
  beforeEach(() => {
    (VivadoCatalogScanner as jest.Mock).mockImplementation(() => ({
      loadCachedCatalog: mockLoadCachedCatalog,
    }));
    mockLoadCachedCatalog.mockResolvedValue([]);
    (vscode.workspace.findFiles as jest.Mock).mockResolvedValue([]);
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
  });

  it('loads the catalog matching the resource-pinned Vivado version', async () => {
    const resource = { fsPath: '/workspace/core.ip.yml' } as vscode.Uri;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue?: unknown) =>
        key === 'vivado.pinnedVersion' ? '2024.2' : defaultValue,
    });
    const resolver = new SubcoreResolver({} as vscode.ExtensionContext);

    await resolver.refresh(resource);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('ipcraft', resource);
    expect(mockLoadCachedCatalog).toHaveBeenCalledWith('2024.2');
  });

  it('loads only the legacy catalog when the resource has no pin', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
    const resolver = new SubcoreResolver({} as vscode.ExtensionContext);

    await resolver.refresh({ fsPath: '/workspace/core.ip.yml' } as vscode.Uri);

    expect(mockLoadCachedCatalog).toHaveBeenCalledWith(undefined);
  });

  it('uses global cache selection when refresh has no resource in a multi-root workspace', async () => {
    const firstFolder = { fsPath: '/workspace/first' } as vscode.Uri;
    const secondFolder = { fsPath: '/workspace/second' } as vscode.Uri;
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: firstFolder },
      { uri: secondFolder },
    ];
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
    const resolver = new SubcoreResolver({} as vscode.ExtensionContext);

    await resolver.refresh();

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('ipcraft', undefined);
  });
});
