import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger';

export class BusLibraryService {
  private readonly logger: Logger;
  private cachedDefaultLibrary: Record<string, unknown> | null = null;
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

  clearCache(): void {
    this.cachedDefaultLibrary = null;
  }
}
