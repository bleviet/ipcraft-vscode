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
import { BusLibraryService } from './BusLibraryService';
import { getWorkspaceBusDefinitionScanner } from './WorkspaceBusDefinitionScanner';
import { resolveMemoryMapImports } from './imports/resolveMemoryMapImports';
import { getVivadoInterfaceCacheDir, pathExists } from './VivadoInterfaceScanner';

export interface ResolvedImports {
  memoryMaps?: Record<string, unknown>[];
  fileSets?: Record<string, unknown>[];
  busLibrary?: Record<string, unknown>;
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
  private busLibraryCache: Map<string, Record<string, unknown>> = new Map();
  private busLibraryService: BusLibraryService;

  constructor(logger: Logger, busDefinitionsDir: string) {
    this.logger = logger;
    this.busLibraryService = new BusLibraryService(logger, busDefinitionsDir);
  }

  /**
   * Resolve all imports in an IP core YAML structure.
   *
   * @param ipCoreData Parsed IP core YAML data
   * @param baseDir Directory containing the IP core YAML file
   * @returns Resolved imports
   */
  async resolveImports(ipCoreData: IpCoreDataNode, baseDir: string): Promise<ResolvedImports> {
    const resolved: ResolvedImports = {};

    // Resolve bus library - first try explicit path, then fall back to default
    if (ipCoreData.useBusLibrary) {
      try {
        resolved.busLibrary = await this.resolveBusLibrary(ipCoreData.useBusLibrary, baseDir);
      } catch (busError) {
        this.logger.warn(
          `Could not load bus library from '${String(ipCoreData.useBusLibrary)}' ` +
            `(resolved to: ${path.resolve(baseDir, String(ipCoreData.useBusLibrary))}). ` +
            `Falling back to default bus library. Reason: ${(busError as Error).message}`
        );
        resolved.busLibrary = await this.loadDefaultBusLibrary();
      }
    } else {
      // Load default bus library from Python backend
      resolved.busLibrary = await this.loadDefaultBusLibrary();
    }

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
   * Load default bus library from ipcore_spec, extended with any user-defined paths
   * configured via the `ipcraft.busLibraryPaths` VS Code setting, plus the cached
   * Vivado interface catalog (if "Scan Vivado Interface Catalog" has been run) —
   * a single global cache shared by every IP core, never duplicated per project.
   * Returns the library in the format expected by the UI: { [key]: { ports: [...] } }
   */
  private async loadDefaultBusLibrary(): Promise<Record<string, unknown>> {
    const library = await this.busLibraryService.loadDefaultLibrary();
    const count = library ? Object.keys(library).length : 0;
    this.logger.info(`Loaded ${count} bus types from local library`);

    const config = vscode.workspace.getConfiguration('ipcraft');
    const userPaths = [...config.get<string[]>('busLibraryPaths', [])];
    const vivadoCacheDir = getVivadoInterfaceCacheDir();
    if (await pathExists(vivadoCacheDir)) {
      userPaths.push(vivadoCacheDir);
    }
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    let merged: Record<string, unknown> = { ...library };

    if (userPaths.length > 0) {
      const userLibrary = await this.busLibraryService.loadFromUserPaths(userPaths, workspaceRoot);
      merged = { ...merged, ...userLibrary };
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
    if (workspaceResult.count > 0) {
      merged = { ...merged, ...workspaceResult.library };
    }

    return merged;
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
  async resolveBusLibrary(libraryPath: string, baseDir: string): Promise<Record<string, unknown>> {
    const absolutePath = path.resolve(baseDir, libraryPath);

    // Check cache
    if (this.busLibraryCache.has(absolutePath)) {
      this.logger.info(`Using cached bus library: ${absolutePath}`);
      return this.busLibraryCache.get(absolutePath) as Record<string, unknown>;
    }

    this.logger.info(`Loading bus library: ${absolutePath}`);

    try {
      // Check if the path is a directory
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(absolutePath));
      let parsed: Record<string, unknown>;
      if (stat.type === vscode.FileType.Directory) {
        parsed = await this.resolveBusLibraryDirectory(absolutePath);
      } else {
        parsed = (await this.readYamlFile(absolutePath)) as Record<string, unknown>;
      }

      this.busLibraryCache.set(absolutePath, parsed);
      return parsed;
    } catch (error) {
      this.logger.error(`Failed to load bus library: ${libraryPath}`, error as Error);
      throw new Error(
        `Failed to load bus library from ${libraryPath}: ${(error as Error).message}`
      );
    }
  }

  /**
   * Load and merge all .yml files from a directory into a single bus library object.
   */
  private async resolveBusLibraryDirectory(dirPath: string): Promise<Record<string, unknown>> {
    const dirUri = vscode.Uri.file(dirPath);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch {
      this.logger.warn(`Custom bus library directory not found: ${dirPath}`);
      return {};
    }

    const ymlFiles = entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.yml'))
      .map(([name]) => name)
      .sort();

    const merged: Record<string, unknown> = {};
    for (const fileName of ymlFiles) {
      try {
        const filePath = path.join(dirPath, fileName);
        const parsed = (await this.readYamlFile(filePath)) as Record<string, unknown>;
        Object.assign(merged, parsed);
      } catch (err) {
        this.logger.warn(`Skipping unreadable bus definition file: ${fileName}`);
      }
    }

    this.logger.info(`Loaded ${ymlFiles.length} custom bus definition(s) from ${dirPath}`);
    return merged;
  }

  /**
   * Clear the bus library cache.
   */
  clearCache(): void {
    this.busLibraryCache.clear();
    this.busLibraryService.clearCache();
    getWorkspaceBusDefinitionScanner().clearCache();
    this.logger.info('Bus library cache cleared');
  }
}
