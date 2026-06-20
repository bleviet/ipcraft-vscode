import * as vscode from 'vscode';

const mockPathExists = jest.fn<Promise<boolean>, [string]>();
jest.mock('../../../services/VivadoInterfaceScanner', () => ({
  getVivadoInterfaceCacheDir: () => '/fake/vivado/cache/bus_definitions',
  pathExists: (p: string): Promise<boolean> => mockPathExists(p),
}));

import { ImportResolver } from '../../../services/ImportResolver';
import { Logger } from '../../../utils/Logger';

type LoggerMock = Pick<Logger, 'info' | 'warn' | 'error'>;

describe('ImportResolver', () => {
  let logger: LoggerMock;
  let readFileMock: jest.Mock;
  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    mockPathExists.mockReset().mockResolvedValue(false);

    readFileMock = jest.fn();
    (vscode.workspace as unknown as { fs: { readFile: jest.Mock; stat: jest.Mock } }).fs = {
      readFile: readFileMock,
      stat: jest.fn().mockResolvedValue({ type: vscode.FileType.File }),
    };
    (vscode.Uri.file as jest.Mock).mockImplementation((filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }));
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
  });

  it('loads default bus library when useBusLibrary is not provided', async () => {
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');
    (
      resolver as unknown as { busLibraryService: { loadDefaultLibrary: jest.Mock } }
    ).busLibraryService.loadDefaultLibrary = jest
      .fn()
      .mockResolvedValue({ axi4: { ports: ['awaddr'] } });

    const result = await resolver.resolveImports({}, '/project');

    expect(result.busLibrary).toEqual({ axi4: { ports: ['awaddr'] } });
    expect(result.memoryMaps).toBeUndefined();
  });

  it('does not merge in the Vivado interface cache when it has not been scanned', async () => {
    mockPathExists.mockResolvedValue(false);
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');
    const loadFromUserPaths = jest.fn().mockResolvedValue({});
    (
      resolver as unknown as {
        busLibraryService: { loadDefaultLibrary: jest.Mock; loadFromUserPaths: jest.Mock };
      }
    ).busLibraryService.loadDefaultLibrary = jest.fn().mockResolvedValue({});
    (
      resolver as unknown as { busLibraryService: { loadFromUserPaths: jest.Mock } }
    ).busLibraryService.loadFromUserPaths = loadFromUserPaths;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue?: unknown) =>
        key === 'busLibraryPaths' ? ['./my-buses'] : defaultValue,
    });

    await resolver.resolveImports({}, '/project');

    expect(loadFromUserPaths).toHaveBeenCalledWith(['./my-buses'], undefined);
  });

  it('merges in the cached Vivado interface catalog when it has been scanned', async () => {
    mockPathExists.mockResolvedValue(true);
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');
    const loadFromUserPaths = jest.fn().mockResolvedValue({});
    (
      resolver as unknown as { busLibraryService: { loadDefaultLibrary: jest.Mock } }
    ).busLibraryService.loadDefaultLibrary = jest.fn().mockResolvedValue({});
    (
      resolver as unknown as { busLibraryService: { loadFromUserPaths: jest.Mock } }
    ).busLibraryService.loadFromUserPaths = loadFromUserPaths;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue?: unknown) =>
        key === 'busLibraryPaths' ? ['./my-buses'] : defaultValue,
    });

    await resolver.resolveImports({}, '/project');

    expect(loadFromUserPaths).toHaveBeenCalledWith(
      ['./my-buses', '/fake/vivado/cache/bus_definitions'],
      undefined
    );
  });

  it('merges in the cached Vivado interface catalog even with no busLibraryPaths configured', async () => {
    mockPathExists.mockResolvedValue(true);
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');
    const loadFromUserPaths = jest.fn().mockResolvedValue({});
    (
      resolver as unknown as { busLibraryService: { loadDefaultLibrary: jest.Mock } }
    ).busLibraryService.loadDefaultLibrary = jest.fn().mockResolvedValue({});
    (
      resolver as unknown as { busLibraryService: { loadFromUserPaths: jest.Mock } }
    ).busLibraryService.loadFromUserPaths = loadFromUserPaths;

    await resolver.resolveImports({}, '/project');

    expect(loadFromUserPaths).toHaveBeenCalledWith(
      ['/fake/vivado/cache/bus_definitions'],
      undefined
    );
  });

  it('falls back to default bus library when explicit bus library fails', async () => {
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');
    (
      resolver as unknown as { busLibraryService: { loadDefaultLibrary: jest.Mock } }
    ).busLibraryService.loadDefaultLibrary = jest
      .fn()
      .mockResolvedValue({ fallback: { ports: ['clk'] } });

    readFileMock.mockRejectedValue(new Error('missing bus library'));

    const result = await resolver.resolveImports({ useBusLibrary: 'custom_bus.yml' }, '/project');

    expect(result.busLibrary).toEqual({ fallback: { ports: ['clk'] } });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Falling back to default bus library.')
    );
  });

  it('resolves memory map imports for array and single-object YAML payloads', async () => {
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');

    readFileMock
      .mockResolvedValueOnce(Buffer.from('- name: map0\n  baseAddress: 0x0\n', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('name: map1\nbaseAddress: 0x1000\n', 'utf8'));

    const fromArray = await resolver.resolveMemoryMapImport('array.mm.yml', '/project');
    const fromObject = await resolver.resolveMemoryMapImport('single.mm.yml', '/project');

    expect(fromArray).toEqual([{ name: 'map0', baseAddress: 0 }]);
    expect(fromObject).toEqual([{ name: 'map1', baseAddress: 4096 }]);
  });

  it('throws when any file set import fails', async () => {
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');

    readFileMock.mockImplementation(async (uri: { fsPath: string }) => {
      if (uri.fsPath.endsWith('good_a.fileset.yml')) {
        return Buffer.from('- name: RTL\n  files:\n    - path: rtl/a.vhd\n', 'utf8');
      }
      if (uri.fsPath.endsWith('good_b.fileset.yml')) {
        return Buffer.from('name: SIM\nfiles:\n  - path: sim/tb.vhd\n', 'utf8');
      }
      throw new Error('missing fileset');
    });

    const fileSets = [
      { import: 'good_a.fileset.yml' },
      { import: 'missing.fileset.yml' },
      { import: 'good_b.fileset.yml' },
      { name: 'Local', files: [{ path: 'local/top.vhd' }] },
    ];

    await expect(resolver.resolveFileSetImports(fileSets, '/project')).rejects.toThrow(
      'Failed to load file set import missing.fileset.yml: missing fileset'
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to resolve file set import: missing.fileset.yml',
      expect.any(Error)
    );
  });

  it('caches resolved bus library by absolute path and reloads after clearCache', async () => {
    const resolver = new ImportResolver(logger as Logger, '/ext/dist/resources/bus_definitions');
    readFileMock
      .mockResolvedValueOnce(Buffer.from('axi4: { ports: [awaddr] }', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('wishbone: { ports: [adr] }', 'utf8'));

    const first = await resolver.resolveBusLibrary('bus.yml', '/project');
    const second = await resolver.resolveBusLibrary('bus.yml', '/project');
    resolver.clearCache();
    const third = await resolver.resolveBusLibrary('bus.yml', '/project');

    expect(first).toEqual({ axi4: { ports: ['awaddr'] } });
    expect(second).toBe(first);
    expect(third).toEqual({ wishbone: { ports: ['adr'] } });
    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('Bus library cache cleared');
  });
});
