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
   * Load and cache the bundled bus library.
   *
   * Error strategy: throws on file read or parse failures; callers decide
   * whether to surface, recover, or fallback.
   */
  async loadDefaultLibrary(): Promise<Record<string, unknown>> {
    if (this.cachedDefaultLibrary) {
      return this.cachedDefaultLibrary;
    }

    const builtInPath = path.join(
      this.context.extensionPath,
      'dist',
      'resources',
      'bus_definitions.yml'
    );

    let loadedContent: string;
    try {
      const uri = vscode.Uri.file(builtInPath);
      const fileData = await vscode.workspace.fs.readFile(uri);
      loadedContent = Buffer.from(fileData).toString('utf8');
    } catch (error) {
      this.logger.error('Default bus library not found in extension resources');
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Default bus library not found at ${builtInPath}: ${message}`);
    }

    try {
      const parsed = yaml.load(loadedContent);
      this.cachedDefaultLibrary = (parsed as Record<string, unknown>) ?? {};
      this.logger.info(`Loaded default bus library from ${builtInPath}`);
      return this.cachedDefaultLibrary;
    } catch (error) {
      this.logger.error(`Failed to parse default bus library from ${builtInPath}`, error as Error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse default bus library from ${builtInPath}: ${message}`);
    }
  }

  clearCache(): void {
    this.cachedDefaultLibrary = null;
  }
}
