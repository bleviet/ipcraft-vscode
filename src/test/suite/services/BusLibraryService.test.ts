import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { Logger } from '../../../utils/Logger';
import type { BusDefinitionSource } from '../../../shared/busContracts';
import { vivadoInterfaceToBusDefEntry } from '../../../services/VivadoInterfaceScanner';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof fsPromises>('fs/promises');
  return { ...actual, readdir: jest.fn(), readFile: jest.fn() };
});

const mockReaddir = fsPromises.readdir as jest.Mock;
const mockFsReadFile = fsPromises.readFile as jest.Mock;

/** Builds a fs.Dirent-like entry for the `withFileTypes: true` readdir mock. */
function dirent(name: string, kind: 'file' | 'dir'): unknown {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
  };
}

type LoggerMock = Pick<Logger, 'info' | 'error'>;

const MOCK_DIR = '/ext/dist/resources/bus_definitions';
const SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/bus_definition.schema.json'
);

function completeDefinition(
  key: string,
  canonicalName: string,
  portName: string,
  role = 'control'
): string {
  return yaml.dump({
    [key]: {
      busType: {
        vendor: 'example.com',
        library: 'interface',
        name: canonicalName,
        version: '1.0',
      },
      contract: {
        version: 1,
        interfaceKind: 'conduit',
        modePolicy: { producer: 'master', consumer: 'slave', aliases: {} },
        interfaceProperties: {},
        constraints: [],
      },
      ports: [{ name: portName, direction: 'in', role }],
    },
  });
}

