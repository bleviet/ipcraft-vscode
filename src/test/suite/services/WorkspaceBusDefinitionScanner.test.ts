import * as vscode from 'vscode';
import { WorkspaceBusDefinitionScanner } from '../../../services/WorkspaceBusDefinitionScanner';

/**
 * The scanner uses vscode.workspace.findFiles + fs.readFile, which the shared
 * __mocks__/vscode.ts does not stub. We install per-test mocks here, mirroring
 * the pattern in ImportResolver.test.ts / BusLibraryService.test.ts.
 */
function mockWorkspace(
  findFilesResult: { fsPath: string }[],
  readFileImpl: (uri: { fsPath: string }) => Promise<Buffer>
): void {
  const findFilesMock = jest.fn().mockResolvedValue(findFilesResult);
  (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles = findFilesMock;
  (vscode.workspace as unknown as { fs: { readFile: jest.Mock } }).fs = {
    readFile: jest.fn().mockImplementation((uri: { fsPath: string }) => readFileImpl(uri)),
  };
  (vscode as unknown as { RelativePattern: unknown }).RelativePattern = class {
    constructor(_base: unknown, _pattern: string) {}
  };
}

const AXI4_LITE_YML = `AXI4_LITE:
  busType:
    vendor: ipcraft
    library: busif
    name: axi4_lite
    version: '1.0'
  ports:
    - name: ACLK
      presence: required
    - name: AWADDR
      width: 32
      direction: out
      presence: required
`;

const CUSTOM_BUS_YML = `MY_CUSTOM_BUS:
  busType:
    vendor: acme
    library: busif
    name: my_custom
    version: '2.0'
  ports:
    - name: CLK
      presence: required
    - name: DATA
      width: 8
      direction: out
      presence: required
`;

const NOT_A_BUS_DEF_YML = `someRandomKey:
  description: this is not a bus def
  value: 42
`;

describe('WorkspaceBusDefinitionScanner', () => {
  let scanner: WorkspaceBusDefinitionScanner;

  beforeEach(() => {
    scanner = new WorkspaceBusDefinitionScanner();
    (vscode.Uri.file as jest.Mock).mockImplementation((filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }));
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { fsPath: '/workspace' } },
    ];
  });

  afterEach(() => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
  });

  it('returns an empty result when no workspace folders are open', async () => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    mockWorkspace([], async () => Buffer.from('', 'utf8'));

    const result = await scanner.scan();
    expect(result.count).toBe(0);
    expect(result.files).toEqual([]);
    expect(result.library).toEqual({});
  });

  it('discovers bus definition YAML files and tags them with source: workspace', async () => {
    mockWorkspace(
      [{ fsPath: '/workspace/buses/axi4_lite.yml' }, { fsPath: '/workspace/buses/custom.yml' }],
      async (uri) => {
        if (uri.fsPath.endsWith('axi4_lite.yml')) {
          return Buffer.from(AXI4_LITE_YML, 'utf8');
        }
        if (uri.fsPath.endsWith('custom.yml')) {
          return Buffer.from(CUSTOM_BUS_YML, 'utf8');
        }
        throw new Error('unexpected: ' + uri.fsPath);
      }
    );

    const result = await scanner.scan();

    expect(result.count).toBe(2);
    expect(result.files).toHaveLength(2);
    expect(result.library.AXI4_LITE).toBeDefined();
    expect((result.library.AXI4_LITE as Record<string, unknown>).source).toBe('workspace');
    expect(result.library.MY_CUSTOM_BUS).toBeDefined();
    expect((result.library.MY_CUSTOM_BUS as Record<string, unknown>).source).toBe('workspace');
  });

  it('excludes .ip.yml and .mm.yml files from the scan', async () => {
    mockWorkspace(
      [
        { fsPath: '/workspace/mycore.ip.yml' },
        { fsPath: '/workspace/mymap.mm.yml' },
        { fsPath: '/workspace/buses/axi4_lite.yml' },
      ],
      async (uri) => {
        if (uri.fsPath.endsWith('axi4_lite.yml')) {
          return Buffer.from(AXI4_LITE_YML, 'utf8');
        }
        throw new Error('should not read ip/mm file: ' + uri.fsPath);
      }
    );

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].uri.fsPath).toBe('/workspace/buses/axi4_lite.yml');
  });

  it('skips YAML files that do not look like bus definitions', async () => {
    mockWorkspace(
      [{ fsPath: '/workspace/config.yml' }, { fsPath: '/workspace/buses/axi4_lite.yml' }],
      async (uri) => {
        if (uri.fsPath.endsWith('config.yml')) {
          return Buffer.from(NOT_A_BUS_DEF_YML, 'utf8');
        }
        return Buffer.from(AXI4_LITE_YML, 'utf8');
      }
    );

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].busTypes).toEqual(['AXI4_LITE']);
  });

  it('caches the result and does not re-scan on subsequent calls', async () => {
    mockWorkspace([{ fsPath: '/workspace/buses/axi4_lite.yml' }], async () =>
      Buffer.from(AXI4_LITE_YML, 'utf8')
    );

    const first = await scanner.scan();
    const second = await scanner.scan();

    expect(second.count).toBe(first.count);
    expect(second.library).toBe(first.library);
    expect(
      (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles
    ).toHaveBeenCalledTimes(1);
  });

  it('force=true re-scans even when cached', async () => {
    let fileContent = AXI4_LITE_YML;
    mockWorkspace([{ fsPath: '/workspace/buses/axi4_lite.yml' }], async () =>
      Buffer.from(fileContent, 'utf8')
    );

    await scanner.scan();
    fileContent = CUSTOM_BUS_YML;
    const result = await scanner.scan(true);

    expect(result.count).toBe(1);
    expect(result.library.MY_CUSTOM_BUS).toBeDefined();
    expect(result.library.AXI4_LITE).toBeUndefined();
  });

  it('clearCache invalidates the cache so the next scan re-reads files', async () => {
    let fileContent = AXI4_LITE_YML;
    mockWorkspace([{ fsPath: '/workspace/buses/axi4_lite.yml' }], async () =>
      Buffer.from(fileContent, 'utf8')
    );

    await scanner.scan();
    scanner.clearCache();
    fileContent = CUSTOM_BUS_YML;
    const result = await scanner.scan();

    expect(result.library.MY_CUSTOM_BUS).toBeDefined();
  });

  it('continues scanning when a file cannot be read or parsed', async () => {
    mockWorkspace(
      [{ fsPath: '/workspace/buses/broken.yml' }, { fsPath: '/workspace/buses/axi4_lite.yml' }],
      async (uri) => {
        if (uri.fsPath.endsWith('broken.yml')) {
          throw new Error('read error');
        }
        return Buffer.from(AXI4_LITE_YML, 'utf8');
      }
    );

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].busTypes).toEqual(['AXI4_LITE']);
  });

  it('fires onDidScan only after a forced re-scan, not on cache-miss scans', async () => {
    mockWorkspace([{ fsPath: '/workspace/buses/axi4_lite.yml' }], async () =>
      Buffer.from(AXI4_LITE_YML, 'utf8')
    );

    const fired = jest.fn();
    const sub = scanner.onDidScan(fired);

    // First (cache-miss) scan does NOT fire — ImportResolver calls scan() on
    // every webview update, so firing here would cause an infinite refresh loop.
    await scanner.scan();
    expect(fired).not.toHaveBeenCalled();

    // Cached calls also do NOT fire.
    await scanner.scan();
    expect(fired).not.toHaveBeenCalled();

    // Only an explicit forced re-scan fires the event.
    await scanner.scan(true);
    expect(fired).toHaveBeenCalledTimes(1);

    sub.dispose();
  });
});
