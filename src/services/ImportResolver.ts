/**
 * Import resolver service for IP core YAML files.
 *
 * Resolves external references:
 * - memoryMaps: { import: "file.mm.yml" }
 * - fileSets: [{ import: "file.fileset.yml" }]
 * - useBusLibrary: "path/to/bus_definitions"
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { BusLibraryService, type LoadedBusDefinitionSources } from './BusLibraryService';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import { getWorkspaceBusDefinitionScanner } from './WorkspaceBusDefinitionScanner';
import { resolveMemoryMapImports } from './imports/resolveMemoryMapImports';
import { getVivadoInterfaceCacheDir, pathExists } from './VivadoInterfaceScanner';
import { resolveVivadoCacheVersion } from './VivadoCacheVersion';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

export interface ResolvedImports {
  memoryMaps?: Record<string, unknown>[];
  fileSets?: Record<string, unknown>[];
  busLibrary?: NormalizedBusLibrary;
}

export interface IpCoreDataNode {
  useBusLibrary?: string;
  memoryMaps?:
    | { import?: string; [key: string]: unknown }
    | Array<{ import?: string; name?: string; [key: string]: unknown }>;
  fileSets?: Array<{ import?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export class ImportResolver {
  private readonly logger: Logger;
  private busLibraryCache: Map<string, LoadedBusDefinitionSources> = new Map();
  private busLibraryService: BusLibraryService;
  // Stable reference so the memo can hit when no user paths are configured.
  private readonly noConfiguredSources: LoadedBusDefinitionSources = {
    sources: [],
    diagnostics: [],
  };
  /**
   * Normalized-library memo keyed by the ipLocal sources reference. A hit needs the
   * builtin, configured and workspace-scan library references to be unchanged; each
   * is a cached reference upstream, so config/Vivado/workspace changes invalidate it.
   */
  private normalizedLibraryMemo = new Map<
    LoadedBusDefinitionSources | undefined,
    {
      builtin: LoadedBusDefinitionSources;
      configured: LoadedBusDefinitionSources;
      workspaceLibrary: unknown;
      library: NormalizedBusLibrary;
    }
  >();

  constructor(
    logger: Logger,
    busDefinitionsDir: string,
    busDefinitionSchemaPath?: string,
    /** Called with each definition root (directory or file) this resolver loads from. */
    private readonly onDefinitionRoot?: (absolutePath: string) => void
  ) {
    this.logger = logger;
    this.busLibraryService = new BusLibraryService(
      logger,
      busDefinitionsDir,
      busDefinitionSchemaPath
    );
  }

  /**
   * Resolve all imports in an IP core YAML structure.
   *
   * @param ipCoreData Parsed IP core YAML data
   * @param baseDir Directory containing the IP core YAML file
   * @returns Resolved imports
   */
  async resolveImports(
    ipCoreData: IpCoreDataNode,
    baseDir: string,
    resourceUri: vscode.Uri = vscode.Uri.file(baseDir)
  ): Promise<ResolvedImports> {
    const resolved: ResolvedImports = {};

    resolved.busLibrary = await this.loadBusLibrary(ipCoreData, baseDir, resourceUri);

    // Resolve memory map imports
    if (ipCoreData.memoryMaps) {
      const reader = {
        readText: async (absPath: string) => {
          const uri = vscode.Uri.file(absPath);
          const fileData = await vscode.workspace.fs.readFile(uri);
          return Buffer.from(fileData).toString('utf8');
        },
      };
      const { resolved: mmResolved, errors } = await resolveMemoryMapImports({
        memoryMaps: ipCoreData.memoryMaps,
        baseDir,
        reader,
      });
      for (const err of errors) {
        this.logger.warn(err);
      }
      resolved.memoryMaps = mmResolved;
    }

    // Resolve file set imports
    if (Array.isArray(ipCoreData.fileSets)) {
      resolved.fileSets = await this.resolveFileSetImports(ipCoreData.fileSets, baseDir);
    }

    return resolved;
  }

  /**
   * Load the precedence-ordered bus library for an IP core: builtin, workspace,
   * configured paths, then the IP's own `useBusLibrary` (when it loads).
   */
  async loadBusLibrary(
    ipCoreData: IpCoreDataNode,
    baseDir: string,
    resourceUri: vscode.Uri = vscode.Uri.file(baseDir)
  ): Promise<NormalizedBusLibrary> {
    let ipLocal: LoadedBusDefinitionSources | undefined;
    if (ipCoreData.useBusLibrary) {
      try {
        ipLocal = await this.resolveBusLibrary(ipCoreData.useBusLibrary, baseDir);
      } catch (busError) {
        this.logger.warn(
          `Could not load bus library from '${String(ipCoreData.useBusLibrary)}' ` +
            `(resolved to: ${path.resolve(baseDir, String(ipCoreData.useBusLibrary))}). ` +
            `Falling back to default bus library. Reason: ${(busError as Error).message}`
        );
      }
    }
    return this.loadDefaultBusLibrary(resourceUri, ipLocal);
  }

  /**
   * Load default bus library from ipcore_spec, extended with any user-defined paths
   * configured via the `ipcraft.busLibraryPaths` VS Code setting, plus the cached
   * Vivado interface catalog (if "Scan Vivado Interface Catalog" has been run).
   * The resource's successful scan selection (or explicit pin when no selection
   * metadata exists) selects that version's machine-wide cache.
   * Returns the library in the format expected by the UI: { [key]: { ports: [...] } }
   */
  private async loadDefaultBusLibrary(
    resourceUri: vscode.Uri,
    ipLocal?: LoadedBusDefinitionSources
  ): Promise<NormalizedBusLibrary> {
    const builtin = await this.busLibraryService.loadDefaultSources();

    const config = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, resourceUri);
    const userPaths = [...config.get<string[]>('busLibraryPaths', [])];
    const cacheVersion = await resolveVivadoCacheVersion(config, 'interfaces', resourceUri);
    const vivadoCacheDir = getVivadoInterfaceCacheDir(cacheVersion);
    if (await pathExists(vivadoCacheDir)) {
      userPaths.push(vivadoCacheDir);
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    let configured = this.noConfiguredSources;
    if (userPaths.length > 0) {
      for (const userPath of userPaths) {
        this.onDefinitionRoot?.(path.resolve(workspaceRoot ?? process.cwd(), userPath));
      }
      configured = await this.busLibraryService.loadFromUserPaths(userPaths, workspaceRoot);
    }

    // Merge workspace-discovered bus definitions (tagged `source: 'workspace'`),
    // mirroring how the Vivado interface cache is merged above. These are
    // standalone .yml/.yaml/.xml files in the user's workspace that match the
    // bus definition shape, surfaced as known interfaces in the Inspector.
    //
    // peekAndScanInBackground() never blocks on the workspace walk — in a
    // large repository that walk is too slow to run on every editor open/
    // update. It returns whatever's already been discovered (possibly
    // nothing yet) and, the first time, kicks off a background scan that
    // fires `onDidScan` on completion; `IpCoreEditorProvider` is subscribed
    // to that event and refreshes the webview once results are in.
    const workspaceResult = getWorkspaceBusDefinitionScanner().peekAndScanInBackground();
    const memo = this.normalizedLibraryMemo.get(ipLocal);
    if (
      memo?.builtin === builtin &&
      memo.configured === configured &&
      memo.workspaceLibrary === workspaceResult.library
    ) {
      return memo.library;
    }
    const workspace = this.busLibraryService.loadWorkspaceScan(workspaceResult);
    const library = this.busLibraryService.normalizeSources(
      builtin,
      workspace,
      configured,
      ...(ipLocal ? [ipLocal] : [])
    );
    for (const diagnostic of library.diagnostics) {
      if (diagnostic.severity === 'warning') {
        this.logger.warn(`${diagnostic.sourceFile}: ${diagnostic.message}`);
      }
    }
    this.logger.info(
      `Loaded ${Object.keys(library.definitions).length} bus types from local library`
    );
    this.normalizedLibraryMemo.set(ipLocal, {
      builtin,
      configured,
      workspaceLibrary: workspaceResult.library,
      library,
    });
    return library;
  }

  private async readYamlFile(absolutePath: string): Promise<unknown> {
    const uri = vscode.Uri.file(absolutePath);
    const fileData = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(fileData).toString('utf8');
    return yaml.load(content);
  }

  /**
   * Resolve memory map import.
   *
   * @param importPath Relative path to memory map file
   * @param baseDir Base directory for resolution
   * @returns Parsed memory map data
   */
  async resolveMemoryMapImport(
    importPath: string,
    baseDir: string
  ): Promise<Record<string, unknown>[]> {
    const reader = {
      readText: async (absPath: string) => {
        const uri = vscode.Uri.file(absPath);
        const fileData = await vscode.workspace.fs.readFile(uri);
        return Buffer.from(fileData).toString('utf8');
      },
    };
    const { resolved, errors } = await resolveMemoryMapImports({
      memoryMaps: { import: importPath },
      baseDir,
      reader,
    });
    if (errors.length > 0) {
      throw new Error(errors[0]);
    }
    return resolved;
  }

  /**
   * Resolve file set imports.
   *
   * @param fileSets List of file set entries (may contain imports)
   * @param baseDir Base directory for resolution
   * @returns Resolved file sets
   *
   * Error strategy: throw on the first import failure so callers can decide
   * whether to fail fast or apply a fallback policy.
   */
  async resolveFileSetImports(
    fileSets: Array<{ import?: string; [key: string]: unknown }>,
    baseDir: string
  ): Promise<Record<string, unknown>[]> {
    const resolved: Record<string, unknown>[] = [];

    for (const fileSet of fileSets) {
      if (fileSet.import) {
        // Resolve import
        const importPath = fileSet.import;
        const absolutePath = path.resolve(baseDir, importPath);
        this.logger.info(`Resolving file set import: ${absolutePath}`);

        try {
          const parsed = await this.readYamlFile(absolutePath);

          // Add to resolved list
          if (Array.isArray(parsed)) {
            resolved.push(...(parsed as Record<string, unknown>[]));
          } else {
            resolved.push(parsed as Record<string, unknown>);
          }
        } catch (error) {
          this.logger.error(
            `Failed to resolve file set import: ${String(importPath)}`,
            error as Error
          );
          throw new Error(
            `Failed to load file set import ${String(importPath)}: ${(error as Error).message}`
          );
        }
      } else {
        // Not an import, add as-is
        resolved.push(fileSet);
      }
    }

    return resolved;
  }

  /**
   * Resolve and cache bus library.
   * Supports both single YAML files and directories (all .yml files are merged).
   *
   * @param libraryPath Relative path to bus library file or directory
   * @param baseDir Base directory for resolution
   * @returns Parsed bus library data
   */
  async resolveBusLibrary(
    libraryPath: string,
    baseDir: string
  ): Promise<LoadedBusDefinitionSources> {
    const absolutePath = path.resolve(baseDir, libraryPath);
    this.onDefinitionRoot?.(absolutePath);

    // Check cache
    if (this.busLibraryCache.has(absolutePath)) {
      this.logger.info(`Using cached bus library: ${absolutePath}`);
      return this.busLibraryCache.get(absolutePath) as LoadedBusDefinitionSources;
    }

    this.logger.info(`Loading bus library: ${absolutePath}`);

    try {
      // Check if the path is a directory
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolutePath));
      let loaded: LoadedBusDefinitionSources;
      if (stat.type === vscode.FileType.Directory) {
        loaded = await this.busLibraryService.loadFromDirectories([absolutePath], 'ipLocal');
      } else {
        const parsed = (await this.readYamlFile(absolutePath)) as Record<string, unknown>;
        loaded = this.busLibraryService.loadRecord(parsed, absolutePath, 'ipLocal');
      }

      this.busLibraryCache.set(absolutePath, loaded);
      return loaded;
    } catch (error) {
      this.logger.error(`Failed to load bus library: ${libraryPath}`, error as Error);
      throw new Error(
        `Failed to load bus library from ${libraryPath}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Drop cached bus definition files (ipLocal, builtin, configured, memo) but keep the
   * workspace scanner, whose clear would trigger a full workspace rescan.
   */
  clearDefinitionFileCache(): void {
    this.busLibraryCache.clear();
    this.normalizedLibraryMemo.clear();
    this.busLibraryService.clearCache();
  }

  /**
   * Clear the bus library cache.
   */
  clearCache(): void {
    this.busLibraryCache.clear();
    this.normalizedLibraryMemo.clear();
    this.busLibraryService.clearCache();
    getWorkspaceBusDefinitionScanner().clearCache();
    this.logger.info('Bus library cache cleared');
  }
}