describe('BusLibraryService', () => {
  let logger: LoggerMock;
  let readFileMock: jest.Mock;
  let readDirectoryMock: jest.Mock;
  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    readFileMock = jest.fn();
    readDirectoryMock = jest.fn();
    (
      vscode.workspace as unknown as {
        fs: { readFile: jest.Mock; readDirectory: jest.Mock };
      }
    ).fs = {
      readFile: readFileMock,
      readDirectory: readDirectoryMock,
    };
    (vscode.Uri.file as jest.Mock).mockImplementation((filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }));
  });

  it('loads and merges all yml files from the bus definitions directory', async () => {
    readDirectoryMock.mockResolvedValue([
      ['axi4_lite.yml', vscode.FileType.File],
      ['avalon_mm.yml', vscode.FileType.File],
    ]);
    readFileMock
      .mockResolvedValueOnce(Buffer.from(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR')))
      .mockResolvedValueOnce(
        Buffer.from(completeDefinition('AVALON_MEMORY_MAPPED', 'avalon_mm', 'address'))
      );

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);
    const result = await service.loadDefaultLibrary();

    expect(Object.keys(result.definitions)).toEqual(['AXI4_LITE', 'AVALON_MEMORY_MAPPED']);
    expect(result.definitions.AXI4_LITE.ports[0].name).toBe('AWADDR');
    expect(result.definitions.AVALON_MEMORY_MAPPED.ports[0].name).toBe('address');
    expect(vscode.Uri.file).toHaveBeenCalledWith(MOCK_DIR);
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      `Loaded default bus library from ${MOCK_DIR} (2 files)`
    );
  });

  it('caches the result and reads directory only once', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock.mockResolvedValue(
      Buffer.from(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR'))
    );

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);
    const first = await service.loadDefaultLibrary();
    const second = await service.loadDefaultLibrary();

    expect(second).toBe(first);
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('throws and logs when bus library directory cannot be read', async () => {
    readDirectoryMock.mockRejectedValue(new Error('not found'));
    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    await expect(service.loadDefaultLibrary()).rejects.toThrow(
      `Default bus library directory not found at ${MOCK_DIR}: not found`
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Default bus library directory not found in extension resources'
    );
  });

  it('throws and logs when a yml file cannot be read', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock.mockRejectedValue(new Error('permission denied'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    await expect(service.loadDefaultLibrary()).rejects.toThrow(
      `Failed to read bus definition from ${MOCK_DIR}/axi4_lite.yml: permission denied`
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to read bus definition file: axi4_lite.yml');
  });

  it('throws and logs when YAML parse fails', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock.mockResolvedValue(Buffer.from('{ invalid: [', 'utf8'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    await expect(service.loadDefaultLibrary()).rejects.toThrow(
      `Failed to parse bus definition from ${MOCK_DIR}/axi4_lite.yml`
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to parse bus definition file: axi4_lite.yml');
  });

  it('clears cache and reloads on next request', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock
      .mockResolvedValueOnce(Buffer.from(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR')))
      .mockResolvedValueOnce(Buffer.from(completeDefinition('AXI4_LITE', 'axi4lite', 'ARADDR')));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);
    const first = await service.loadDefaultLibrary();
    service.clearCache();
    const second = await service.loadDefaultLibrary();

    expect(first.definitions.AXI4_LITE.ports[0].name).toBe('AWADDR');
    expect(second.definitions.AXI4_LITE.ports[0].name).toBe('ARADDR');
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('ignores non-yml files and subdirectories', async () => {
    readDirectoryMock.mockResolvedValue([
      ['axi4_lite.yml', vscode.FileType.File],
      ['README.md', vscode.FileType.File],
      ['subdir', vscode.FileType.Directory],
    ]);
    readFileMock.mockResolvedValue(
      Buffer.from(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR'))
    );

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);
    const result = await service.loadDefaultLibrary();

    expect(Object.keys(result.definitions)).toEqual(['AXI4_LITE']);
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      `Loaded default bus library from ${MOCK_DIR} (1 files)`
    );
  });
});

describe('BusLibraryService normalized contract loading', () => {
  let logger: Pick<Logger, 'info' | 'warn' | 'error'>;

  beforeEach(() => {
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    mockReaddir.mockReset();
    mockFsReadFile.mockReset();
  });

  it('accepts the source provenance emitted by the Vivado interface scanner', () => {
    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);
    const { key, record } = vivadoInterfaceToBusDefEntry(
      {
        busType: {
          vendor: 'xilinx.com',
          library: 'interface',
          name: 'fifo_write',
          version: '1.0',
        },
        ports: [{ name: 'WR_EN', direction: 'out', width: 1 }],
      },
      'vivado'
    );

    const loaded = service.loadRecord({ [key]: record }, '/vivado/fifo_write.yml', 'configured');

    expect(loaded.diagnostics).toEqual([]);
    expect(loaded.sources).toHaveLength(1);
  });

  it('throws when a bundled definition violates the packaged schema', async () => {
    const readDirectory = jest.fn().mockResolvedValue([['bad.yml', vscode.FileType.File]]);
    const readFile = jest.fn().mockResolvedValue(Buffer.from('BAD: { ports: [] }'));
    (vscode.workspace as unknown as { fs: { readFile: jest.Mock; readDirectory: jest.Mock } }).fs =
      {
        readFile,
        readDirectory,
      };

    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    await expect(service.loadDefaultLibrary()).rejects.toThrow(
      /\/ext\/dist\/resources\/bus_definitions\/bad\.yml/
    );
  });

  it('excludes malformed configured definitions and records their source path', async () => {
    mockReaddir.mockResolvedValue([dirent('bad.yml', 'file')]);
    mockFsReadFile.mockResolvedValue('BAD: { ports: [] }');
    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    const loaded = await service.loadFromDirectories(['/workspace/buses'], 'workspace');
    const result = service.normalizeSources(loaded);

    expect(result.definitions).toEqual({});
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'BUS_DEF_SCHEMA_INVALID',
        sourceFile: '/workspace/buses/bad.yml',
      }),
    ]);
  });

  it('keeps unknown workspace roles as control ports with a warning', async () => {
    mockReaddir.mockResolvedValue([dirent('custom.yml', 'file')]);
    mockFsReadFile.mockResolvedValue(
      completeDefinition('CUSTOM', 'custom', 'payload', 'vendorSpecific')
    );
    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    const loaded = await service.loadFromDirectories(['/workspace/buses'], 'workspace');
    const result = service.normalizeSources(loaded);

    expect(result.definitions.CUSTOM.ports[0].role).toBe('control');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'BUS_DEF_UNKNOWN_PORT_ROLE',
        severity: 'warning',
        sourceFile: '/workspace/buses/custom.yml',
      }),
    ]);
  });

  it('lets later sources replace an earlier exact key and canonical VLNV', () => {
    const definitions = (text: string) => yaml.load(text) as BusDefinitionSource['definitions'];
    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);
    const sources: BusDefinitionSource[] = [
      {
        sourceFile: '/builtin/first.yml',
        sourceKind: 'builtin',
        definitions: definitions(completeDefinition('FIRST', 'shared', 'old')),
      },
      {
        sourceFile: '/workspace/second.yml',
        sourceKind: 'workspace',
        definitions: definitions(completeDefinition('SECOND', 'shared', 'new')),
      },
    ];

    const result = service.normalizeSources({ sources, diagnostics: [] });

    expect(Object.keys(result.definitions)).toEqual(['SECOND']);
    expect(result.definitions.SECOND.ports[0].name).toBe('new');
  });

  it('keeps a valid lower-precedence definition when an override is semantically invalid', () => {
    const definitions = (text: string) => yaml.load(text) as BusDefinitionSource['definitions'];
    const builtin = definitions(completeDefinition('SHARED', 'shared', 'builtin'));
    const invalid = definitions(completeDefinition('SHARED', 'shared', 'override'));
    const entry = invalid.SHARED;
    entry.contract!.interfaceProperties = {
      first: { type: 'integer', derive: { operation: 'ceilLog2', property: 'second' } },
      second: { type: 'integer', derive: { operation: 'ceilLog2', property: 'first' } },
    };
    const service = new BusLibraryService(logger as Logger, MOCK_DIR, SCHEMA_PATH);

    const result = service.normalizeSources({
      sources: [
        { sourceFile: '/builtin/shared.yml', sourceKind: 'builtin', definitions: builtin },
        { sourceFile: '/workspace/shared.yml', sourceKind: 'workspace', definitions: invalid },
      ],
      diagnostics: [],
    });

    expect(result.definitions.SHARED.ports[0].name).toBe('builtin');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_DERIVATION_CYCLE',
        sourceFile: '/workspace/shared.yml',
      })
    );
  });
});

