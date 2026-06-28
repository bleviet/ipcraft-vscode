import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { isBusDefRecord } from './BusLibraryService';
import { vivadoInterfaceToBusDefEntry } from './VivadoInterfaceScanner';
import { parseVivadoInterfaceFiles } from '../parser/VivadoInterfaceXmlParser';
import { BusDefScanCache, BusDefScanCacheEntry } from './BusDefScanCache';
import { mapWithConcurrency } from '../utils/concurrency';
import { Logger } from '../utils/Logger';

const logger = new Logger('WorkspaceBusDefinitionScanner');

// Hard safety valve for pathological workspaces — bounds both the findFiles
// walk and the number of files we read+parse per scan.
const MAX_CANDIDATES_PER_GLOB = 5000;

// IP-XACT 1685-2009 namespace — same constant VivadoInterfaceXmlParser.ts
// uses for real parsing. Used here only for a cheap substring probe.
const SPIRIT_NS = 'http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009';

// Only the head of an XML candidate is read for the cheap probe — the root
// element and its namespace declaration are always near the top of the file.
const XML_PROBE_BYTES = 8192;

/**
 * Cheaply tests whether raw XML text looks like an IP-XACT bus/abstraction
 * definition, without parsing anything: a real match contains both a
 * `busDefinition`/`abstractionDefinition` local element name and the
 * 1685-2009 SPIRIT namespace URI. False positives just fall through to the
 * real DOM parser (which returns undefined for them); this only exists to
 * skip the DOM-parse cost for the overwhelming majority of `.xml` files in a
 * typical repository that are not IP-XACT at all.
 */
function looksLikeIpxactBusDef(headText: string): boolean {
  if (!headText.includes(SPIRIT_NS)) {
    return false;
  }
  return headText.includes('busDefinition') || headText.includes('abstractionDefinition');
}

