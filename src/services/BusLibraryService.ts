import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger';

export class BusLibraryService {
  private readonly logger: Logger;
  private cachedDefaultLibrary: Record<string, unknown> | null = null;
  private cachedUserLibrary: Record<string, unknown> | null = null;
  private readonly context: vscode.ExtensionContext;

  constructor(logger: Logger, context: vscode.ExtensionContext) {
    this.logger = logger;
    this.context = context;
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

    const busDirPath = path.join(
      this.context.extensionPath,
      'dist',
      'resources',
      'bus_definitions'
    );

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
   */
  private async scanDirectory(dirPath: string, merged: Record<string, unknown>): Promise<void> {
    const dirUri = vscode.Uri.file(dirPath);
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(dirUri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Could not read bus library directory '${dirPath}': ${message}`);
      return;
    }

    for (const [name, type] of entries) {
      if (type === vscode.FileType.Directory) {
        await this.scanDirectory(path.join(dirPath, name), merged);
      } else if (
        type === vscode.FileType.File &&
        (name.endsWith('.yml') || name.endsWith('.yaml')) &&
        !name.endsWith('.ip.yml') &&
        !name.endsWith('.mm.yml')
      ) {
        const filePath = path.join(dirPath, name);
        try {
          const fileUri = vscode.Uri.file(filePath);
          const fileData = await vscode.workspace.fs.readFile(fileUri);
          const content = Buffer.from(fileData).toString('utf8');
          const parsed = yaml.load(content);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>;
            // Validate: at least one top-level value must be an object with an array `ports` field
            const looksLikeBusDef = Object.values(record).some(
              (v) =>
                v !== null &&
                typeof v === 'object' &&
                !Array.isArray(v) &&
                Array.isArray((v as Record<string, unknown>).ports)
            );
            if (looksLikeBusDef) {
              Object.assign(merged, record);
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Skipping bus definition file '${filePath}': ${message}`);
        }
      }
    }
  }

  clearCache(): void {
    this.cachedDefaultLibrary = null;
    this.cachedUserLibrary = null;
  }
}
