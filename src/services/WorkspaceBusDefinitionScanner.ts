import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { isBusDefRecord } from './BusLibraryService';
import { vivadoInterfaceToBusDefEntry } from './VivadoInterfaceScanner';
import { parseVivadoInterfaceFiles } from '../parser/VivadoInterfaceXmlParser';
import { Logger } from '../utils/Logger';

const logger = new Logger('WorkspaceBusDefinitionScanner');

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
 * A module-level singleton (`getWorkspaceBusDefinitionScanner`) is shared by
 * `ImportResolver`, `IpCoreTreeDataProvider`, and the
 * `fpga-ip-core.scanWorkspaceBusDefinitions` command so a single scan feeds
 * every consumer. `onDidScan` fires after a forced re-scan so open IP core
 * editors can refresh their webviews with the updated bus library.
 */
export class WorkspaceBusDefinitionScanner {
  private readonly _onDidScan = new vscode.EventEmitter<void>();
  readonly onDidScan = this._onDidScan.event;

  private cache: { library: Record<string, unknown>; files: WorkspaceBusDefFile[] } | null = null;

  /**
   * Scans all workspace folders for bus definition files — both standalone
   * YAML (same shape as `ipcraft-spec/bus_definitions/*.yml`) and IP-XACT
   * bus/abstraction definition XML (the format Vivado's IP Packager emits
   * for a custom bus interface). Results are cached; pass `force: true` to
   * re-scan (used by the "Scan Workspace Bus Definitions" command).
   *
   * Common generated/dependency directories (`node_modules`, `.git`, `dist`,
   * `out`, `build`) are excluded via the `findFiles` ignore pattern.
   */
  async scan(force = false): Promise<WorkspaceBusDefScanResult> {
    if (!force && this.cache) {
      return { ...this.cache, count: Object.keys(this.cache.library).length };
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.cache = { library: {}, files: [] };
      return { ...this.cache, count: 0 };
    }

    const library: Record<string, unknown> = {};
    const files: WorkspaceBusDefFile[] = [];

    await this.scanYamlFiles(workspaceFolders, library, files);
    await this.scanXmlFiles(workspaceFolders, library, files);

    this.cache = { library, files };
    const count = Object.keys(library).length;
    logger.info(
      `Workspace bus definition scan complete: ${count} definition(s) from ${files.length} file(s)`
    );
    // Only notify on explicit (forced) re-scans — firing on every cache-miss
    // scan would cause an infinite loop, since ImportResolver.loadDefaultBusLibrary
    // calls scan() on every webview update and the onDidScan handler clears the
    // import-resolver cache + triggers another updateWebview.
    if (force) {
      this._onDidScan.fire();
    }
    return { library, files, count };
  }

  /**
   * Scans for standalone bus definition YAML files. Files ending in `.ip.yml`
   * or `.mm.yml` are excluded — they are IP core / memory map specs, not bus
   * definitions.
   */
  private async scanYamlFiles(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[]
  ): Promise<void> {
    const excludePattern = '**/{node_modules,.git,dist,out,build}/**';
    const candidateUris: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.{yml,yaml}');
      const found = await vscode.workspace.findFiles(pattern, excludePattern);
      candidateUris.push(...found);
    }

    // Filter out IP core / memory map specs — they use compound extensions.
    const busDefCandidates = candidateUris.filter((uri) => {
      const base = path.basename(uri.fsPath);
      return !base.endsWith('.ip.yml') && !base.endsWith('.mm.yml');
    });

    for (const uri of busDefCandidates) {
      try {
        const fileData = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(fileData).toString('utf8');
        const parsed = yaml.load(content);
        if (!isBusDefRecord(parsed)) {
          continue;
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
    }
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
   */
  private async scanXmlFiles(
    workspaceFolders: readonly vscode.WorkspaceFolder[],
    library: Record<string, unknown>,
    files: WorkspaceBusDefFile[]
  ): Promise<void> {
    const excludePattern = '**/{node_modules,.git,dist,out,build}/**';
    const candidateUris: vscode.Uri[] = [];
    for (const folder of workspaceFolders) {
      const pattern = new vscode.RelativePattern(folder, '**/*.xml');
      const found = await vscode.workspace.findFiles(pattern, excludePattern);
      candidateUris.push(...found);
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

    for (const group of byDirectory.values()) {
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
        continue;
      }

      const interfaces = parseVivadoInterfaceFiles(contents);
      if (interfaces.length === 0) {
        continue;
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
    }
  }

  /** Invalidates the in-memory cache; the next `scan()` call re-reads the workspace. */
  clearCache(): void {
    this.cache = null;
  }
}

// Module-level singleton — shared by ImportResolver, IpCoreTreeDataProvider,
// and the scanWorkspaceBusDefinitions command so one scan feeds all consumers.
const workspaceBusDefinitionScanner = new WorkspaceBusDefinitionScanner();

export function getWorkspaceBusDefinitionScanner(): WorkspaceBusDefinitionScanner {
  return workspaceBusDefinitionScanner;
}