/** Reads up to `XML_PROBE_BYTES` bytes from the start of `filePath` as utf8 text. */
async function readHead(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

// Directories that are never bus definitions but commonly hold huge numbers
// of generated .yml/.xml files (FPGA vendor build/cache output in particular),
// so they're always pruned during the workspace walk regardless of the user's
// own files.exclude/search.exclude configuration.
const DEFAULT_EXCLUDED_DIR_NAMES = [
  'node_modules',
  '.git',
  'dist',
  'out',
  'build',
  '.Xil',
  '.ip_user_files',
  '.runs',
  '.sim',
  '.srcs',
  '.cache',
  '.gen',
  '.metadata',
  '.qsys_edit',
];

/**
 * Builds a single `**\/{dir1,dir2,...}/**` exclude glob combining the
 * hardcoded defaults above with any directory-shaped entries from the user's
 * own `files.exclude`/`search.exclude` settings (verbatim glob patterns we
 * can't safely translate, e.g. ones using `*`/`?`/`[]`, are skipped — this is
 * a cheap win for already-ignored paths, not a general glob translator).
 * Passing this to `findFiles`'s `exclude` parameter lets it prune entire
 * subtrees during the walk, which is far cheaper than enumerating everything
 * and filtering afterwards.
 */
function buildExcludeGlob(): string {
  const dirNames = new Set(DEFAULT_EXCLUDED_DIR_NAMES);
  for (const section of ['files', 'search']) {
    const configured = vscode.workspace
      .getConfiguration(section)
      .get<Record<string, boolean>>('exclude', {});
    for (const [pattern, enabled] of Object.entries(configured)) {
      if (!enabled) {
        continue;
      }
      let name = pattern;
      if (name.startsWith('**/')) {
        name = name.slice(3);
      }
      if (name.endsWith('/**')) {
        name = name.slice(0, -3);
      } else if (name.endsWith('/')) {
        name = name.slice(0, -1);
      }
      if (name.length > 0 && !/[*?{}[\]]/.test(name)) {
        dirNames.add(name);
      }
    }
  }
  return `**/{${Array.from(dirNames).join(',')}}/**`;
}

/**
 * A workspace file (YAML or IP-XACT XML) that contributed one or more bus
 * definitions. `busTypes` lists the resulting library keys; for an XML pair
 * (busDefinition.xml + abstractionDefinition.xml) both files share the same
 * `busTypes` entry since the parser resolves ports only once both are read.
 */
export interface WorkspaceBusDefFile {
  uri: vscode.Uri;
  busTypes: string[];
}

export interface WorkspaceBusDefScanResult {
  /** Merged bus library keyed by uppercase display name, each tagged `source: 'workspace'`. */
  library: Record<string, unknown>;
  /** Per-file provenance for tree display. */
  files: WorkspaceBusDefFile[];
  /** Number of bus definitions discovered. */
  count: number;
}

/** Payload fired by `onDidScan`. */
export interface WorkspaceBusDefScanEvent {
  /**
   * Whether this scan's discovered files/busTypes differ from the previous
   * scan. `false` lets subscribers skip redundant work (e.g.
   * `IpCoreEditorProvider` skips forcing a webview resync) when a scan found
   * nothing new or changed.
   */
  changed: boolean;
}

const EMPTY_RESULT: WorkspaceBusDefScanResult = { library: {}, files: [], count: 0 };

/**
 * Scans workspace folders for standalone bus definition files, tags each
 * discovered definition with `source: 'workspace'`, and feeds the merged
 * library into `ImportResolver.loadDefaultBusLibrary` so workspace-local bus
 * definitions appear as known interfaces in the Inspector — exactly like
 * Vivado-sourced definitions do today. Two file formats are supported:
 *
 * - YAML, same shape as `ipcraft-spec/bus_definitions/*.yml` and
 *   `BusLibraryService.scanDirectory`.
 * - IP-XACT bus/abstraction definition XML, the format Vivado's IP Packager
 *   generates for a user-authored custom bus interface — parsed via
 *   `parseVivadoInterfaceFiles`, the same parser `VivadoInterfaceScanner`
 *   uses for a Vivado install's interface library.
 *
 * Unlike `VivadoInterfaceScanner`, no cache directory is written: the workspace
 * files are read in place and the result is held in an in-memory cache that is
 * invalidated on re-scan or `clearCache()`.
 *
 * Performance: a full workspace walk reads and parses every candidate file's
 * content, which is too slow to run unconditionally on extension activation
 * or on every editor update in a large repository. Automatic-discovery call
 * sites (the Control Center tree, `ImportResolver`) must use
 * `peekAndScanInBackground()`, which never blocks on I/O — it returns
 * whatever has already been discovered and, the first time nothing has been
 * discovered yet, kicks off exactly one background scan and fires
 * `onDidScan` once it completes. Only the explicit "Scan Workspace Bus
 * Definitions" command (and tests) should call the blocking `scan()`.
 *
 * A module-level singleton (`getWorkspaceBusDefinitionScanner`) is shared by
 * `ImportResolver`, `IpCoreTreeDataProvider`, and the
 * `fpga-ip-core.scanWorkspaceBusDefinitions` command so a single scan feeds
 * every consumer.
 */
export class WorkspaceBusDefinitionScanner {
  private readonly _onDidScan = new vscode.EventEmitter<WorkspaceBusDefScanEvent>();
  readonly onDidScan = this._onDidScan.event;

  private cache: { library: Record<string, unknown>; files: WorkspaceBusDefFile[] } | null = null;
  private scanPromise: Promise<WorkspaceBusDefScanResult> | null = null;
  private readonly persistentCache = new BusDefScanCache();
  private lastResultSignature: string | null = null;

  /**
   * Returns whatever has already been discovered, doing no I/O of its own.
   * If no scan has ever completed and none is currently running, kicks off
   * exactly one background scan (deduplicated with any concurrent caller)
   * and fires `onDidScan` once it finishes so callers can refresh — but
   * never makes the caller wait on the workspace walk itself.
   */
  peekAndScanInBackground(): WorkspaceBusDefScanResult {
    if (this.cache) {
      return { ...this.cache, count: Object.keys(this.cache.library).length };
    }
    this.scanPromise ??= this.doScan()
      .then((result) => {
        this.scanPromise = null;
        this._onDidScan.fire({ changed: this.updateResultSignature(result) });
        return result;
      })
      .catch((error) => {
        this.scanPromise = null;
        logger.warn(`Background workspace bus definition scan failed: ${(error as Error).message}`);
        return EMPTY_RESULT;
      });
    return EMPTY_RESULT;
  }

  /**
   * Scans all workspace folders for bus definition files and blocks until
   * done — used by the explicit "Scan Workspace Bus Definitions" command
   * (which shows its own progress UI) and by tests. Pass `force: true` to
   * re-scan even if a result is already cached; this always fires
   * `onDidScan` on completion. Automatic-discovery callers should use
   * `peekAndScanInBackground()` instead.
   */
  async scan(force = false): Promise<WorkspaceBusDefScanResult> {
    if (!force) {
      if (this.cache) {
        return { ...this.cache, count: Object.keys(this.cache.library).length };
      }
      if (this.scanPromise) {
        return this.scanPromise;
      }
    }
    const result = await this.doScan(force);
    if (force) {
      this._onDidScan.fire({ changed: this.updateResultSignature(result) });
    }
    return result;
  }

  /**
   * Compares `result` against the previous scan's signature (sorted file
   * paths + their busTypes) and records the new one. Returns whether the
   * result actually changed, so `onDidScan` subscribers (e.g.
   * `IpCoreEditorProvider`) can skip a forced webview resync when a scan
   * found nothing new — the common case once the persistent cache is warm.
   */
  private updateResultSignature(result: WorkspaceBusDefScanResult): boolean {
    const signature = JSON.stringify(
      result.files.map((f) => [f.uri.fsPath, ...f.busTypes].join('|')).sort()
    );
    const changed = signature !== this.lastResultSignature;
    this.lastResultSignature = signature;
    return changed;
  }

  /**
   * Scans all workspace folders for bus definition files — both standalone
   * YAML (same shape as `ipcraft-spec/bus_definitions/*.yml`) and IP-XACT
   * bus/abstraction definition XML (the format Vivado's IP Packager emits
   * for a custom bus interface).
   *
   * Common generated/dependency directories (`node_modules`, `.git`, `dist`,
   * `out`, `build`, plus known FPGA vendor build/cache directories and
   * anything the user has excluded via `files.exclude`/`search.exclude`) are
   * pruned during the walk via `buildExcludeGlob()`, and each glob is capped
   * at `MAX_CANDIDATES_PER_GLOB` results as a safety valve.
   */
  private async doScan(force = false): Promise<WorkspaceBusDefScanResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.cache = { library: {}, files: [] };
      return { ...this.cache, count: 0 };
    }

    // `force=true` (the explicit "Scan Workspace Bus Definitions" command) is
    // the clean-rescan escape hatch: it bypasses the persistent cache the
    // same way it already bypasses the in-memory cache, by simply never
    // loading it, so every candidate is re-read+re-parsed and the persisted
    // cache is fully overwritten at the end of this scan.
    if (force) {
      this.persistentCache.clear();
    } else {
      await this.persistentCache.load();
    }

    const excludeGlob = buildExcludeGlob();
    const library: Record<string, unknown> = {};
    const files: WorkspaceBusDefFile[] = [];
    const seenPaths = new Set<string>();

    await this.scanYamlFiles(workspaceFolders, excludeGlob, library, files, seenPaths);
    await this.scanXmlFiles(workspaceFolders, excludeGlob, library, files, seenPaths);

    await this.persistentCache.persist(seenPaths);

    this.cache = { library, files };
    const count = Object.keys(library).length;
    logger.info(
      `Workspace bus definition scan complete: ${count} definition(s) from ${files.length} file(s)`
    );
    return { library, files, count };
  }

  /**
   * Scans for standalone bus definition YAML files. Only files named
   * `*.busdef.yml` are considered — this is a hard naming convention (no
   * plain-`.yml` auto-discovery): the glob itself is precise enough that
   * `.ip.yml`/`.mm.yml` specs can never match it, so no post-enumeration
   * basename filter is needed. Candidates are read+parsed with bounded
   * concurrency rather than one at a time, since this is I/O-bound work.
   */
  private async scanYamlFiles(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    excludeGlob: string,
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[],
    seenPaths: Set<string>
  ): Promise<void> {
    const candidateUris: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.busdef.yml');
      const found = await vscode.workspace.findFiles(pattern, excludeGlob, MAX_CANDIDATES_PER_GLOB);
      candidateUris.push(...found);
      if (found.length >= MAX_CANDIDATES_PER_GLOB) {
        logger.warn(
          `Workspace bus definition YAML scan hit the ${MAX_CANDIDATES_PER_GLOB}-file cap in ` +
            `'${folder.uri.fsPath}'; some files may have been skipped.`
        );
      }
    }

    await mapWithConcurrency(candidateUris, 16, async (uri) => {
      seenPaths.add(uri.fsPath);
      try {
        const stat = await fs.promises.stat(uri.fsPath);
        const cached = this.persistentCache.get(uri.fsPath);
        if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
          if (cached.kind === 'busdef' && cached.record) {
            Object.assign(library, cached.record as Record<string, unknown>);
            files.push({ uri, busTypes: cached.busTypes ?? [] });
          }
          return;
        }

        const fileData = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(fileData).toString('utf8');
        const parsed = yaml.load(content);
        if (!isBusDefRecord(parsed)) {
          this.persistentCache.set(uri.fsPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            kind: 'none',
          });
          return;
        }
        const record = parsed;
        const busTypes: string[] = [];
        for (const [key, value] of Object.entries(record)) {
          if (
            value !== null &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            Array.isArray((value as Record<string, unknown>).ports)
          ) {
            // Tag provenance so downstream consumers (e.g. VivadoComponentXmlGenerator)
            // can distinguish workspace-sourced definitions, mirroring `source: 'vivado'`.
            (value as Record<string, unknown>).source = 'workspace';
            busTypes.push(key);
          }
        }
        if (busTypes.length > 0) {
          Object.assign(library, record);
          files.push({ uri, busTypes });
          this.persistentCache.set(uri.fsPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            kind: 'busdef',
            busTypes,
            record,
          });
        } else {
          this.persistentCache.set(uri.fsPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            kind: 'none',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Skipping workspace bus definition file '${uri.fsPath}': ${message}`);
      }
    });
  }

  /**
   * Scans for IP-XACT bus/abstraction definition XML files — the format
   * Vivado's IP Packager generates when a user designs a custom bus
   * interface. A `busDefinition.xml` only carries the interface's VLNV; its
   * matching `abstractionDefinition.xml` (which carries the port list) is
   * conventionally packaged alongside it, so XML candidates are grouped by
   * parent directory and parsed together via `parseVivadoInterfaceFiles`
   * (the same parser `VivadoInterfaceScanner` uses for a Vivado install's
   * interface library), mirroring how the pair lives side-by-side on disk.
   * Directory groups are read+parsed with bounded concurrency.
   *
   * The glob stays `**\/*.xml` (Vivado doesn't use a distinctive filename),
   * so two cheap gates keep the expensive DOM parse proportional to the
   * number of real IP-XACT files rather than every `.xml` in the repo:
   *
   * 1. The persisted per-file `(mtimeMs, size)` cache — unchanged files,
   *    including ones previously found to be `'none'` (not IP-XACT at all),
   *    are skipped entirely, with no read of any kind.
   * 2. For files that are new/changed, a cheap head-byte probe
   *    (`looksLikeIpxactBusDef`) reads only the first ~8KB via Node's `fs`
   *    and substring-matches the SPIRIT namespace + element name before any
   *    full read or DOM parse is attempted.
   *
   * A `setImmediate` yield point between directory-group batches keeps any
   * residual synchronous parsing from monopolizing the event loop in one
   * unbroken chunk.
   */
  private async scanXmlFiles(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    excludeGlob: string,
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[],
    seenPaths: Set<string>
  ): Promise<void> {
    const candidateUris: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.xml');
      const found = await vscode.workspace.findFiles(pattern, excludeGlob, MAX_CANDIDATES_PER_GLOB);
      candidateUris.push(...found);
      if (found.length >= MAX_CANDIDATES_PER_GLOB) {
        logger.warn(
          `Workspace bus definition XML scan hit the ${MAX_CANDIDATES_PER_GLOB}-file cap in ` +
            `'${folder.uri.fsPath}'; some files may have been skipped.`
        );
      }
    }
    if (candidateUris.length === 0) {
      return;
    }
    for (const uri of candidateUris) {
      seenPaths.add(uri.fsPath);
    }

    const byDirectory = new Map<string, vscode.Uri[]>();
    for (const uri of candidateUris) {
      const dir = path.dirname(uri.fsPath);
      const group = byDirectory.get(dir) ?? [];
      group.push(uri);
      byDirectory.set(dir, group);
    }

    const groups = Array.from(byDirectory.values());
    const BATCH_SIZE = 16;
    for (let i = 0; i < groups.length; i += BATCH_SIZE) {
      const batch = groups.slice(i, i + BATCH_SIZE);
      await mapWithConcurrency(batch, BATCH_SIZE, (group) =>
        this.scanXmlDirectoryGroup(group, library, files)
      );
      // Yield between batches so any residual synchronous DOM-parse work
      // can't monopolize the event loop in one unbroken chunk. setImmediate
      // isn't available in every test environment (e.g. jsdom), so fall back
      // to a 0ms macrotask timeout, which yields just as effectively.
      await new Promise((resolve) => {
        if (typeof setImmediate === 'function') {
          setImmediate(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
  }

  /**
   * Resolves the cache/probe/parse pipeline for one parent-directory group
   * of `.xml` candidates, mutating `library`/`files` in place. Stat is taken
   * for every file in the group; if every file has a matching cache entry,
   * the group is resolved entirely from cache (no read, no parse). Otherwise
   * each not-yet-known file is probed via its head bytes, and only files
   * that pass the probe (or are already known-`busdef`) are fully read and
   * handed to `parseVivadoInterfaceFiles`.
   */
  private async scanXmlDirectoryGroup(
    group: vscode.Uri[],
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[]
  ): Promise<void> {
    const stats = new Map<string, { mtimeMs: number; size: number }>();
    for (const uri of group) {
      try {
        stats.set(uri.fsPath, await fs.promises.stat(uri.fsPath));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Skipping workspace bus definition file '${uri.fsPath}': ${message}`);
      }
    }

    const cachedEntries = new Map<string, BusDefScanCacheEntry>();
    let allCached = true;
    for (const uri of group) {
      const stat = stats.get(uri.fsPath);
      const cached = stat ? this.persistentCache.get(uri.fsPath) : undefined;
      if (cached && cached.mtimeMs === stat?.mtimeMs && cached.size === stat.size) {
        cachedEntries.set(uri.fsPath, cached);
      } else {
        allCached = false;
      }
    }

    if (allCached && group.length > 0) {
      for (const uri of group) {
        const cached = cachedEntries.get(uri.fsPath);
        if (cached?.kind === 'busdef' && cached.record) {
          const record = cached.record as Record<string, unknown>;
          for (const [key, value] of Object.entries(record)) {
            library[key] = value;
          }
          files.push({ uri, busTypes: cached.busTypes ?? [] });
        }
      }
      return;
    }

    // At least one file in the group is new/changed: read the candidates that
    // are either already known to be IP-XACT or pass the cheap head-byte
    // probe, then parse the group together (the busDefinition/
    // abstractionDefinition pair must be resolved jointly).
    const contents: string[] = [];
    const readableUris: vscode.Uri[] = [];
    for (const uri of group) {
      const stat = stats.get(uri.fsPath);
      if (!stat) {
        continue;
      }
      const cached = this.persistentCache.get(uri.fsPath);
      const knownUnchanged = cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size;
      if (knownUnchanged && cached?.kind === 'none') {
        continue;
      }
      try {
        if (!knownUnchanged || cached?.kind !== 'busdef') {
          const head = await readHead(uri.fsPath, XML_PROBE_BYTES);
          if (!looksLikeIpxactBusDef(head)) {
            this.persistentCache.set(uri.fsPath, {
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              kind: 'none',
            });
            continue;
          }
        }
        const fileData = await vscode.workspace.fs.readFile(uri);
        contents.push(Buffer.from(fileData).toString('utf8'));
        readableUris.push(uri);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Skipping workspace bus definition file '${uri.fsPath}': ${message}`);
      }
    }

    if (contents.length === 0) {
      return;
    }

    const interfaces = parseVivadoInterfaceFiles(contents);

    // Build one merged record per resolved interface so each contributing
    // file can cache the same data `peekAndScanInBackground` consumers see.
    const groupBusTypes: string[] = [];
    const groupRecord: Record<string, unknown> = {};
    for (const iface of interfaces) {
      const { key, record } = vivadoInterfaceToBusDefEntry(iface, 'workspace');
      library[key] = record;
      groupRecord[key] = record;
      groupBusTypes.push(key);
    }

    for (const uri of readableUris) {
      const stat = stats.get(uri.fsPath);
      if (!stat) {
        continue;
      }
      if (groupBusTypes.length > 0) {
        files.push({ uri, busTypes: groupBusTypes });
        this.persistentCache.set(uri.fsPath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          kind: 'busdef',
          busTypes: groupBusTypes,
          record: groupRecord,
        });
      } else {
        this.persistentCache.set(uri.fsPath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          kind: 'none',
        });
      }
    }
  }

  /** Invalidates the in-memory cache; the next `scan()` call re-reads the workspace. */
  clearCache(): void {
    this.cache = null;
    this.scanPromise = null;
  }
}

// Module-level singleton — shared by ImportResolver, IpCoreTreeDataProvider,
// and the scanWorkspaceBusDefinitions command so one scan feeds all consumers.
const workspaceBusDefinitionScanner = new WorkspaceBusDefinitionScanner();

export function getWorkspaceBusDefinitionScanner(): WorkspaceBusDefinitionScanner {
  return workspaceBusDefinitionScanner;
}
