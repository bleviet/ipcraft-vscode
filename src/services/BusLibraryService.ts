import * as path from "path";
import * as vscode from "vscode";
import * as yaml from "js-yaml";
import { Logger } from "../utils/Logger";

export class BusLibraryService {
  private readonly logger: Logger;
  private cachedDefaultLibrary: any | null = null;
  private readonly context: vscode.ExtensionContext;

  constructor(logger: Logger, context: vscode.ExtensionContext) {
    this.logger = logger;
    this.context = context;
  }

  async loadDefaultLibrary(): Promise<any> {
    if (this.cachedDefaultLibrary) {
      return this.cachedDefaultLibrary;
    }

    const builtInPath = path.join(
      this.context.extensionPath,
      "dist",
      "resources",
      "bus_definitions.yml",
    );

    // Provide only one path since webpack handles resources
    const candidates = [builtInPath];
    let loadedContent: string | null = null;
    let loadedPath: string | null = null;

    for (const candidate of candidates) {
      try {
        const uri = vscode.Uri.file(candidate);
        const fileData = await vscode.workspace.fs.readFile(uri);
        loadedContent = Buffer.from(fileData).toString("utf8");
        loadedPath = candidate;
        break;
      } catch (e) {
        // Check next candidate
      }
    }

    if (!loadedContent || !loadedPath) {
      this.logger.error("Default bus library not found in extension resources");
      return {};
    }

    try {
      const parsed = yaml.load(loadedContent);
      this.cachedDefaultLibrary = parsed ?? {};
      this.logger.info(`Loaded default bus library from ${loadedPath}`);
      return this.cachedDefaultLibrary;
    } catch (error) {
      this.logger.error(
        `Failed to parse default bus library from ${loadedPath}`,
        error as Error,
      );
      return {};
    }
  }

  clearCache(): void {
    this.cachedDefaultLibrary = null;
  }
}
