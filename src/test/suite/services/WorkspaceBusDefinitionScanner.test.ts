import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// The scanner now reads/stats real files via Node's `fs` (for the persistent
// scan-cache key and the XML head-byte probe), so fixtures live on real disk
// in a temp directory rather than behind fake `fsPath` strings. The
// persistent cache itself is redirected to a temp "config dir" the same way
// VivadoInterfaceScanner.test.ts redirects getIpcraftConfigDir().
const FAKE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-config-test-'));
jest.mock('../../../utils/configDir', () => ({
  getIpcraftConfigDir: () => FAKE_CONFIG_DIR,
}));

import { WorkspaceBusDefinitionScanner } from '../../../services/WorkspaceBusDefinitionScanner';
import * as VivadoInterfaceXmlParser from '../../../parser/VivadoInterfaceXmlParser';

/**
 * The scanner uses vscode.workspace.findFiles + vscode.workspace.fs.readFile
 * for actual file reads, which the shared __mocks__/vscode.ts does not stub.
 * We install per-test mocks here, mirroring the pattern in
 * ImportResolver.test.ts / BusLibraryService.test.ts — but unlike before,
 * `findFiles` now returns URIs pointing at real files written to `workspaceDir`
 * (a fresh temp directory per test) so the scanner's `fs.promises.stat` /
 * head-byte-read calls succeed exactly as they would in production.
 *
 * `findFilesResult` is keyed by the glob pattern: the YAML scan
 * (`**\/*.busdef.yml`) and XML scan (`**\/*.xml`) each see only their own
 * candidates, mirroring how `vscode.workspace.findFiles` would.
 */
