/**
 * Import resolver service for IP core YAML files.
 *
 * Resolves external references:
 * - memoryMaps: { import: "file.mm.yml" }
 * - fileSets: [{ import: "file.fileset.yml" }]
 * - useBusLibrary: "path/to/bus_definitions.yml"
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { BusLibraryService } from './BusLibraryService';

export interface ResolvedImports {
  memoryMaps?: Record<string, unknown>[];
  fileSets?: Record<string, unknown>[];
  busLibrary?: Record<string, unknown>;
}

export interface IpCoreDataNode {
  useBusLibrary?: string;
  memoryMaps?: { import?: string; [key: string]: unknown };
  fileSets?: Array<{ import?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export class ImportResolver {
  private readonly logger: Logger;
  private busLibraryCache: Map<string, Record<string, unknown>> = new Map();
  private busLibraryService: BusLibraryService;

  constructor(logger: Logger, context: vscode.ExtensionContext) {
    this.logger = logger;
    this.busLibraryService = new BusLibraryService(logger, context);
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
    if (ipCoreData.memoryMaps?.import) {
      resolved.memoryMaps = await this.resolveMemoryMapImport(
        ipCoreData.memoryMaps.import,
        baseDir
      );
    }

    // Resolve file set imports
    if (Array.isArray(ipCoreData.fileSets)) {
      resolved.fileSets = await this.resolveFileSetImports(ipCoreData.fileSets, baseDir);
    }

    return resolved;
  }

  /**
   * Load default bus library from ipcore_spec.
   * Returns the library in the format expected by the UI: { [key]: { ports: [...] } }
   */
  private async loadDefaultBusLibrary(): Promise<Record<string, unknown>> {
    const library = await this.busLibraryService.loadDefaultLibrary();
    const count = library ? Object.keys(library).length : 0;
    this.logger.info(`Loaded ${count} bus types from local library`);
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
    const absolutePath = path.resolve(baseDir, importPath);
    this.logger.info(`Resolving memory map import: ${absolutePath}`);

    try {
      const parsed = await this.readYamlFile(absolutePath);

      // Memory map files are typically a list
      if (Array.isArray(parsed)) {
        return parsed as Record<string, unknown>[];
      }

      // Fallback: wrap single item in array
      return [parsed as Record<string, unknown>];
    } catch (error) {
      this.logger.error(`Failed to resolve memory map import: ${importPath}`, error as Error);
      throw new Error(`Failed to load memory map from ${importPath}: ${(error as Error).message}`);
    }
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
   *
   * @param libraryPath Relative path to bus library file
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
      const parsed = (await this.readYamlFile(absolutePath)) as Record<string, unknown>;

      // Cache for future use
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
   * Clear the bus library cache.
   */
  clearCache(): void {
    this.busLibraryCache.clear();
    this.busLibraryService.clearCache();
    this.logger.info('Bus library cache cleared');
  }
}
