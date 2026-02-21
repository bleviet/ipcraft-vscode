import * as vscode from 'vscode';
import * as path from 'path';
import * as jsyaml from 'js-yaml';
import * as YAML from 'yaml';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { MessageHandler } from '../services/MessageHandler';
import { YamlValidator } from '../services/YamlValidator';
import { DocumentManager } from '../services/DocumentManager';
import { ImportResolver } from '../services/ImportResolver';
import { updateFileSets } from '../services/FileSetUpdater';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';

/**
 * Custom editor provider for FPGA IP core YAML files.
 *
 * Detects IP core files by checking for required keys: apiVersion + vlnv
 */
export class IpCoreEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('IpCoreEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly messageHandler: MessageHandler;
  private readonly documentManager: DocumentManager;
  private readonly importResolver: ImportResolver;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.htmlGenerator = new HtmlGenerator(context);
    this.documentManager = new DocumentManager();
    const yamlValidator = new YamlValidator();
    this.messageHandler = new MessageHandler(yamlValidator, this.documentManager);
    this.importResolver = new ImportResolver(this.logger, context);

    this.logger.info('IpCoreEditorProvider initialized');
  }

  /**
   * Check if a document is an IP core YAML file.
   *
   * Detection strategy: Check for required keys (apiVersion + vlnv)
   * This allows *.yml files to work while avoiding false positives.
   */
  private isIpCoreDocument(document: vscode.TextDocument): boolean {
    try {
      const text = document.getText();
      const parsed = jsyaml.load(text);

      if (!parsed || typeof parsed !== 'object') {
        return false;
      }

      // Check for IP core signature: apiVersion + vlnv
      const data = parsed as Record<string, unknown>;
      // apiVersion can be string or number (YAML parses "1.0" as number)
      const hasApiVersion =
        'apiVersion' in data &&
        (typeof data.apiVersion === 'string' || typeof data.apiVersion === 'number');
      const hasVlnv = 'vlnv' in data && typeof data.vlnv === 'object';

      return hasApiVersion && hasVlnv;
    } catch (error) {
      // YAML parse error - not a valid IP core file
      return false;
    }
  }

  /**
   * Resolve the custom text editor for a document.
   */
  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    this.logger.info('Resolving custom text editor for document', document.uri.toString());

    // Check if this is actually an IP core file
    const isIpCore = this.isIpCoreDocument(document);
    if (!isIpCore) {
      this.logger.info('Document is not an IP core file, showing error in webview');
      // Show error in webview instead of disposing - disposing causes VS Code state issues
      webviewPanel.webview.options = { enableScripts: false };
      webviewPanel.webview.html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            font-family: var(--vscode-font-family);
                            padding: 20px;
                            color: var(--vscode-foreground);
                            background: var(--vscode-editor-background);
                        }
                        .error-container {
                            display: flex;
                            flex-direction: column;
                            align-items: center;
                            justify-content: center;
                            height: 80vh;
                            text-align: center;
                        }
                        .error-icon { font-size: 48px; margin-bottom: 16px; }
                        .error-title { font-size: 18px; font-weight: bold; margin-bottom: 8px; }
                        .error-message { opacity: 0.7; }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div class="error-icon">Warning</div>
                        <div class="error-title">Not an IP Core File</div>
                        <div class="error-message">
                            This file does not appear to be an IP core YAML file.<br>
                            Expected: <code>apiVersion</code> and <code>vlnv</code> fields.
                        </div>
                    </div>
                </body>
                </html>
            `;
      return;
    }

    this.logger.info('Document is an IP core file');

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    // Set HTML content - use ipcore-specific HTML
    webviewPanel.webview.html = this.htmlGenerator.generateIpCoreHtml(webviewPanel.webview);

    // Track if webview is disposed
    let isDisposed = false;

    // Send initial update to webview with resolved imports
    const updateWebview = async () => {
      if (isDisposed) {
        this.logger.debug('Webview already disposed, skipping update');
        return;
      }
      try {
        this.logger.debug('updateWebview called');
        const text = document.getText();
        this.logger.debug(`Document text length: ${text.length}`);
        const parsed = jsyaml.load(text);
        this.logger.debug('YAML parsed successfully');

        // Resolve imports
        const baseDir = path.dirname(document.uri.fsPath);
        const imports = await this.importResolver.resolveImports(
          parsed as Record<string, unknown>,
          baseDir
        );
        this.logger.debug(`Imports resolved: ${Object.keys(imports).length} items`);

        // Check again after async operation
        if (isDisposed) {
          this.logger.debug('Webview disposed during import resolution, skipping update');
          return;
        }

        // Send to webview
        const message = {
          type: 'update',
          text: text,
          fileName: path.basename(document.uri.fsPath),
          imports: imports,
        };
        this.logger.info('Posting message to webview:', {
          type: message.type,
          fileName: message.fileName,
          textLength: text.length,
          importsCount: Object.keys(imports).length,
        });
        void webviewPanel.webview.postMessage(message);
        this.logger.debug('Message posted successfully');
      } catch (error) {
        this.logger.error('Failed to update webview', error as Error);
      }
    };

    // Listen for document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        void updateWebview();
      }
    });

    // Clean up subscriptions when webview is disposed
    webviewPanel.onDidDispose(() => {
      isDisposed = true;
      changeDocumentSubscription.dispose();
      this.logger.debug('Webview panel disposed');
    });

    // Handle messages from the webview
    interface IpcMessage {
      type: string;
      multi?: boolean;
      filters?: Record<string, string[]>;
      paths?: string[];
      options?: {
        vendorFiles?: string;
        includeTestbench?: boolean;
        includeRegfile?: boolean;
        includeVhdl?: boolean;
      };
      [key: string]: unknown;
    }
    webviewPanel.webview.onDidReceiveMessage(async (message: IpcMessage) => {
      if (message.type === 'ready') {
        // Webview is ready, send initial update
        this.logger.info('Webview ready, sending initial update');
        void updateWebview();
      } else if (message.type === 'selectFiles') {
        // Handle file selection dialog
        this.logger.info('Opening file picker dialog');
        const options: vscode.OpenDialogOptions = {
          canSelectMany: message.multi ?? true,
          openLabel: 'Select Files',
          canSelectFiles: true,
          canSelectFolders: false,
          filters: message.filters, // Support file filters
        };

        const fileUris = await vscode.window.showOpenDialog(options);
        if (fileUris && fileUris.length > 0) {
          // Get relative paths from the document directory
          const baseDir = path.dirname(document.uri.fsPath);
          const relativePaths = fileUris.map((uri) => {
            const filePath = uri.fsPath;
            return path.relative(baseDir, filePath);
          });

          // Send back to webview
          void webviewPanel.webview.postMessage({
            type: 'filesSelected',
            files: relativePaths,
          });
          this.logger.info(`Selected ${relativePaths.length} file(s)`);
        }
      } else if (message.type === 'checkFilesExist') {
        // Check which files exist on disk
        const baseDir = path.dirname(document.uri.fsPath);
        const filePaths: string[] = message.paths ?? [];
        const results: { [key: string]: boolean } = {};

        for (const filePath of filePaths) {
          try {
            const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
            const uri = vscode.Uri.file(fullPath);
            await vscode.workspace.fs.stat(uri);
            results[filePath] = true;
          } catch {
            results[filePath] = false;
          }
        }

        void webviewPanel.webview.postMessage({
          type: 'filesExistResult',
          results: results,
        });
        this.logger.debug(`Checked ${filePaths.length} file(s) for existence`);
      } else if (message.type === 'generate') {
        // Handle VHDL generation request using TypeScript backend
        this.logger.info('Generate request received', message.options);

        try {
          const baseDir = path.dirname(document.uri.fsPath);
          const text = document.getText();
          const rawData = jsyaml.load(text) as { vlnv?: { name?: string } };
          const ipName = rawData.vlnv?.name?.toLowerCase() ?? 'ip_core';

          // Ask user for output directory using folder picker
          const folderUris = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Output Folder',
            title: 'Select Output Directory for Generated Files',
            defaultUri: vscode.Uri.file(path.dirname(document.uri.fsPath)),
          });

          if (!folderUris || folderUris.length === 0) {
            void webviewPanel.webview.postMessage({
              type: 'generateResult',
              success: false,
              error: 'No output directory selected',
            });
            return;
          }

          // Create output directory: <selected>/<ip_name>/
          const outputBaseDir = path.join(folderUris[0].fsPath, ipName);

          const generator = new IpCoreScaffolder(
            this.logger,
            new TemplateLoader(this.logger),
            this.context
          );
          const result = await generator.generateAll(document.uri.fsPath, outputBaseDir, {
            vendor:
              (message.options?.vendorFiles as 'none' | 'intel' | 'xilinx' | 'both') ?? 'both',
            includeTestbench: message.options?.includeTestbench !== false,
            includeRegs: message.options?.includeRegfile !== false,
            includeVhdl: message.options?.includeVhdl !== false,
            updateYaml: false,
          });

          if (!result.success) {
            void webviewPanel.webview.postMessage({
              type: 'generateResult',
              success: false,
              error: result.error ?? 'Generation failed',
            });
            return;
          }

          // Get list of generated files (relative to outputBaseDir)
          const writtenFiles = result.files ? Object.keys(result.files) : [];

          this.logger.info(`Generated ${writtenFiles.length} files to ${outputBaseDir}`);

          void webviewPanel.webview.postMessage({
            type: 'generateResult',
            success: true,
            files: writtenFiles,
          });

          // Show success message with option to open folder
          const action = await vscode.window.showInformationMessage(
            `Generated ${writtenFiles.length} files to ${outputBaseDir}`,
            'Open Folder'
          );

          if (action === 'Open Folder') {
            await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputBaseDir));
          }

          // Update file sets in the YAML document
          try {
            const doc = YAML.parseDocument(document.getText());

            // Convert file paths to be relative to YAML document location
            const yamlRelativeFiles = writtenFiles.map((f) => {
              const absolutePath = path.join(outputBaseDir, f);
              return path.relative(baseDir, absolutePath);
            });

            // Get current fileSets
            const currentData = doc.toJSON() as Record<string, unknown>;
            type FileSet = {
              name?: string;
              description?: string;
              files?: { path: string; type: string }[];
            };

            const fileSets: FileSet[] = Array.isArray(currentData.fileSets)
              ? (currentData.fileSets as FileSet[])
              : Array.isArray(currentData.file_sets)
                ? (currentData.file_sets as FileSet[])
                : [];

            const key = currentData.fileSets
              ? 'fileSets'
              : currentData.file_sets
                ? 'file_sets'
                : 'fileSets';

            const updatedFileSets = updateFileSets(fileSets, yamlRelativeFiles) as FileSet[];
            doc.setIn([key], updatedFileSets);

            const newText = doc.toString();
            const updateSuccess = await this.documentManager.updateDocument(document, newText);
            if (updateSuccess) {
              this.logger.info('Updated file sets with generated files');
              await updateWebview();
            } else {
              this.logger.error('Failed to apply document edit for file sets');
            }
          } catch (e) {
            this.logger.error('Error updating file sets', e as Error);
          }
        } catch (error) {
          const err = error as Error;
          this.logger.error('Generation failed', err);
          void webviewPanel.webview.postMessage({
            type: 'generateResult',
            success: false,
            error: err.message || 'Unknown error',
          });
        }
      } else {
        void this.messageHandler.handleMessage(message, document);
      }
    });

    // Send initial content after a small delay to ensure webview is loaded
    // The webview will also send a 'ready' message when it's initialized
    setTimeout(() => {
      void updateWebview();
    }, 100);
  }
}
