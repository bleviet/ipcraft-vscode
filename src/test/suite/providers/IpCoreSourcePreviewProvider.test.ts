import * as vscode from 'vscode';
import { IpCoreSourcePreviewProvider } from '../../../providers/IpCoreSourcePreviewProvider';
import { loadIpCoreData } from '../../../generator/loadIpCore';
import { loadRuntimeBusLibrary } from '../../../services/loadRuntimeBusLibrary';
import { checkBusConformance } from '../../../shared/busConformance';
import { writeImportedFile } from '../../../utils/importWrite';
import type { ResourceRoots } from '../../../services/ResourceRoots';

jest.mock('../../../generator/loadIpCore');
jest.mock('../../../services/loadRuntimeBusLibrary');
jest.mock('../../../shared/busConformance', () => {
  const actual = jest.requireActual<typeof import('../../../shared/busConformance')>(
    '../../../shared/busConformance'
  );
  return { ...actual, checkBusConformance: jest.fn() };
});
jest.mock('../../../utils/importWrite');

interface SaveHarness {
  handleSaveAsIpYml(
    sourceUri: vscode.Uri,
    currentYaml: string,
    componentName: string
  ): Promise<void>;
}

describe('IpCoreSourcePreviewProvider save boundary', () => {
  const sourceUri = { fsPath: '/workspace/example_hw.tcl' } as vscode.Uri;
  let provider: SaveHarness;

  beforeEach(() => {
    const context = {
      extensionUri: { fsPath: '/extension' },
    } as unknown as vscode.ExtensionContext;
    provider = new IpCoreSourcePreviewProvider(context, {
      templatesDir: '/extension/templates',
    } as ResourceRoots) as unknown as SaveHarness;
    (loadIpCoreData as jest.Mock).mockResolvedValue({ busInterfaces: [] });
    (loadRuntimeBusLibrary as jest.Mock).mockResolvedValue({ contracts: [] });
    (writeImportedFile as jest.Mock).mockResolvedValue('created');
  });

  it('writes neither IP nor companion memory map for a known-invalid preview', async () => {
    (checkBusConformance as jest.Mock).mockReturnValue({
      issues: [
        {
          code: 'BUS_INVALID',
          severity: 'error',
          source: 'protocol',
          path: ['busInterfaces', 0],
          message: 'Known invalid interface.',
        },
      ],
      hasKnownErrors: true,
      hasUnresolved: false,
    });

    await provider.handleSaveAsIpYml(sourceUri, 'busInterfaces: []\n', 'example');

    expect(writeImportedFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Known invalid interface.')
    );
  });

  it('saves an unresolved preview with a warning', async () => {
    (checkBusConformance as jest.Mock).mockReturnValue({
      issues: [
        {
          code: 'BUS_TYPE_UNRESOLVED',
          severity: 'warning',
          source: 'protocol',
          path: ['busInterfaces', 0, 'type'],
          message: 'Bus type could not be resolved.',
        },
      ],
      hasKnownErrors: false,
      hasUnresolved: true,
    });

    await provider.handleSaveAsIpYml(sourceUri, 'busInterfaces: []\n', 'example');

    expect(writeImportedFile).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Bus type could not be resolved.')
    );
  });
});
