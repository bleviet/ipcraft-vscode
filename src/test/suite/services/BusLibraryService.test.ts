import * as vscode from 'vscode';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { Logger } from '../../../utils/Logger';

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
