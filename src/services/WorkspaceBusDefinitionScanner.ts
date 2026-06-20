import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { isBusDefRecord } from './BusLibraryService';
import { vivadoInterfaceToBusDefEntry } from './VivadoInterfaceScanner';
import { parseVivadoInterfaceFiles } from '../parser/VivadoInterfaceXmlParser';
import { Logger } from '../utils/Logger';

const logger = new Logger('WorkspaceBusDefinitionScanner');

// Hard safety valve for pathological workspaces — bounds both the findFiles
// walk and the number of files we read+parse per scan.
const MAX_CANDIDATES_PER_GLOB = 5000;

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

/** Runs `fn` over `items` with at most `limit` calls in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) {
        return;
      }
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
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
  private readonly _onDidScan = new vscode.EventEmitter<void>();
  readonly onDidScan = this._onDidScan.event;

  private cache: { library: Record<string, unknown>; files: WorkspaceBusDefFile[] } | null = null;
  private scanPromise: Promise<WorkspaceBusDefScanResult> | null = null;

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
        this._onDidScan.fire();
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
    const result = await this.doScan();
    if (force) {
      this._onDidScan.fire();
    }
    return result;
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
  private async doScan(): Promise<WorkspaceBusDefScanResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.cache = { library: {}, files: [] };
      return { ...this.cache, count: 0 };
    }

    const excludeGlob = buildExcludeGlob();
    const library: Record<string, unknown> = {};
    const files: WorkspaceBusDefFile[] = [];

    await this.scanYamlFiles(workspaceFolders, excludeGlob, library, files);
    await this.scanXmlFiles(workspaceFolders, excludeGlob, library, files);

    this.cache = { library, files };
    const count = Object.keys(library).length;
    logger.info(
      `Workspace bus definition scan complete: ${count} definition(s) from ${files.length} file(s)`
    );
    return { library, files, count };
  }

  /**
   * Scans for standalone bus definition YAML files. Files ending in `.ip.yml`
   * or `.mm.yml` are excluded — they are IP core / memory map specs, not bus
   * definitions. Candidates are read+parsed with bounded concurrency rather
   * than one at a time, since this is I/O-bound work.
   */
  private async scanYamlFiles(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    excludeGlob: string,
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[]
  ): Promise<void> {
    const candidateUris: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.{yml,yaml}');
      const found = await vscode.workspace.findFiles(pattern, excludeGlob, MAX_CANDIDATES_PER_GLOB);
      candidateUris.push(...found);
      if (found.length >= MAX_CANDIDATES_PER_GLOB) {
        logger.warn(
          `Workspace bus definition YAML scan hit the ${MAX_CANDIDATES_PER_GLOB}-file cap in ` +
            `'${folder.uri.fsPath}'; some files may have been skipped.`
        );
      }
    }

    // Filter out IP core / memory map specs — they use compound extensions.
    const busDefCandidates = candidateUris.filter((uri) => {
      const base = path.basename(uri.fsPath);
      return !base.endsWith('.ip.yml') && !base.endsWith('.mm.yml');
    });

    await mapWithConcurrency(busDefCandidates, 16, async (uri) => {
      try {
        const fileData = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(fileData).toString('utf8');
        const parsed = yaml.load(content);
        if (!isBusDefRecord(parsed)) {
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
   */
  private async scanXmlFiles(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    excludeGlob: string,
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[]
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

    const byDirectory = new Map<string, vscode.Uri[]>();
    for (const uri of candidateUris) {
      const dir = path.dirname(uri.fsPath);
      const group = byDirectory.get(dir) ?? [];
      group.push(uri);
      byDirectory.set(dir, group);
    }

    await mapWithConcurrency(Array.from(byDirectory.values()), 16, async (group) => {
      const contents: string[] = [];
      const readableUris: vscode.Uri[] = [];
      for (const uri of group) {
        try {
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
      if (interfaces.length === 0) {
        return;
      }

      const busTypes: string[] = [];
      for (const iface of interfaces) {
        const { key, record } = vivadoInterfaceToBusDefEntry(iface, 'workspace');
        library[key] = record;
        busTypes.push(key);
      }
      for (const uri of readableUris) {
        files.push({ uri, busTypes });
      }
    });
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
