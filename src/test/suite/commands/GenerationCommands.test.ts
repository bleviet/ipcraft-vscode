import * as vscode from 'vscode';
import { scaffoldProject } from '../../../commands/GenerationCommands';
import * as generationEngine from '../../../services/GenerationEngine';
import * as pickBoard from '../../../utils/pickBoard';
import * as vendorProjectCommands from '../../../commands/VendorProjectCommands';
import { CONFIG_KEY_IPCRAFT_TOOLBAR } from '../../../utils/configKeys';

jest.mock('../../../services/GenerationEngine');
jest.mock('../../../utils/pickBoard');
jest.mock('../../../commands/VendorProjectCommands');

describe('scaffoldProject', () => {
  const context = {} as vscode.ExtensionContext;
  const resourceRoots = {} as never;
  const ipCoreUri = vscode.Uri.file('/workspace-b/core/foo.ip.yml');

  beforeEach(() => {
    (generationEngine.runGenerator as jest.Mock).mockResolvedValue(true);
    (generationEngine.readScaffoldPackSetting as jest.Mock).mockReturnValue(undefined);
    (pickBoard.pickVivadoPart as jest.Mock).mockResolvedValue('xc7z020clg484-1');
    (pickBoard.pickQuartusDevice as jest.Mock).mockResolvedValue('5CSEBA6U23I7');
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === CONFIG_KEY_IPCRAFT_TOOLBAR && key === 'targets') {
          return ['vivado', 'quartus'];
        }
        return fallback;
      },
    }));
  });

  it('forwards the originating resource to both project-creation steps', async () => {
    await scaffoldProject(context, resourceRoots, ipCoreUri);

    expect(vendorProjectCommands.runCreateVivadoProjectStep).toHaveBeenCalledWith(
      'foo',
      '/workspace-b/core',
      ipCoreUri
    );
    expect(vendorProjectCommands.runCreateQuartusProjectStep).toHaveBeenCalledWith(
      'foo',
      '/workspace-b/core',
      ipCoreUri
    );
  });
});
