import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';

const mockPathExists = jest.fn<Promise<boolean>, [string]>();
const mockGetVivadoInterfaceCacheDir = jest.fn(
  (version?: string) => `/fake/vivado/${version ?? 'legacy'}/bus_definitions`
);
jest.mock('../../../services/VivadoInterfaceScanner', () => ({
  getVivadoInterfaceCacheDir: (version?: string) => mockGetVivadoInterfaceCacheDir(version),
  pathExists: (p: string): Promise<boolean> => mockPathExists(p),
}));

const mockWorkspaceScan = jest.fn<
  { library: Record<string, unknown>; count: number; files: unknown[] },
  []
>();
jest.mock('../../../services/WorkspaceBusDefinitionScanner', () => ({
  getWorkspaceBusDefinitionScanner: () => ({
    peekAndScanInBackground: () => mockWorkspaceScan(),
    clearCache: jest.fn(),
    onDidScan: jest.fn(() => ({ dispose: jest.fn() })),
  }),
}));

import { ImportResolver } from '../../../services/ImportResolver';
import { Logger } from '../../../utils/Logger';
import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import type { LoadedBusDefinitionSources } from '../../../services/BusLibraryService';

type LoggerMock = Pick<Logger, 'info' | 'warn' | 'error'>;
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/bus_definition.schema.json'
);
const BUS_DIR = '/ext/dist/resources/bus_definitions';

function definition(key: string, name: string, port: string): BusDefinitionFile {
  return {
    [key]: {
      busType: { vendor: 'example.com', library: 'interface', name, version: '1.0' },
      contract: {
        version: 1,
        interfaceKind: 'conduit',
        modePolicy: { producer: 'master', consumer: 'slave', aliases: {} },
        interfaceProperties: {},
        constraints: [],
      },
      ports: [{ name: port, direction: 'in', role: 'control' }],
    },
  };
}

function loaded(definitions?: BusDefinitionFile): LoadedBusDefinitionSources {
  return definitions
    ? {
        sources: [{ sourceFile: '/builtin/test.yml', sourceKind: 'builtin', definitions }],
        diagnostics: [],
      }
    : { sources: [], diagnostics: [] };
}