function mockWorkspace(yamlPaths: string[], xmlPaths: string[] = []): void {
  const findFilesMock = jest.fn().mockImplementation((pattern: { pattern: string }) => {
    const paths = pattern.pattern.endsWith('.xml') ? xmlPaths : yamlPaths;
    return Promise.resolve(paths.map((p) => ({ fsPath: p, toString: () => p })));
  });
  (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles = findFilesMock;
  (vscode.workspace as unknown as { fs: { readFile: jest.Mock } }).fs = {
    readFile: jest
      .fn()
      .mockImplementation((uri: { fsPath: string }) => fs.promises.readFile(uri.fsPath)),
  };
  (vscode as unknown as { RelativePattern: unknown }).RelativePattern = class {
    pattern: string;
    constructor(_base: unknown, pattern: string) {
      this.pattern = pattern;
    }
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

// IP-XACT fixtures mirroring VivadoInterfaceScanner.test.ts — a user-authored
// custom interface packaged by Vivado's IP Packager as a busDefinition.xml +
// abstractionDefinition.xml pair in the same directory.
const SPIRIT_HEADER = 'xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009"';

const MY_CUSTOM_BUSDEF_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:busDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>my_custom</spirit:name>
  <spirit:version>1.0</spirit:version>
</spirit:busDefinition>`;

const MY_CUSTOM_ABSTRACTION_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:abstractionDefinition ${SPIRIT_HEADER}>
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>interface</spirit:library>
  <spirit:name>my_custom_rtl</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:busType spirit:vendor="acme.com" spirit:library="interface" spirit:name="my_custom" spirit:version="1.0"/>
  <spirit:ports>
    <spirit:port>
      <spirit:logicalName>DATA</spirit:logicalName>
      <spirit:wire>
        <spirit:onMaster>
          <spirit:presence>required</spirit:presence>
          <spirit:width>8</spirit:width>
          <spirit:direction>out</spirit:direction>
        </spirit:onMaster>
      </spirit:wire>
    </spirit:port>
  </spirit:ports>
</spirit:abstractionDefinition>`;

// A plain, non-IP-XACT XML file — must never reach the DOM parser.
const NOT_IPXACT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<project>
  <name>some-vendor-build-output</name>
</project>`;

describe('WorkspaceBusDefinitionScanner', () => {
  let scanner: WorkspaceBusDefinitionScanner;
  let workspaceDir: string;

  beforeEach(() => {
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-workspace-test-'));
    scanner = new WorkspaceBusDefinitionScanner();
    (vscode.Uri.file as jest.Mock).mockImplementation((filePath: string) => ({
      fsPath: filePath,
      toString: () => filePath,
    }));
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = [
      { uri: { fsPath: workspaceDir } },
    ];
    // jest.config's resetMocks wipes the default getConfiguration() implementation
    // between tests; buildExcludeGlob() reads files.exclude/search.exclude, so it
    // needs a stub here (returning the default value, i.e. no configured excludes).
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
  });

  afterEach(() => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(path.join(FAKE_CONFIG_DIR, 'bus_definitions'), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(FAKE_CONFIG_DIR, { recursive: true, force: true });
  });

  /** Writes `content` to `relativePath` under the test's workspace temp dir and returns the absolute path. */
  function writeWorkspaceFile(relativePath: string, content: string): string {
    const absPath = path.join(workspaceDir, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
    return absPath;
  }

  it('returns an empty result when no workspace folders are open', async () => {
    (vscode.workspace as { workspaceFolders?: unknown }).workspaceFolders = undefined;
    mockWorkspace([]);

    const result = await scanner.scan();
    expect(result.count).toBe(0);
    expect(result.files).toEqual([]);
    expect(result.library).toEqual({});
  });

  it('discovers .busdef.yml files and tags them with source: workspace', async () => {
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    const customPath = writeWorkspaceFile('buses/custom.busdef.yml', CUSTOM_BUS_YML);
    mockWorkspace([axi4Path, customPath]);

    const result = await scanner.scan();

    expect(result.count).toBe(2);
    expect(result.files).toHaveLength(2);
    expect(result.library.AXI4_LITE).toBeDefined();
    expect((result.library.AXI4_LITE as Record<string, unknown>).source).toBe('workspace');
    expect(result.library.MY_CUSTOM_BUS).toBeDefined();
    expect((result.library.MY_CUSTOM_BUS as Record<string, unknown>).source).toBe('workspace');
  });

  it('only matches the .busdef.yml glob — plain .yml/.ip.yml/.mm.yml never become candidates', async () => {
    // The glob itself excludes these; findFiles only returns what matches
    // `**/*.busdef.yml`, so this asserts the scanner doesn't read anything
    // beyond what the (mocked) findFiles result provides.
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([axi4Path]);

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].uri.fsPath).toBe(axi4Path);
  });

  it('skips YAML files that do not look like bus definitions', async () => {
    const configPath = writeWorkspaceFile('config.busdef.yml', NOT_A_BUS_DEF_YML);
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([configPath, axi4Path]);

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].busTypes).toEqual(['AXI4_LITE']);
  });

  it('caches the result and does not re-scan on subsequent calls', async () => {
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([axi4Path]);

    const first = await scanner.scan();
    const second = await scanner.scan();

    expect(second.count).toBe(first.count);
    expect(second.library).toBe(first.library);
    // One findFiles call per format (YAML, XML) on the single uncached scan;
    // the cached second scan() call makes none.
    expect(
      (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles
    ).toHaveBeenCalledTimes(2);
  });

  it('force=true re-scans even when cached', async () => {
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([axi4Path]);

    await scanner.scan();
    fs.writeFileSync(axi4Path, CUSTOM_BUS_YML, 'utf8');
    const result = await scanner.scan(true);

    expect(result.count).toBe(1);
    expect(result.library.MY_CUSTOM_BUS).toBeDefined();
    expect(result.library.AXI4_LITE).toBeUndefined();
  });

  it('clearCache invalidates the cache so the next scan re-reads files', async () => {
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([axi4Path]);

    await scanner.scan();
    scanner.clearCache();
    fs.writeFileSync(axi4Path, CUSTOM_BUS_YML, 'utf8');
    const result = await scanner.scan();

    expect(result.library.MY_CUSTOM_BUS).toBeDefined();
  });

  it('continues scanning when a file cannot be read or parsed', async () => {
    // A candidate path that findFiles "found" but doesn't actually exist on
    // disk — fs.promises.stat fails, the scanner must log and move on.
    const brokenPath = path.join(workspaceDir, 'buses', 'broken.busdef.yml');
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([brokenPath, axi4Path]);

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].busTypes).toEqual(['AXI4_LITE']);
  });

  it('fires onDidScan only after a forced re-scan, not on cache-miss scans', async () => {
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    mockWorkspace([axi4Path]);

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

  it('discovers an IP-XACT busDefinition/abstractionDefinition XML pair and tags it source: workspace', async () => {
    const busDefPath = writeWorkspaceFile('busdef/my_custom.xml', MY_CUSTOM_BUSDEF_XML);
    const abstractionPath = writeWorkspaceFile(
      'busdef/my_custom_rtl.xml',
      MY_CUSTOM_ABSTRACTION_XML
    );
    mockWorkspace([], [busDefPath, abstractionPath]);

    const result = await scanner.scan();

    expect(result.count).toBe(1);
    expect(result.library.ACME_COM_INTERFACE_MY_CUSTOM_1_0).toBeDefined();
    const record = result.library.ACME_COM_INTERFACE_MY_CUSTOM_1_0 as Record<string, unknown>;
    expect(record.source).toBe('workspace');
    expect(record.ports).toEqual([
      { name: 'DATA', width: 8, direction: 'out', presence: 'required' },
    ]);

    // Both files in the pair are reported, sharing the same resolved busType key.
    expect(result.files).toHaveLength(2);
    expect(result.files.every((f) => f.busTypes.includes('ACME_COM_INTERFACE_MY_CUSTOM_1_0'))).toBe(
      true
    );
  });

  it('ignores an XML file whose abstractionDefinition pair is missing', async () => {
    const busDefPath = writeWorkspaceFile('busdef/my_custom.xml', MY_CUSTOM_BUSDEF_XML);
    mockWorkspace([], [busDefPath]);

    const result = await scanner.scan();

    expect(result.count).toBe(0);
    expect(result.files).toEqual([]);
  });

  it('skips unreadable XML files without aborting the scan', async () => {
    // "Found" by findFiles but does not exist on disk.
    const missingPath = path.join(workspaceDir, 'busdef', 'my_custom.xml');
    const abstractionPath = writeWorkspaceFile(
      'busdef/my_custom_rtl.xml',
      MY_CUSTOM_ABSTRACTION_XML
    );
    mockWorkspace([], [missingPath, abstractionPath]);

    // The busDefinition.xml failed to stat, so the pair can't resolve — no
    // bus type is produced, but the scan completes rather than throwing.
    const result = await scanner.scan();
    expect(result.count).toBe(0);
  });

  it('merges bus definitions discovered from both YAML and XML', async () => {
    const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
    const busDefPath = writeWorkspaceFile('busdef/my_custom.xml', MY_CUSTOM_BUSDEF_XML);
    const abstractionPath = writeWorkspaceFile(
      'busdef/my_custom_rtl.xml',
      MY_CUSTOM_ABSTRACTION_XML
    );
    mockWorkspace([axi4Path], [busDefPath, abstractionPath]);

    const result = await scanner.scan();

    expect(result.count).toBe(2);
    expect(result.library.AXI4_LITE).toBeDefined();
    expect(result.library.ACME_COM_INTERFACE_MY_CUSTOM_1_0).toBeDefined();
    expect(result.files).toHaveLength(3);
  });

  describe('XML content-sniff probe', () => {
    it('never passes a non-IP-XACT .xml file to the DOM parser', async () => {
      const notIpxactPath = writeWorkspaceFile('build/output.xml', NOT_IPXACT_XML);
      mockWorkspace([], [notIpxactPath]);

      const parseSpy = jest.spyOn(VivadoInterfaceXmlParser, 'parseVivadoInterfaceFiles');

      const result = await scanner.scan();

      expect(result.count).toBe(0);
      // The cheap head-byte probe must reject the file before
      // parseVivadoInterfaceFiles (the expensive DOM-parse path) ever runs.
      expect(parseSpy).not.toHaveBeenCalled();

      parseSpy.mockRestore();
    });

    it('still parses a real IP-XACT file even though the probe ran first', async () => {
      const busDefPath = writeWorkspaceFile('busdef/my_custom.xml', MY_CUSTOM_BUSDEF_XML);
      const abstractionPath = writeWorkspaceFile(
        'busdef/my_custom_rtl.xml',
        MY_CUSTOM_ABSTRACTION_XML
      );
      mockWorkspace([], [busDefPath, abstractionPath]);

      const parseSpy = jest.spyOn(VivadoInterfaceXmlParser, 'parseVivadoInterfaceFiles');

      const result = await scanner.scan();

      expect(result.count).toBe(1);
      expect(parseSpy).toHaveBeenCalledTimes(1);

      parseSpy.mockRestore();
    });
  });

  describe('persistent scan cache', () => {
    it('reuses unchanged (mtime, size) files on a second scan without reading them again', async () => {
      const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
      const busDefPath = writeWorkspaceFile('busdef/my_custom.xml', MY_CUSTOM_BUSDEF_XML);
      const abstractionPath = writeWorkspaceFile(
        'busdef/my_custom_rtl.xml',
        MY_CUSTOM_ABSTRACTION_XML
      );
      mockWorkspace([axi4Path], [busDefPath, abstractionPath]);

      const first = await scanner.scan();
      expect(first.count).toBe(2);

      // A brand-new scanner instance simulates a new VS Code window: its
      // in-memory cache starts empty, but the persistent cache on disk
      // (written by the first scanner's scan()) should still be warm.
      const secondScanner = new WorkspaceBusDefinitionScanner();
      const readFileSpy = (vscode.workspace as unknown as { fs: { readFile: jest.Mock } }).fs
        .readFile;
      readFileSpy.mockClear();

      const second = await secondScanner.scan();

      expect(second.count).toBe(2);
      // Every candidate's (mtime, size) matched the persisted cache, so no
      // file content was read at all on the warm pass.
      expect(readFileSpy).not.toHaveBeenCalled();
    });

    it('re-reads a file once its content (and therefore size) changes', async () => {
      const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
      mockWorkspace([axi4Path]);

      await scanner.scan();

      // Change content (and size) so the cached (mtime, size) no longer matches.
      fs.writeFileSync(axi4Path, CUSTOM_BUS_YML, 'utf8');

      const secondScanner = new WorkspaceBusDefinitionScanner();
      const result = await secondScanner.scan();

      expect(result.library.MY_CUSTOM_BUS).toBeDefined();
      expect(result.library.AXI4_LITE).toBeUndefined();
    });

    it('scan(force=true) bypasses the persistent cache and re-reads everything', async () => {
      const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
      mockWorkspace([axi4Path]);

      await scanner.scan();

      const secondScanner = new WorkspaceBusDefinitionScanner();
      const readFileSpy = (vscode.workspace as unknown as { fs: { readFile: jest.Mock } }).fs
        .readFile;
      readFileSpy.mockClear();

      const result = await secondScanner.scan(true);

      expect(result.count).toBe(1);
      // force=true must re-read the file even though (mtime, size) is unchanged.
      expect(readFileSpy).toHaveBeenCalledTimes(1);
    });

    it('drops cache entries for files no longer present in the workspace', async () => {
      const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
      mockWorkspace([axi4Path]);
      await scanner.scan();

      // Simulate the file being deleted: it's no longer returned by findFiles.
      mockWorkspace([]);
      const secondScanner = new WorkspaceBusDefinitionScanner();
      const afterDelete = await secondScanner.scan();
      expect(afterDelete.count).toBe(0);

      // Re-create the same path with the same original content. If the stale
      // cache entry had survived, this would be wrongly served from cache
      // with a mismatched (or matching, masking a real bug) signature; the
      // important behavioral guarantee is that the file is read normally.
      fs.writeFileSync(axi4Path, AXI4_LITE_YML, 'utf8');
      mockWorkspace([axi4Path]);
      const thirdScanner = new WorkspaceBusDefinitionScanner();
      const afterRecreate = await thirdScanner.scan();
      expect(afterRecreate.count).toBe(1);
      expect(afterRecreate.library.AXI4_LITE).toBeDefined();
    });
  });

  describe('peekAndScanInBackground', () => {
    it('returns an empty result immediately without waiting on the workspace walk', async () => {
      // findFiles never resolves during this test, simulating a slow scan of a
      // huge repository — peekAndScanInBackground must not wait on it.
      (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles = jest
        .fn()
        .mockReturnValue(new Promise(() => {}));

      const result = scanner.peekAndScanInBackground();

      expect(result).toEqual({ library: {}, files: [], count: 0 });

      // doScan() awaits the persistent cache load (real fs I/O) before it ever
      // reaches the never-resolving findFiles mock above. Flush that real I/O
      // here so the dangling scan blocks on *this* test's findFiles mock and
      // never resumes mid-way through a later test against a different mock.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    it('kicks off exactly one background scan and fires onDidScan once it resolves', async () => {
      const axi4Path = writeWorkspaceFile('buses/axi4_lite.busdef.yml', AXI4_LITE_YML);
      mockWorkspace([axi4Path]);
      const fired = jest.fn();
      const sub = scanner.onDidScan(fired);

      const first = scanner.peekAndScanInBackground();
      expect(first.count).toBe(0);
      expect(fired).not.toHaveBeenCalled();

      // A second concurrent call must not start a second scan.
      const second = scanner.peekAndScanInBackground();
      expect(second.count).toBe(0);

      // scan() with no in-flight forced scan joins the same in-flight background scan.
      const resolved = await scanner.scan();
      expect(resolved.count).toBe(1);
      expect(fired).toHaveBeenCalledTimes(1);
      // Exactly one findFiles call per format (YAML, XML) — confirms the two
      // peekAndScanInBackground() calls above shared a single background scan.
      expect(
        (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles
      ).toHaveBeenCalledTimes(2);

      // Once resolved, the result is served from cache without any new I/O.
      const third = scanner.peekAndScanInBackground();
      expect(third.count).toBe(1);
      expect(
        (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles
      ).toHaveBeenCalledTimes(2);

      sub.dispose();
    });
  });

  describe('exclude glob', () => {
    it('always prunes known build/cache directories during the walk', async () => {
      mockWorkspace([]);

      await scanner.scan();

      const findFilesMock = (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles;
      const excludeArg = findFilesMock.mock.calls[0][1] as string;
      expect(excludeArg).toContain('node_modules');
      expect(excludeArg).toContain('.runs');
      expect(excludeArg).toContain('.ip_user_files');
    });

    it('also prunes directories configured via files.exclude / search.exclude', async () => {
      mockWorkspace([]);
      (vscode.workspace.getConfiguration as jest.Mock).mockImplementation((section: string) => ({
        get: (_key: string, defaultValue?: unknown) =>
          section === 'files' ? { '**/vendor_blobs': true } : defaultValue,
      }));

      await scanner.scan();

      const findFilesMock = (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles;
      const excludeArg = findFilesMock.mock.calls[0][1] as string;
      expect(excludeArg).toContain('vendor_blobs');
    });

    it('caps each glob at the candidate limit and passes it to findFiles', async () => {
      mockWorkspace([]);

      await scanner.scan();

      const findFilesMock = (vscode.workspace as unknown as { findFiles: jest.Mock }).findFiles;
      expect(findFilesMock.mock.calls[0][2]).toBe(5000);
    });
  });
});
