import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { mapWithConcurrency } from '../utils/concurrency';
import { Logger } from '../utils/Logger';

/**
 * Validates that a parsed YAML object looks like a bus definition record:
 * a top-level object where at least one value is an object with an array
 * `ports` field. Shared by BusLibraryService.scanDirectory and
 * WorkspaceBusDefinitionScanner so validation logic stays in one place.
 */
export function isBusDefRecord(parsed: unknown): parsed is Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return false;
  }
  const record = parsed as Record<string, unknown>;
  return Object.values(record).some(
    (v) =>
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      Array.isArray((v as Record<string, unknown>).ports)
  );
}

export class BusLibraryService {
  private readonly logger: Logger;
  private cachedDefaultLibrary: Record<string, unknown> | null = null;
  private cachedUserLibrary: Record<string, unknown> | null = null;
  private readonly busDefinitionsDir: string;

  constructor(logger: Logger, busDefinitionsDir: string) {
    this.logger = logger;
    this.busDefinitionsDir = busDefinitionsDir;
  }

  /**
   * Load and cache the bundled bus library by merging all .yml files
   * from dist/resources/bus_definitions/.
   *
   * Error strategy: throws on directory read, file read, or parse failures;
   * callers decide whether to surface, recover, or fallback.
   */
  async loadDefaultLibrary(): Promise<Record<string, unknown>> {
    if (this.cachedDefaultLibrary) {
      return this.cachedDefaultLibrary;
    }

    const busDirPath = this.busDefinitionsDir;

    const dirUri = vscode.Uri.file(busDirPath);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch (error) {
      this.logger.error('Default bus library directory not found in extension resources');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Default bus library directory not found at ${busDirPath}: ${message}`);
    }

    const ymlFiles = entries
      .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.yml'))
      .map(([name]) => name)
      .sort();

    const merged: Record<string, unknown> = {};
    for (const fileName of ymlFiles) {
      const filePath = path.join(busDirPath, fileName);
      const fileUri = vscode.Uri.file(filePath);
      let content: string;
      try {
        const fileData = await vscode.workspace.fs.readFile(fileUri);
        content = Buffer.from(fileData).toString('utf8');
      } catch (error) {
        this.logger.error(`Failed to read bus definition file: ${fileName}`);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to read bus definition from ${filePath}: ${message}`);
      }
      try {
        const parsed = yaml.load(content) as Record<string, unknown>;
        Object.assign(merged, parsed);
      } catch (error) {
        this.logger.error(`Failed to parse bus definition file: ${fileName}`);
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to parse bus definition from ${filePath}: ${message}`);
      }
    }

    this.cachedDefaultLibrary = merged;
    this.logger.info(`Loaded default bus library from ${busDirPath} (${ymlFiles.length} files)`);
    return this.cachedDefaultLibrary;
  }

  /**
   * Load and cache bus definitions from user-specified paths.
   * Each path is scanned recursively for .yml/.yaml files (excluding .ip.yml and .mm.yml).
   *
   * @param paths List of directory paths (absolute or relative to workspaceRoot)
   * @param workspaceRoot Optional workspace root for resolving relative paths
   */
  async loadFromUserPaths(
    paths: string[],
    workspaceRoot?: string
  ): Promise<Record<string, unknown>> {
    if (this.cachedUserLibrary) {
      return this.cachedUserLibrary;
    }

    const merged: Record<string, unknown> = {};

    for (const p of paths) {
      const resolvedPath = path.isAbsolute(p) ? p : path.resolve(workspaceRoot ?? process.cwd(), p);
      await this.scanDirectory(resolvedPath, merged);
    }

    this.cachedUserLibrary = merged;
    const count = Object.keys(merged).length;
    this.logger.info(`Loaded ${count} user bus definition(s) from custom paths`);
    return this.cachedUserLibrary;
  }

  /**
   * Recursively scan a directory for bus definition YAML files.
   * Skips files ending in .ip.yml or .mm.yml.
   * Warns on errors rather than throwing.
   *
   * Uses Node's `fs.promises` directly (not `vscode.workspace.fs`) and reads
   * candidates with bounded concurrency. The Vivado interface cache directory
   * holds well over a hundred small YAML files; reading them one at a time over
   * the extension-host -> filesystem-provider IPC channel took ~10s, which
   * stalled both the IP Core editor open and the "Generate" dry-run. Direct
   * `fs` reads fanned out 16-at-a-time bring that to ~100ms (see issue #25).
   */
  private async scanDirectory(dirPath: string, merged: Record<string, unknown>): Promise<void> {
    // called by loadFromUserPaths and loadFromDirectories
    const files = await this.collectBusDefFiles(dirPath);

    // Read+parse with bounded concurrency, preserving input order so the merge
    // below stays deterministic (later files win on key collisions, matching
    // the previous sequential behaviour).
    const records = await mapWithConcurrency(files, 16, async (filePath) => {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const parsed = yaml.load(content);
        return isBusDefRecord(parsed) ? parsed : null;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Skipping bus definition file '${filePath}': ${message}`);
        return null;
      }
    });

    for (const record of records) {
      if (record) {
        Object.assign(merged, record);
      }
    }
  }

  /**
   * Recursively collects candidate bus definition file paths under `dirPath`,
   * skipping `.ip.yml`/`.mm.yml` specs. Directory enumeration uses Node's `fs`
   * (no VS Code IPC). Unreadable directories are warned about, not thrown.
   */
  private async collectBusDefFiles(dirPath: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not read bus library directory '${dirPath}': ${message}`);
      return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await this.collectBusDefFiles(fullPath)));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml')) &&
        !entry.name.endsWith('.ip.yml') &&
        !entry.name.endsWith('.mm.yml')
      ) {
        files.push(fullPath);
      }
    }
    return files;
  }

  /**
   * Load bus definitions from specific directories without touching the user-library cache.
   * Used for per-IP `useBusLibrary` paths that must not collide with global VS Code settings.
   */
  async loadFromDirectories(paths: string[]): Promise<Record<string, unknown>> {
    const merged: Record<string, unknown> = {};
    for (const p of paths) {
      await this.scanDirectory(p, merged);
    }
    const count = Object.keys(merged).length;
    this.logger.info(`Loaded ${count} bus definition(s) from IP-local directories`);
    return merged;
  }

  clearCache(): void {
    this.cachedDefaultLibrary = null;
    this.cachedUserLibrary = null;
  }
}