function createResolver(logger: LoggerMock): ImportResolver {
  const resolver = new ImportResolver(logger as Logger, BUS_DIR, SCHEMA_PATH);
  (
    resolver as unknown as { busLibraryService: { loadDefaultSources: jest.Mock } }
  ).busLibraryService.loadDefaultSources = jest.fn().mockResolvedValue(loaded());
  return resolver;
}

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
    mockGetVivadoInterfaceCacheDir.mockImplementation(
      (version?: string) => `/fake/vivado/${version ?? 'legacy'}/bus_definitions`
    );
    mockWorkspaceScan.mockReset().mockReturnValue({ library: {}, count: 0, files: [] });

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
    const resolver = createResolver(logger);
    (
      resolver as unknown as { busLibraryService: { loadDefaultSources: jest.Mock } }
    ).busLibraryService.loadDefaultSources = jest
      .fn()
      .mockResolvedValue(loaded(definition('AXI4', 'axi4', 'awaddr')));

    const result = await resolver.resolveImports({}, '/project');

    expect(result.busLibrary?.definitions.AXI4.ports[0].name).toBe('awaddr');
    expect(result.memoryMaps).toBeUndefined();
  });

  it('does not merge in the Vivado interface cache when it has not been scanned', async () => {
    mockPathExists.mockResolvedValue(false);
    const resolver = createResolver(logger);
    const loadFromUserPaths = jest.fn().mockResolvedValue(loaded());
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
    const resolver = createResolver(logger);
    const loadFromUserPaths = jest.fn().mockResolvedValue(loaded());
    (
      resolver as unknown as { busLibraryService: { loadFromUserPaths: jest.Mock } }
    ).busLibraryService.loadFromUserPaths = loadFromUserPaths;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue?: unknown) =>
        key === 'busLibraryPaths' ? ['./my-buses'] : defaultValue,
    });

    await resolver.resolveImports({}, '/project');

    expect(loadFromUserPaths).toHaveBeenCalledWith(
      ['./my-buses', '/fake/vivado/legacy/bus_definitions'],
      undefined
    );
  });

  it('loads the resource-pinned Vivado interface cache', async () => {
    mockPathExists.mockResolvedValue(true);
    const resolver = createResolver(logger);
    const loadFromUserPaths = jest.fn().mockResolvedValue(loaded());
    (
      resolver as unknown as { busLibraryService: { loadFromUserPaths: jest.Mock } }
    ).busLibraryService.loadFromUserPaths = loadFromUserPaths;
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (key: string, defaultValue?: unknown) =>
        key === 'vivado.pinnedVersion' ? '2024.2' : defaultValue,
    });

    const resource = {
      fsPath: '/workspace/ip/core.ip.yml',
      toString: () => 'file:///workspace/ip/core.ip.yml',
    } as vscode.Uri;

    await resolver.resolveImports({}, '/workspace/ip', resource);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('ipcraft', resource);
    expect(mockGetVivadoInterfaceCacheDir).toHaveBeenCalledWith('2024.2');
    expect(loadFromUserPaths).toHaveBeenCalledWith(
      ['/fake/vivado/2024.2/bus_definitions'],
      undefined
    );
  });

  it('merges in the cached Vivado interface catalog even with no busLibraryPaths configured', async () => {
    mockPathExists.mockResolvedValue(true);
    const resolver = createResolver(logger);
    const loadFromUserPaths = jest.fn().mockResolvedValue(loaded());
    (
      resolver as unknown as { busLibraryService: { loadFromUserPaths: jest.Mock } }
    ).busLibraryService.loadFromUserPaths = loadFromUserPaths;

    await resolver.resolveImports({}, '/project');

    expect(loadFromUserPaths).toHaveBeenCalledWith(
      ['/fake/vivado/legacy/bus_definitions'],
      undefined
    );
  });

  it('merges workspace-discovered bus definitions into the library', async () => {
    mockPathExists.mockResolvedValue(false);
    mockWorkspaceScan.mockReturnValue({
      library: definition('MY_CUSTOM_BUS', 'custom', 'CLK'),
      count: 1,
      files: [],
    });
    const resolver = createResolver(logger);
    (
      resolver as unknown as { busLibraryService: { loadDefaultSources: jest.Mock } }
    ).busLibraryService.loadDefaultSources = jest
      .fn()
      .mockResolvedValue(loaded(definition('AXI4_LITE', 'axi4lite', 'ACLK')));

    const result = await resolver.resolveImports({}, '/project');

    expect(Object.keys(result.busLibrary?.definitions ?? {})).toEqual([
      'AXI4_LITE',
      'MY_CUSTOM_BUS',
    ]);
    expect(result.busLibrary?.definitions.MY_CUSTOM_BUS.sourceFile).toBe('workspace://discovered');
  });

  it('clearCache also clears the workspace bus definition scanner cache', () => {
    const resolver = createResolver(logger);
    // clearCache should not throw and should log the cleared message.
    resolver.clearCache();
    expect(logger.info).toHaveBeenCalledWith('Bus library cache cleared');
  });

  it('falls back to default bus library when explicit bus library fails', async () => {
    const resolver = createResolver(logger);
    (
      resolver as unknown as { busLibraryService: { loadDefaultSources: jest.Mock } }
    ).busLibraryService.loadDefaultSources = jest
      .fn()
      .mockResolvedValue(loaded(definition('FALLBACK', 'fallback', 'clk')));

    readFileMock.mockRejectedValue(new Error('missing bus library'));

    const result = await resolver.resolveImports({ useBusLibrary: 'custom_bus.yml' }, '/project');

    expect(result.busLibrary?.definitions.FALLBACK.ports[0].name).toBe('clk');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Falling back to default bus library.')
    );
  });

  it('resolves memory map imports for array and single-object YAML payloads', async () => {
    const resolver = createResolver(logger);

    readFileMock
      .mockResolvedValueOnce(Buffer.from('- name: map0\n  baseAddress: 0x0\n', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('name: map1\nbaseAddress: 0x1000\n', 'utf8'));

    const fromArray = await resolver.resolveMemoryMapImport('array.mm.yml', '/project');
    const fromObject = await resolver.resolveMemoryMapImport('single.mm.yml', '/project');

    expect(fromArray).toEqual([{ name: 'map0', baseAddress: 0 }]);
    expect(fromObject).toEqual([{ name: 'map1', baseAddress: 4096 }]);
  });

  it('throws when any file set import fails', async () => {
    const resolver = createResolver(logger);

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
    const resolver = createResolver(logger);
    readFileMock
      .mockResolvedValueOnce(Buffer.from(yaml.dump(definition('AXI4', 'axi4', 'awaddr'))))
      .mockResolvedValueOnce(Buffer.from(yaml.dump(definition('WISHBONE', 'wishbone', 'adr'))));

    const first = await resolver.resolveBusLibrary('bus.yml', '/project');
    const second = await resolver.resolveBusLibrary('bus.yml', '/project');
    resolver.clearCache();
    const third = await resolver.resolveBusLibrary('bus.yml', '/project');

    expect(first.sources[0].definitions.AXI4.ports[0].name).toBe('awaddr');
    expect(second).toBe(first);
    expect(third.sources[0].definitions.WISHBONE.ports[0].name).toBe('adr');
    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith('Bus library cache cleared');
  });
});
