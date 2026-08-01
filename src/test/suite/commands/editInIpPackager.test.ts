import * as vscode from 'vscode';
import { editInIpPackagerCommand } from '../../../commands/editInIpPackager';
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
const mockSourceDirsFromComponentXml = sourceFileMounts.sourceDirsFromComponentXml as jest.Mock;
const mockMkdtemp = fs.mkdtemp as jest.Mock;
const mockWriteFile = fs.writeFile as jest.Mock;

const mockToolchain = {
  displayName: 'Vivado',
  resolve: jest.fn(),
  getDocker: jest.fn(),
  getLaunchEnv: jest.fn(),
};

function uri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

describe('editInIpPackagerCommand', () => {
  beforeEach(() => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({});
    mockGetToolchain.mockReturnValue(mockToolchain);
    mockToolchain.resolve.mockReturnValue({ exe: 'vivado', prefixArgs: [] });
    mockToolchain.getDocker.mockReturnValue(undefined);
    mockToolchain.getLaunchEnv.mockReturnValue({ env: {}, extraMounts: [] });
    mockSourceDirsFromComponentXml.mockResolvedValue([]);
    mockMkdtemp.mockResolvedValue('/tmp/ipcraft-vivado-test');
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('forwards the selected Vivado version to IP Packager resolution and Docker', async () => {
    // Removing the preferred version from either toolchain call would launch a
    // different configured Vivado release than the user selected.
    mockResolveForResource.mockResolvedValue({ runner: 'local', version: '2024.2' });

    await editInIpPackagerCommand(uri('/ip/xilinx/component.xml'));

    expect(mockToolchain.resolve).toHaveBeenCalledWith('vivado', expect.anything(), '2024.2');
    expect(mockToolchain.getDocker).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      '2024.2'
    );
    expect(mockSpawnGui).toHaveBeenCalled();
  });

  it('does not launch IP Packager when version selection is cancelled', async () => {
    mockResolveForResource.mockResolvedValue(undefined);

    await editInIpPackagerCommand(uri('/ip/xilinx/component.xml'));

    expect(mockSpawnGui).not.toHaveBeenCalled();
  });

  it('uses the native container vivado command instead of a host path for Docker', async () => {
    mockResolveForResource.mockResolvedValue({ runner: 'docker', version: '2024.2' });
    mockToolchain.resolve.mockReturnValue({ exe: '/host/xilinx/bin/vivado', prefixArgs: [] });
    mockToolchain.getDocker.mockReturnValue({ image: 'example/vivado:2024.2', mountBase: '/tmp' });

    await editInIpPackagerCommand(uri('/ip/xilinx/component.xml'));

    expect(mockToolchain.resolve).not.toHaveBeenCalled();
    expect(mockSpawnGui).toHaveBeenCalledWith(
      'vivado',
      expect.any(Array),
      expect.objectContaining({
        docker: expect.objectContaining({ image: 'example/vivado:2024.2' }),
      }),
      'Vivado'
    );
  });
});
