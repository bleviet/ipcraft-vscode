import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { openInVivadoCommand } from '../../../commands/openInVivado';
import { openInQuartusCommand } from '../../../commands/openInQuartus';
import * as buildRunner from '../../../services/BuildRunner';
import * as toolchainRegistry from '../../../services/toolchains/registry';
import * as resolveToolchainVersion from '../../../services/toolchains/resolveToolchainVersion';

jest.mock('../../../services/BuildRunner');
jest.mock('../../../services/toolchains/registry');
jest.mock('../../../services/toolchains/resolveToolchainVersion');

const mockSpawnGui = buildRunner.spawnGui as jest.Mock;
const mockGetToolchain = toolchainRegistry.getToolchain as jest.Mock;
const mockResolveForOpen = resolveToolchainVersion.resolveToolchainVersionForOpen as jest.Mock;

const mockToolchain = {
  displayName: 'Vendor GUI',
  resolve: jest.fn(),
  getDocker: jest.fn(),
  getLaunchEnv: jest.fn(),
};

function uri(fsPath: string): vscode.Uri {
  return { fsPath } as vscode.Uri;
}

describe('open vendor projects in Docker', () => {
  beforeEach(() => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({});
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    (vscode.workspace as unknown as { getWorkspaceFolder?: jest.Mock }).getWorkspaceFolder =
      jest.fn(() => undefined);
    mockGetToolchain.mockReturnValue(mockToolchain);
    mockToolchain.resolve.mockReturnValue({ exe: '/host/vendor/bin/tool', prefixArgs: [] });
    mockToolchain.getLaunchEnv.mockReturnValue({ env: {}, extraMounts: [] });
  });

  it('opens Vivado with its container-native executable, never the resolved host path', async () => {
    mockResolveForOpen.mockResolvedValue({ runner: 'docker', version: '2024.2' });
    mockToolchain.getDocker.mockReturnValue({
      image: 'example/vivado:2024.2',
      mountBase: '/project',
    });

    await openInVivadoCommand(uri('/project/xilinx/build/foo.xpr'));

    expect(mockToolchain.resolve).not.toHaveBeenCalled();
    expect(mockSpawnGui).toHaveBeenCalledWith(
      'vivado',
      ['/project/xilinx/build/foo.xpr'],
      expect.objectContaining({
        docker: expect.objectContaining({ image: 'example/vivado:2024.2' }),
      }),
      'Vendor GUI'
    );
  });

  it('mounts the selected project workspace folder instead of the first folder in Docker', async () => {
    const firstFolder = uri('/workspace-a');
    const secondFolder = uri('/workspace-b');
    const project = uri('/workspace-b/ip/xilinx/build/foo.xpr');
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: firstFolder },
      { uri: secondFolder },
    ];
    (vscode.workspace as unknown as { getWorkspaceFolder: jest.Mock }).getWorkspaceFolder = jest.fn(
      () => ({ uri: secondFolder })
    );
    mockResolveForOpen.mockResolvedValue({ runner: 'docker', version: '2024.2' });
    mockToolchain.getDocker.mockReturnValue({
      image: 'example/vivado:2024.2',
      mountBase: '/workspace-b',
    });

    await openInVivadoCommand(project);

    expect(mockToolchain.getDocker).toHaveBeenCalledWith(
      expect.anything(),
      '/workspace-b',
      '2024.2'
    );
    expect(mockSpawnGui).toHaveBeenCalledWith(
      'vivado',
      ['/workspace-b/ip/xilinx/build/foo.xpr'],
      expect.objectContaining({
        cwd: '/workspace-b/ip/xilinx/build',
        docker: expect.objectContaining({ mountBase: '/workspace-b' }),
      }),
      'Vendor GUI'
    );
  });

  it('mounts the generated IP root for an outside-workspace Docker project', async () => {
    const ipRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-open-vivado-'));
    const xprPath = path.join(ipRoot, 'xilinx', 'build', 'foo.xpr');
    fs.mkdirSync(path.dirname(xprPath), { recursive: true });
    fs.writeFileSync(xprPath, 'project', 'utf8');
    fs.writeFileSync(path.join(ipRoot, 'component.xml'), '<component/>', 'utf8');
    try {
      mockResolveForOpen.mockResolvedValue({ runner: 'docker', version: '2024.2' });
      mockToolchain.getDocker.mockReturnValue({
        image: 'example/vivado:2024.2',
        mountBase: ipRoot,
      });

      await openInVivadoCommand(uri(xprPath));

      expect(mockToolchain.getDocker).toHaveBeenCalledWith(expect.anything(), ipRoot, '2024.2');
      expect(mockSpawnGui).toHaveBeenCalledWith(
        'vivado',
        expect.arrayContaining(['-mode', 'gui', '-source', path.join(ipRoot, 'ipcraft_open.tcl')]),
        expect.objectContaining({
          cwd: ipRoot,
          docker: expect.objectContaining({ mountBase: ipRoot }),
        }),
        'Vendor GUI'
      );
    } finally {
      fs.rmSync(ipRoot, { recursive: true, force: true });
    }
  });

  it('opens Quartus with its container-native executable, never the resolved host path', async () => {
    mockResolveForOpen.mockResolvedValue({ runner: 'docker', version: '23.1' });
    mockToolchain.getDocker.mockReturnValue({
      image: 'example/quartus:23.1',
      mountBase: '/project',
    });

    await openInQuartusCommand(uri('/project/altera/build/foo.qpf'));

    expect(mockToolchain.resolve).not.toHaveBeenCalled();
    expect(mockSpawnGui).toHaveBeenCalledWith(
      'quartus',
      ['/project/altera/build/foo.qpf'],
      expect.objectContaining({
        docker: expect.objectContaining({ image: 'example/quartus:23.1' }),
      }),
      'Vendor GUI'
    );
  });
});
