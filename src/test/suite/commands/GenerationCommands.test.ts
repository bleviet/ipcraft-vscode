import * as vscode from 'vscode';
import { scaffoldProject } from '../../../commands/GenerationCommands';
import * as generationEngine from '../../../services/GenerationEngine';
import * as pickBoard from '../../../utils/pickBoard';
import * as vendorProjectCommands from '../../../commands/VendorProjectCommands';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';
import { CONFIG_KEY_IPCRAFT_TOOLBAR } from '../../../utils/configKeys';

jest.mock('../../../services/GenerationEngine');
jest.mock('../../../utils/pickBoard');
jest.mock('../../../commands/VendorProjectCommands');
jest.mock('../../../services/toolchains/resolveToolchainVersion');

describe('scaffoldProject', () => {
  const context = {} as vscode.ExtensionContext;
  const resourceRoots = {} as never;
  const ipCoreUri = vscode.Uri.file('/workspace-b/core/foo.ip.yml');

  beforeEach(() => {
    (generationEngine.runGenerator as jest.Mock).mockResolvedValue({
      success: true,
      ipCoreName: 'canonical_core',
    });
    (generationEngine.readScaffoldPackSetting as jest.Mock).mockReturnValue(undefined);
    (pickBoard.pickVivadoPart as jest.Mock).mockResolvedValue('xc7z020clg484-1');
    (pickBoard.pickQuartusDevice as jest.Mock).mockResolvedValue('5CSEBA6U23I7');
    (resolveToolchainVersion.resolveToolchainVersionForCreate as jest.Mock).mockImplementation(
      async (_cfg: unknown, vendor: 'vivado' | 'quartus') => ({
        runner: 'local',
        version: vendor === 'vivado' ? '2024.2' : '23.1',
      })
    );
    (vscode.workspace.getConfiguration as jest.Mock).mockImplementation((section: string) => ({
      get: (key: string, fallback?: unknown) => {
        if (section === CONFIG_KEY_IPCRAFT_TOOLBAR && key === 'targets') {
          return ['vivado', 'quartus'];
        }
        return fallback;
      },
    }));
  });

  it('uses the generated vlnv.name rather than the IP YAML filename for project creation', async () => {
    await scaffoldProject(context, resourceRoots, ipCoreUri);

    expect(vendorProjectCommands.runCreateVivadoProjectStep).toHaveBeenCalledWith(
      'canonical_core',
      '/workspace-b/core',
      ipCoreUri,
      { runner: 'local', version: '2024.2' }
    );
    expect(vendorProjectCommands.runCreateQuartusProjectStep).toHaveBeenCalledWith(
      'canonical_core',
      '/workspace-b/core',
      ipCoreUri,
      { runner: 'local', version: '23.1' }
    );
  });

  it('resolves every vendor version before generation exposes a project that can be opened', async () => {
    const events: string[] = [];
    (resolveToolchainVersion.resolveToolchainVersionForCreate as jest.Mock).mockImplementation(
      async (_cfg: unknown, vendor: 'vivado' | 'quartus') => {
        events.push(`select:${vendor}`);
        return { runner: 'local', version: vendor === 'vivado' ? '2024.2' : '23.1' };
      }
    );
    (generationEngine.runGenerator as jest.Mock).mockImplementation(async () => {
      events.push('generate');
      return { success: true, ipCoreName: 'canonical_core' };
    });
    (vendorProjectCommands.runCreateVivadoProjectStep as jest.Mock).mockImplementation(async () => {
      events.push('create:vivado');
    });
    (vendorProjectCommands.runCreateQuartusProjectStep as jest.Mock).mockImplementation(
      async () => {
        events.push('create:quartus');
      }
    );

    await scaffoldProject(context, resourceRoots, ipCoreUri);

    expect(events).toEqual([
      'select:vivado',
      'select:quartus',
      'generate',
      'create:vivado',
      'create:quartus',
    ]);
  });
});
