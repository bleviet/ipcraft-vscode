import * as vscode from 'vscode';
import { parseHwTcl } from '../../../commands/ImportCommands';
import { parseHwTclFile } from '../../../parser/HwTclParser';
import { loadIpCoreData } from '../../../generator/loadIpCore';
import { loadRuntimeBusLibrary } from '../../../services/loadRuntimeBusLibrary';
import { checkBusConformance } from '../../../shared/busConformance';
import { writeImportedFile } from '../../../utils/importWrite';

jest.mock('../../../parser/HwTclParser');
jest.mock('../../../generator/loadIpCore');
jest.mock('../../../services/loadRuntimeBusLibrary');
jest.mock('../../../shared/busConformance', () => {
  const actual = jest.requireActual<typeof import('../../../shared/busConformance')>(
    '../../../shared/busConformance'
  );
  return { ...actual, checkBusConformance: jest.fn() };
});
jest.mock('../../../utils/importWrite');
jest.mock('../../../services/ResourceRoots', () => ({
  resolveResourceRoots: jest.fn().mockReturnValue({}),
}));

describe('import bus-conformance boundary', () => {
  const sourceUri = { fsPath: '/workspace/example_hw.tcl' } as vscode.Uri;
  const context = {
    extensionPath: '/extension',
    globalState: {
      get: jest.fn().mockReturnValue(true),
      update: jest.fn(),
    },
  } as unknown as vscode.ExtensionContext;

  beforeEach(() => {
    (context.globalState.get as jest.Mock).mockReturnValue(true);
    (vscode.window.withProgress as jest.Mock).mockImplementation(
      async (_options: unknown, task: () => Promise<void>) => task()
    );
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn().mockReturnValue(undefined),
    });
    (parseHwTclFile as jest.Mock).mockResolvedValue({
      componentName: 'example',
      yamlText: 'vlnv: { name: example }\n',
    });
    (loadIpCoreData as jest.Mock).mockResolvedValue({ busInterfaces: [] });
    (loadRuntimeBusLibrary as jest.Mock).mockResolvedValue({ contracts: [] });
    (writeImportedFile as jest.Mock).mockResolvedValue('created');
  });

  it('does not write a known-invalid imported IP core', async () => {
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

    await parseHwTcl(context, sourceUri);

    expect(writeImportedFile).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Known invalid interface.')
    );
  });

  it('writes one IP file and warns for an unresolved imported interface', async () => {
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

    await parseHwTcl(context, sourceUri);

    expect(writeImportedFile).toHaveBeenCalledTimes(1);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Bus type could not be resolved.')
    );
  });
});