describe('BusLibraryService.scanDirectory (via user paths)', () => {
  let logger: Pick<Logger, 'info' | 'warn'>;
  const USER_DIR = '/home/user/.config/ipcraft/vivado/bus_definitions';

  beforeEach(() => {
    logger = { info: jest.fn(), warn: jest.fn() };
    mockReaddir.mockReset();
    mockFsReadFile.mockReset();
  });

  it('reads and merges bus definition files via fs.promises (no VS Code IPC)', async () => {
    mockReaddir.mockResolvedValue([dirent('axi.yml', 'file'), dirent('avalon.yaml', 'file')]);
    mockFsReadFile
      .mockResolvedValueOnce(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR'))
      .mockResolvedValueOnce(completeDefinition('AVALON_MM', 'avalon_mm', 'address'));

    const service = new BusLibraryService(logger as Logger, '/ext/dist', SCHEMA_PATH);
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result.sources.map((source) => source.sourceFile)).toEqual([
      `${USER_DIR}/axi.yml`,
      `${USER_DIR}/avalon.yaml`,
    ]);
    expect(result.diagnostics).toEqual([]);
    expect(mockReaddir).toHaveBeenCalledWith(USER_DIR, { withFileTypes: true });
    expect(mockFsReadFile).toHaveBeenCalledWith(`${USER_DIR}/axi.yml`, 'utf8');
    expect(mockFsReadFile).toHaveBeenCalledWith(`${USER_DIR}/avalon.yaml`, 'utf8');
  });

  it('recurses into subdirectories and skips .ip.yml/.mm.yml and non-busdef files', async () => {
    mockReaddir.mockImplementation(async (dir: string) => {
      if (dir === USER_DIR) {
        return [
          dirent('nested', 'dir'),
          dirent('top.yml', 'file'),
          dirent('core.ip.yml', 'file'),
          dirent('map.mm.yml', 'file'),
          dirent('notes.txt', 'file'),
        ];
      }
      if (dir === `${USER_DIR}/nested`) {
        return [dirent('deep.yml', 'file')];
      }
      return [];
    });
    mockFsReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === `${USER_DIR}/nested/deep.yml`) {
        return completeDefinition('DEEP_BUS', 'deep', 'clk');
      }
      if (filePath === `${USER_DIR}/top.yml`) {
        // Not a bus definition record — must be ignored, not merged.
        return 'someScalar: 42';
      }
      throw new Error(`unexpected read of ${filePath}`);
    });

    const service = new BusLibraryService(logger as Logger, '/ext/dist', SCHEMA_PATH);
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].definitions.DEEP_BUS.ports[0].name).toBe('clk');
    // .ip.yml, .mm.yml and .txt are never read.
    expect(mockFsReadFile).not.toHaveBeenCalledWith(`${USER_DIR}/core.ip.yml`, 'utf8');
    expect(mockFsReadFile).not.toHaveBeenCalledWith(`${USER_DIR}/map.mm.yml`, 'utf8');
    expect(mockFsReadFile).not.toHaveBeenCalledWith(`${USER_DIR}/notes.txt`, 'utf8');
  });

  it('warns and returns empty when the directory cannot be read', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));

    const service = new BusLibraryService(logger as Logger, '/ext/dist', SCHEMA_PATH);
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result).toEqual({ sources: [], diagnostics: [] });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Could not read bus library directory '${USER_DIR}'`)
    );
  });

  it('skips a single unreadable file and warns rather than throwing', async () => {
    mockReaddir.mockResolvedValue([dirent('good.yml', 'file'), dirent('bad.yml', 'file')]);
    mockFsReadFile.mockImplementation(async (filePath: string) => {
      if (filePath === `${USER_DIR}/bad.yml`) {
        throw new Error('permission denied');
      }
      return completeDefinition('GOOD_BUS', 'good', 'valid');
    });

    const service = new BusLibraryService(logger as Logger, '/ext/dist', SCHEMA_PATH);
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].definitions.GOOD_BUS.ports[0].name).toBe('valid');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ sourceFile: `${USER_DIR}/bad.yml` }),
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Skipping bus definition file '${USER_DIR}/bad.yml'`)
    );
  });

  it('caches the user library and does not re-scan on the second call', async () => {
    mockReaddir.mockResolvedValue([dirent('axi.yml', 'file')]);
    mockFsReadFile.mockResolvedValue(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR'));

    const service = new BusLibraryService(logger as Logger, '/ext/dist', SCHEMA_PATH);
    const first = await service.loadFromUserPaths([USER_DIR]);
    const second = await service.loadFromUserPaths([USER_DIR]);

    expect(second).toBe(first);
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it('loadFromDirectories does not use the user-library cache', async () => {
    mockReaddir.mockResolvedValue([dirent('axi.yml', 'file')]);
    mockFsReadFile.mockResolvedValue(completeDefinition('AXI4_LITE', 'axi4lite', 'AWADDR'));

    const service = new BusLibraryService(logger as Logger, '/ext/dist', SCHEMA_PATH);
    await service.loadFromDirectories([USER_DIR]);
    await service.loadFromDirectories([USER_DIR]);

    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });
});
