import * as vscode from 'vscode';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { Logger } from '../../../utils/Logger';

type LoggerMock = Pick<Logger, 'info' | 'error'>;

describe('BusLibraryService', () => {
  let logger: LoggerMock;
  let readFileMock: jest.Mock;
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    readFileMock = jest.fn();
    (vscode.workspace as unknown as { fs: { readFile: jest.Mock } }).fs = {
      readFile: readFileMock,
    };
    (vscode.Uri.file as jest.Mock).mockImplementation((filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }));

    context = {
      extensionPath: '/ext',
    } as vscode.ExtensionContext;
  });

  it('loads default library and caches the result', async () => {
    readFileMock.mockResolvedValue(Buffer.from('axi4: { ports: [awaddr] }', 'utf8'));
    const service = new BusLibraryService(logger as Logger, context);

    const first = await service.loadDefaultLibrary();
    const second = await service.loadDefaultLibrary();

    expect(first).toEqual({ axi4: { ports: ['awaddr'] } });
    expect(second).toBe(first);
    expect(readFileMock).toHaveBeenCalledTimes(1);
    expect(vscode.Uri.file).toHaveBeenCalledWith('/ext/dist/resources/bus_definitions.yml');
    expect(logger.info).toHaveBeenCalledWith(
      'Loaded default bus library from /ext/dist/resources/bus_definitions.yml'
    );
  });

  it('returns empty object and logs when library file cannot be read', async () => {
    readFileMock.mockRejectedValue(new Error('not found'));
    const service = new BusLibraryService(logger as Logger, context);

    const result = await service.loadDefaultLibrary();

    expect(result).toEqual({});
    expect(logger.error).toHaveBeenCalledWith(
      'Default bus library not found in extension resources'
    );
  });

  it('returns empty object and logs when YAML parse fails', async () => {
    readFileMock.mockResolvedValue(Buffer.from('{ invalid: [', 'utf8'));
    const service = new BusLibraryService(logger as Logger, context);

    const result = await service.loadDefaultLibrary();

    expect(result).toEqual({});
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to parse default bus library from /ext/dist/resources/bus_definitions.yml',
      expect.any(Error)
    );
  });

  it('clears cache and reloads on next request', async () => {
    readFileMock
      .mockResolvedValueOnce(Buffer.from('axi4: { ports: [awaddr] }', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('wishbone: { ports: [adr] }', 'utf8'));

    const service = new BusLibraryService(logger as Logger, context);

    const first = await service.loadDefaultLibrary();
    service.clearCache();
    const second = await service.loadDefaultLibrary();

    expect(first).toEqual({ axi4: { ports: ['awaddr'] } });
    expect(second).toEqual({ wishbone: { ports: ['adr'] } });
    expect(readFileMock).toHaveBeenCalledTimes(2);
  });
});
