import * as vscode from 'vscode';
import { ImportResolver } from '../../../services/ImportResolver';
import { Logger } from '../../../utils/Logger';

type LoggerMock = Pick<Logger, 'info' | 'warn' | 'error'>;

describe('ImportResolver', () => {
  let logger: LoggerMock;
  let readFileMock: jest.Mock;
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
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

  it('loads default bus library when useBusLibrary is not provided', async () => {
    const resolver = new ImportResolver(logger as Logger, context);
    (
      resolver as unknown as { busLibraryService: { loadDefaultLibrary: jest.Mock } }
    ).busLibraryService.loadDefaultLibrary = jest
      .fn()
      .mockResolvedValue({ axi4: { ports: ['awaddr'] } });

    const result = await resolver.resolveImports({}, '/project');

    expect(result.busLibrary).toEqual({ axi4: { ports: ['awaddr'] } });
    expect(result.memoryMaps).toBeUndefined();
    expect(result.fileSets).toBeUndefined();
  });

  it('falls back to default bus library when explicit bus library fails', async () => {
    const resolver = new ImportResolver(logger as Logger, context);
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
    const resolver = new ImportResolver(logger as Logger, context);

    readFileMock
      .mockResolvedValueOnce(Buffer.from('- name: map0\n  baseAddress: 0x0\n', 'utf8'))
      .mockResolvedValueOnce(Buffer.from('name: map1\nbaseAddress: 0x1000\n', 'utf8'));

    const fromArray = await resolver.resolveMemoryMapImport('array.mm.yml', '/project');
    const fromObject = await resolver.resolveMemoryMapImport('single.mm.yml', '/project');

    expect(fromArray).toEqual([{ name: 'map0', baseAddress: 0 }]);
    expect(fromObject).toEqual([{ name: 'map1', baseAddress: 4096 }]);
  });

  it('resolves file set imports and keeps non-import entries while continuing on failures', async () => {
    const resolver = new ImportResolver(logger as Logger, context);

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

    const result = await resolver.resolveFileSetImports(fileSets, '/project');

    expect(result).toEqual([
      { name: 'RTL', files: [{ path: 'rtl/a.vhd' }] },
      { name: 'SIM', files: [{ path: 'sim/tb.vhd' }] },
      { name: 'Local', files: [{ path: 'local/top.vhd' }] },
    ]);
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to resolve file set import: missing.fileset.yml',
      expect.any(Error)
    );
  });

  it('caches resolved bus library by absolute path and reloads after clearCache', async () => {
    const resolver = new ImportResolver(logger as Logger, context);
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
