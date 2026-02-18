/**
 * Import resolver service for IP core YAML files.
 *
 * Resolves external references:
 * - memoryMaps: { import: "file.mm.yml" }
 * - fileSets: [{ import: "file.fileset.yml" }]
 * - useBusLibrary: "path/to/bus_definitions.yml"
 */

import * as vscode from "vscode";
import * as path from "path";
import * as yaml from "js-yaml";
import { Logger } from "../utils/Logger";
import { BusLibraryService } from "./BusLibraryService";

export interface ResolvedImports {
  memoryMaps?: any[];
  fileSets?: any[];
  busLibrary?: any;
}

export class ImportResolver {
  private readonly logger: Logger;
  private busLibraryCache: Map<string, any> = new Map();
  private defaultBusLibraryCache: any = null;
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
  async resolveImports(
    ipCoreData: any,
    baseDir: string,
  ): Promise<ResolvedImports> {
    const resolved: ResolvedImports = {};

    try {
      // Resolve bus library - first try explicit path, then default via Python backend
      if (ipCoreData.useBusLibrary) {
        resolved.busLibrary = await this.resolveBusLibrary(
          ipCoreData.useBusLibrary,
          baseDir,
        );
      } else {
        // Load default bus library from Python backend
        resolved.busLibrary = await this.loadDefaultBusLibrary();
      }

      // Resolve memory map imports
      if (ipCoreData.memoryMaps?.import) {
        resolved.memoryMaps = await this.resolveMemoryMapImport(
          ipCoreData.memoryMaps.import,
          baseDir,
        );
      }

      // Resolve file set imports
      if (Array.isArray(ipCoreData.fileSets)) {
        resolved.fileSets = await this.resolveFileSetImports(
          ipCoreData.fileSets,
          baseDir,
        );
      }

      return resolved;
    } catch (error) {
      this.logger.error("Import resolution failed", error as Error);
      throw error;
    }
  }

  /**
   * Load default bus library from ipcore_spec.
   * Returns the library in the format expected by the UI: { [key]: { ports: [...] } }
   */
  private async loadDefaultBusLibrary(): Promise<any> {
    // Use cached result if available
    if (this.defaultBusLibraryCache) {
      return this.defaultBusLibraryCache;
    }

    const library = await this.busLibraryService.loadDefaultLibrary();
    this.defaultBusLibraryCache = library;
    const count = library ? Object.keys(library).length : 0;
    this.logger.info(`Loaded ${count} bus types from local library`);
    return library;
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
    baseDir: string,
  ): Promise<any[]> {
    const absolutePath = path.resolve(baseDir, importPath);
    this.logger.info(`Resolving memory map import: ${absolutePath}`);

    try {
      const uri = vscode.Uri.file(absolutePath);
      const fileData = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(fileData).toString("utf8");
      const parsed = yaml.load(content);

      // Memory map files are typically a list
      if (Array.isArray(parsed)) {
        return parsed;
      }

      // Fallback: wrap single item in array
      return [parsed];
    } catch (error) {
      this.logger.error(
        `Failed to resolve memory map import: ${importPath}`,
        error as Error,
      );
      throw new Error(
        `Failed to load memory map from ${importPath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Resolve file set imports.
   *
   * @param fileSets List of file set entries (may contain imports)
   * @param baseDir Base directory for resolution
   * @returns Resolved file sets
   */
  async resolveFileSetImports(
    fileSets: any[],
    baseDir: string,
  ): Promise<any[]> {
    const resolved: any[] = [];

    for (const fileSet of fileSets) {
      if (fileSet.import) {
        // Resolve import
        const importPath = fileSet.import;
        const absolutePath = path.resolve(baseDir, importPath);
        this.logger.info(`Resolving file set import: ${absolutePath}`);

        try {
          const uri = vscode.Uri.file(absolutePath);
          const fileData = await vscode.workspace.fs.readFile(uri);
          const content = Buffer.from(fileData).toString("utf8");
          const parsed = yaml.load(content);

          // Add to resolved list
          if (Array.isArray(parsed)) {
            resolved.push(...parsed);
          } else {
            resolved.push(parsed);
          }
        } catch (error) {
          this.logger.error(
            `Failed to resolve file set import: ${importPath}`,
            error as Error,
          );
          // Continue with other imports
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
  async resolveBusLibrary(libraryPath: string, baseDir: string): Promise<any> {
    const absolutePath = path.resolve(baseDir, libraryPath);

    // Check cache
    if (this.busLibraryCache.has(absolutePath)) {
      this.logger.info(`Using cached bus library: ${absolutePath}`);
      return this.busLibraryCache.get(absolutePath);
    }

    this.logger.info(`Loading bus library: ${absolutePath}`);

    try {
      const uri = vscode.Uri.file(absolutePath);
      const fileData = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(fileData).toString("utf8");
      const parsed = yaml.load(content);

      // Cache for future use
      this.busLibraryCache.set(absolutePath, parsed);

      return parsed;
    } catch (error) {
      this.logger.error(
        `Failed to load bus library: ${libraryPath}`,
        error as Error,
      );
      throw new Error(
        `Failed to load bus library from ${libraryPath}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Clear the bus library cache.
   */
  clearCache(): void {
    this.busLibraryCache.clear();
    this.logger.info("Bus library cache cleared");
  }
}
