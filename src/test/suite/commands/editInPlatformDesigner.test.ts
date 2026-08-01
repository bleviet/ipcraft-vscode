import * as vscode from 'vscode';
import { editInPlatformDesignerCommand } from '../../../commands/editInPlatformDesigner';
import * as buildRunner from '../../../services/BuildRunner';
import * as toolchainRegistry from '../../../services/toolchains/registry';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';
import * as sourceFileMounts from '../../../utils/sourceFileMounts';
import * as fs from 'fs/promises';

jest.mock('../../../services/BuildRunner');
jest.mock('../../../services/toolchains/registry');
jest.mock('../../../services/toolchains/resolveToolchainVersion');
jest.mock('../../../utils/sourceFileMounts');
jest.mock('fs/promises');

const mockSpawnGui = buildRunner.spawnGui as jest.Mock;
const mockGetToolchain = toolchainRegistry.getToolchain as jest.Mock;
const mockResolveForResource =
  resolveToolchainVersion.resolveToolchainVersionForResource as jest.Mock;
const mockSourceDirsFromHwTcl = sourceFileMounts.sourceDirsFromHwTcl as jest.Mock;
const mockReaddir = fs.readdir as jest.Mock;

const mockToolchain = {
  resolve: jest.fn(),
  getDocker: jest.fn(),
  getLaunchEnv: jest.fn(),
};

function uri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

describe('editInPlatformDesignerCommand', () => {
  beforeEach(() => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({});
    mockGetToolchain.mockReturnValue(mockToolchain);
    mockToolchain.resolve.mockReturnValue({ exe: 'qsys-edit', prefixArgs: [] });
    mockToolchain.getDocker.mockReturnValue(undefined);
    mockToolchain.getLaunchEnv.mockReturnValue({ env: {}, extraMounts: [] });
    mockSourceDirsFromHwTcl.mockResolvedValue([]);
    mockReaddir.mockResolvedValue([]);
  });

  it('forwards the selected Quartus version to Platform Designer resolution and Docker', async () => {
    // Removing the preferred version from either toolchain call would launch a
    // different configured Quartus release than the user selected.
    mockResolveForResource.mockResolvedValue({ runner: 'local', version: '23.1' });

    await editInPlatformDesignerCommand(uri('/ip/altera/foo_hw.tcl'));

    expect(mockToolchain.resolve).toHaveBeenCalledWith('qsys-edit', expect.anything(), '23.1');
    expect(mockToolchain.getDocker).toHaveBeenCalledWith(expect.anything(), '/ip', '23.1');
    expect(mockSpawnGui).toHaveBeenCalled();
  });

  it('does not launch Platform Designer when version selection is cancelled', async () => {
    mockResolveForResource.mockResolvedValue(undefined);

    await editInPlatformDesignerCommand(uri('/ip/altera/foo_hw.tcl'));

    expect(mockSpawnGui).not.toHaveBeenCalled();
  });

  it('uses the native container qsys-edit command instead of a host path for Docker', async () => {
    mockResolveForResource.mockResolvedValue({ runner: 'docker', version: '23.1' });
    mockToolchain.resolve.mockReturnValue({ exe: '/host/quartus/bin/qsys-edit', prefixArgs: [] });
    mockToolchain.getDocker.mockReturnValue({ image: 'example/quartus:23.1', mountBase: '/ip' });

    await editInPlatformDesignerCommand(uri('/ip/altera/foo_hw.tcl'));

    expect(mockToolchain.resolve).not.toHaveBeenCalled();
    expect(mockSpawnGui).toHaveBeenCalledWith(
      'qsys-edit',
      expect.any(Array),
      expect.objectContaining({
        docker: expect.objectContaining({ image: 'example/quartus:23.1' }),
      }),
      'Platform Designer'
    );
  });
});
