import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

const FAKE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-catalog-atomic-'));
jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => FAKE_CONFIG_DIR,
}));
jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, writeFile: jest.fn(actual.writeFile) };
});
jest.mock('../../../services/BuildRunner');
jest.mock('../../../services/toolchains/registry');
jest.mock('../../../utils/vivadoResolver');

import * as fsPromises from 'fs/promises';
import { VivadoCatalogScanner } from '../../../services/VivadoCatalogScanner';
import * as buildRunner from '../../../services/BuildRunner';
import * as registry from '../../../services/toolchains/registry';
import * as vivadoResolver from '../../../utils/vivadoResolver';
import * as cacheVersion from '../../../services/VivadoCacheVersion';

const realFsPromises = jest.requireActual<typeof import('fs/promises')>('fs/promises');
const mockWriteFile = fsPromises.writeFile as jest.Mock;
const mockRunProcess = buildRunner.runProcess as jest.Mock;
const mockGetToolchain = registry.getToolchain as jest.Mock;
const mockGetVivadoLauncher = vivadoResolver.getVivadoLauncher as jest.Mock;

const cfg = {
  get: <T>(key: string, fallback?: T): T => (key === 'vivado.pinnedVersion' ? '' : fallback) as T,
} as vscode.WorkspaceConfiguration;

describe('VivadoCatalogScanner atomic cache replacement', () => {
  beforeEach(() => {
    mockWriteFile.mockImplementation(realFsPromises.writeFile);
    mockGetToolchain.mockReturnValue({
      getDocker: jest.fn(),
      getLaunchEnv: jest.fn(() => ({ env: {}, extraMounts: [] })),
    });
    mockGetVivadoLauncher.mockReturnValue({ exe: '/opt/vivado/bin/vivado', prefixArgs: [] });
    mockRunProcess.mockImplementation(
      async (_exe: string, _args: string[], options: { cwd: string }) => {
        fs.writeFileSync(
          path.join(options.cwd, 'ipdefs.txt'),
          'xilinx.com:ip:axi_gpio:2.0\n',
          'utf8'
        );
        return { success: true, exitCode: 0 };
      }
    );
  });

  afterEach(() => {
    fs.rmSync(path.join(FAKE_CONFIG_DIR, 'vivado'), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(FAKE_CONFIG_DIR, { recursive: true, force: true });
  });

  it('preserves the prior selected catalog when a staged replacement write fails', async () => {
    const scanner = new VivadoCatalogScanner();
    const resource = {
      fsPath: '/workspace/core.ip.yml',
      toString: () => 'file:///workspace/core.ip.yml',
    } as vscode.Uri;
    const choice = { runner: 'local' as const, version: '2024.2' };
    await scanner.scan(choice, cfg, resource);
    const recordSpy = jest.spyOn(cacheVersion, 'recordVivadoCacheSelection');
    mockWriteFile.mockImplementation(
      async (file: unknown, contents: unknown, encoding: unknown) => {
        if (String(file).includes('catalog.json')) {
          fs.writeFileSync(String(file), '{', 'utf8');
          throw new Error('disk full');
        }
        return realFsPromises.writeFile(
          file as string,
          contents as string,
          encoding as BufferEncoding
        );
      }
    );

    try {
      await expect(scanner.scan(choice, cfg, resource)).rejects.toThrow('disk full');

      await expect(scanner.loadCachedCatalog('2024.2')).resolves.toEqual([
        'xilinx.com:ip:axi_gpio:2.0',
      ]);
      await expect(cacheVersion.resolveVivadoCacheVersion(cfg, 'catalog', resource)).resolves.toBe(
        '2024.2'
      );
      expect(recordSpy).not.toHaveBeenCalled();
      const catalogDir = path.join(FAKE_CONFIG_DIR, 'vivado', '2024.2');
      expect(fs.readdirSync(catalogDir).some((name) => name.includes('.tmp-'))).toBe(false);
    } finally {
      recordSpy.mockRestore();
    }
  });
});
