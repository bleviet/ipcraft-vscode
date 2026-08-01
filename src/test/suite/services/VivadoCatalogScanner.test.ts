import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import { VivadoCatalogScanner } from '../../../services/VivadoCatalogScanner';
import * as buildRunner from '../../../services/BuildRunner';
import * as registry from '../../../services/toolchains/registry';
import * as vivadoResolver from '../../../utils/vivadoResolver';
import * as cacheVersion from '../../../services/VivadoCacheVersion';

jest.mock('fs/promises');
jest.mock('../../../services/BuildRunner');
jest.mock('../../../services/toolchains/registry');
jest.mock('../../../utils/vivadoResolver');
jest.mock('../../../services/VivadoCacheVersion');
jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => '/ipcraft-config',
}));

const mockRunProcess = buildRunner.runProcess as jest.Mock;
const mockWriteFile = fs.writeFile as jest.Mock;
const mockGetToolchain = registry.getToolchain as jest.Mock;
const mockGetVivadoLauncher = vivadoResolver.getVivadoLauncher as jest.Mock;
const mockRecordCacheSelection = cacheVersion.recordVivadoCacheSelection as jest.Mock;

describe('VivadoCatalogScanner', () => {
  const cfg = { get: jest.fn() } as unknown as vscode.WorkspaceConfiguration;
  const toolchain = {
    getDocker: jest.fn(),
    getLaunchEnv: jest.fn(),
  };

  beforeEach(() => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue(cfg);
    mockGetToolchain.mockReturnValue(toolchain);
    toolchain.getDocker.mockReturnValue(undefined);
    toolchain.getLaunchEnv.mockReturnValue({ env: {}, extraMounts: [] });
    mockGetVivadoLauncher.mockReturnValue({ exe: '/opt/Vivado/2024.2/bin/vivado', prefixArgs: [] });
    (fs.mkdir as jest.Mock).mockResolvedValue(undefined);
    (fs.rm as jest.Mock).mockResolvedValue(undefined);
    (fs.readFile as jest.Mock).mockResolvedValue('xilinx.com:ip:axi_gpio:2.0\n');
    mockWriteFile.mockResolvedValue(undefined);
    mockRunProcess.mockResolvedValue({ success: true, exitCode: 0 });
  });

  it('uses the selected local launcher and writes a version-isolated catalog', async () => {
    const scanner = new VivadoCatalogScanner();
    const resource = { fsPath: '/workspace/core.ip.yml' } as vscode.Uri;

    const result = await scanner.scan({ runner: 'local', version: '2024.2' }, cfg, resource);

    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
    expect(mockGetVivadoLauncher).toHaveBeenCalledWith(cfg, '2024.2');
    expect(result.catalogPath).toBe(
      path.join('/ipcraft-config', 'vivado', '2024.2', 'catalog.json')
    );
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/\/2024\.2\/\.catalog\.json\.tmp-/),
      expect.any(String),
      'utf8'
    );
    expect(mockRecordCacheSelection).toHaveBeenCalledWith(
      cfg,
      'catalog',
      { runner: 'local', version: '2024.2' },
      resource
    );
  });

  it('selects the requested Docker image and uses the container Vivado command', async () => {
    toolchain.getDocker.mockReturnValue({ image: 'vivado:2023.1', mountBase: '/tmp/scan' });
    const scanner = new VivadoCatalogScanner();

    await scanner.scan({ runner: 'docker', version: '2023.1' });

    expect(toolchain.getDocker).toHaveBeenCalledWith(cfg, expect.any(String), '2023.1');
    expect(mockRunProcess).toHaveBeenCalledWith(
      'vivado',
      expect.arrayContaining(['-mode', 'batch']),
      expect.objectContaining({
        docker: { image: 'vivado:2023.1', mountBase: expect.any(String) },
      })
    );
    expect(mockGetVivadoLauncher).not.toHaveBeenCalled();
  });

  it('honors the legacy dockerImage when no multi-version Docker choice exists', async () => {
    (cfg.get as jest.Mock).mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'vivado.runner') {
        return 'docker';
      }
      if (key === 'vivado.dockerImage') {
        return 'legacy/vivado:2022.2';
      }
      return fallback;
    });
    toolchain.getDocker.mockReturnValue({ image: 'legacy/vivado:2022.2', mountBase: '/tmp/scan' });
    const scanner = new VivadoCatalogScanner();

    await scanner.scan(null, cfg);

    expect(toolchain.getDocker).toHaveBeenCalledWith(cfg, expect.any(String), undefined);
    expect(mockRunProcess).toHaveBeenCalledWith(
      'vivado',
      expect.any(Array),
      expect.objectContaining({
        docker: { image: 'legacy/vivado:2022.2', mountBase: expect.any(String) },
      })
    );
    expect(mockGetVivadoLauncher).not.toHaveBeenCalled();
  });
});
