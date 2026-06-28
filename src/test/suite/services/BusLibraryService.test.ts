import * as vscode from 'vscode';
import * as fsPromises from 'fs/promises';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { Logger } from '../../../utils/Logger';

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
      .mockResolvedValueOnce(Buffer.from('AXI4_LITE: { ports: [AWADDR] }', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('AVALON_MEMORY_MAPPED: { ports: [address] }', 'utf8'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR);
    const result = await service.loadDefaultLibrary();

    expect(result).toEqual({
      AXI4_LITE: { ports: ['AWADDR'] },
      AVALON_MEMORY_MAPPED: { ports: ['address'] },
    });
    expect(vscode.Uri.file).toHaveBeenCalledWith(MOCK_DIR);
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(
      `Loaded default bus library from ${MOCK_DIR} (2 files)`
    );
  });

  it('caches the result and reads directory only once', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock.mockResolvedValue(Buffer.from('AXI4_LITE: { ports: [AWADDR] }', 'utf8'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR);
    const first = await service.loadDefaultLibrary();
    const second = await service.loadDefaultLibrary();

    expect(second).toBe(first);
    expect(readDirectoryMock).toHaveBeenCalledTimes(1);
    expect(readFileMock).toHaveBeenCalledTimes(1);
  });

  it('throws and logs when bus library directory cannot be read', async () => {
    readDirectoryMock.mockRejectedValue(new Error('not found'));
    const service = new BusLibraryService(logger as Logger, MOCK_DIR);

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

    const service = new BusLibraryService(logger as Logger, MOCK_DIR);

    await expect(service.loadDefaultLibrary()).rejects.toThrow(
      `Failed to read bus definition from ${MOCK_DIR}/axi4_lite.yml: permission denied`
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to read bus definition file: axi4_lite.yml');
  });

  it('throws and logs when YAML parse fails', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock.mockResolvedValue(Buffer.from('{ invalid: [', 'utf8'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR);

    await expect(service.loadDefaultLibrary()).rejects.toThrow(
      `Failed to parse bus definition from ${MOCK_DIR}/axi4_lite.yml`
    );
    expect(logger.error).toHaveBeenCalledWith('Failed to parse bus definition file: axi4_lite.yml');
  });

  it('clears cache and reloads on next request', async () => {
    readDirectoryMock.mockResolvedValue([['axi4_lite.yml', vscode.FileType.File]]);
    readFileMock
      .mockResolvedValueOnce(Buffer.from('AXI4_LITE: { ports: [AWADDR] }', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('AXI4_LITE: { ports: [AWADDR, ARADDR] }', 'utf8'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR);
    const first = await service.loadDefaultLibrary();
    service.clearCache();
    const second = await service.loadDefaultLibrary();

    expect(first).toEqual({ AXI4_LITE: { ports: ['AWADDR'] } });
    expect(second).toEqual({ AXI4_LITE: { ports: ['AWADDR', 'ARADDR'] } });
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });

  it('ignores non-yml files and subdirectories', async () => {
    readDirectoryMock.mockResolvedValue([
      ['axi4_lite.yml', vscode.FileType.File],
      ['README.md', vscode.FileType.File],
      ['subdir', vscode.FileType.Directory],
    ]);
    readFileMock.mockResolvedValue(Buffer.from('AXI4_LITE: { ports: [AWADDR] }', 'utf8'));

    const service = new BusLibraryService(logger as Logger, MOCK_DIR);
    const result = await service.loadDefaultLibrary();

    expect(result).toEqual({ AXI4_LITE: { ports: ['AWADDR'] } });
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      `Loaded default bus library from ${MOCK_DIR} (1 files)`
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
      .mockResolvedValueOnce('AXI4_LITE: { ports: [AWADDR] }')
      .mockResolvedValueOnce('AVALON_MM: { ports: [address] }');

    const service = new BusLibraryService(logger as Logger, '/ext/dist');
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result).toEqual({
      AXI4_LITE: { ports: ['AWADDR'] },
      AVALON_MM: { ports: ['address'] },
    });
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
        return 'DEEP_BUS: { ports: [clk] }';
      }
      if (filePath === `${USER_DIR}/top.yml`) {
        // Not a bus definition record — must be ignored, not merged.
        return 'someScalar: 42';
      }
      throw new Error(`unexpected read of ${filePath}`);
    });

    const service = new BusLibraryService(logger as Logger, '/ext/dist');
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result).toEqual({ DEEP_BUS: { ports: ['clk'] } });
    // .ip.yml, .mm.yml and .txt are never read.
    expect(mockFsReadFile).not.toHaveBeenCalledWith(`${USER_DIR}/core.ip.yml`, 'utf8');
    expect(mockFsReadFile).not.toHaveBeenCalledWith(`${USER_DIR}/map.mm.yml`, 'utf8');
    expect(mockFsReadFile).not.toHaveBeenCalledWith(`${USER_DIR}/notes.txt`, 'utf8');
  });

  it('warns and returns empty when the directory cannot be read', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'));

    const service = new BusLibraryService(logger as Logger, '/ext/dist');
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result).toEqual({});
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
      return 'GOOD_BUS: { ports: [valid] }';
    });

    const service = new BusLibraryService(logger as Logger, '/ext/dist');
    const result = await service.loadFromUserPaths([USER_DIR]);

    expect(result).toEqual({ GOOD_BUS: { ports: ['valid'] } });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Skipping bus definition file '${USER_DIR}/bad.yml'`)
    );
  });

  it('caches the user library and does not re-scan on the second call', async () => {
    mockReaddir.mockResolvedValue([dirent('axi.yml', 'file')]);
    mockFsReadFile.mockResolvedValue('AXI4_LITE: { ports: [AWADDR] }');

    const service = new BusLibraryService(logger as Logger, '/ext/dist');
    const first = await service.loadFromUserPaths([USER_DIR]);
    const second = await service.loadFromUserPaths([USER_DIR]);

    expect(second).toBe(first);
    expect(mockReaddir).toHaveBeenCalledTimes(1);
  });

  it('loadFromDirectories does not use the user-library cache', async () => {
    mockReaddir.mockResolvedValue([dirent('axi.yml', 'file')]);
    mockFsReadFile.mockResolvedValue('AXI4_LITE: { ports: [AWADDR] }');

    const service = new BusLibraryService(logger as Logger, '/ext/dist');
    await service.loadFromDirectories([USER_DIR]);
    await service.loadFromDirectories([USER_DIR]);

    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });
});
