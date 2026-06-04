import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as jsyaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { MessageHandler } from '../services/MessageHandler';
import { YamlValidator } from '../services/YamlValidator';
import { DocumentManager } from '../services/DocumentManager';
import { ImportResolver } from '../services/ImportResolver';
import { SubcoreResolver } from '../services/SubcoreResolver';
import { isValidVlnv } from '../utils/vlnv';
import { createNotIpCoreHtml } from './ipCoreErrorHtml';
import { createSharedProviderServices } from './providerServices';
import {
  handleGenerateRequest,
  type GenerateRequestMessage,
  type GenerateOptionsMessage,
} from './IpCoreGenerateHandler';
import { editInIpPackagerCommand } from '../commands/editInIpPackager';
import { editInPlatformDesignerCommand } from '../commands/editInPlatformDesigner';
import { openInVivadoCommand } from '../commands/openInVivado';
import { openInQuartusCommand } from '../commands/openInQuartus';
import { listAll } from '../services/toolchains/registry';

interface IpcMessage {
  type: string;
  multi?: boolean;
  filters?: Record<string, string[]>;
  paths?: string[];
  options?: GenerateOptionsMessage;
  [key: string]: unknown;
}

/**
 * Custom editor provider for FPGA IP core YAML files.
 *
 * Detects IP core files by checking for required keys: vlnv
 */
export class IpCoreEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('IpCoreEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly messageHandler: MessageHandler;
  private readonly documentManager: DocumentManager;
  private readonly importResolver: ImportResolver;
  private readonly subcoreResolver: SubcoreResolver;
  private readonly yamlValidator = new YamlValidator();

  constructor(private readonly context: vscode.ExtensionContext) {
    const services = createSharedProviderServices(context);
    this.htmlGenerator = services.htmlGenerator;
    this.messageHandler = services.messageHandler;
    this.documentManager = services.documentManager;
    this.importResolver = new ImportResolver(this.logger, context);
    this.subcoreResolver = new SubcoreResolver(context);
    void this.subcoreResolver.initialize();

    this.logger.info('IpCoreEditorProvider initialized');
  }

  /**
   * Check if a document is an IP core YAML file.
   *
   * Detection strategy: Check for required keys (vlnv)
   * This allows *.yml files to work while avoiding false positives.
   */
  private isIpCoreDocument(document: vscode.TextDocument): boolean {
    try {
      const text = document.getText();
      const parsed = jsyaml.load(text);

      if (!parsed || typeof parsed !== 'object') {
        return false;
      }

      // Check for IP core signature: vlnv is strictly required
      const data = parsed as Record<string, unknown>;
      return 'vlnv' in data && typeof data.vlnv === 'object';
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
      webviewPanel.webview.options = { enableScripts: false };
      webviewPanel.webview.html = createNotIpCoreHtml();
      return;
    }

    this.logger.info('Document is an IP core file');

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    // Set HTML content - use ipcore-specific HTML
    webviewPanel.webview.html = this.htmlGenerator.generateIpCoreHtml(webviewPanel.webview);

    let isDisposed = false;

    const updateWebview = async () => {
      await this.updateWebview(document, webviewPanel, () => isDisposed);
    };

    const changeDocumentSubscription = this.subscribeToDocumentChanges(document, updateWebview);
    const configSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ipcraft.busLibraryPaths')) {
        this.importResolver.clearCache();
        void updateWebview();
      }
      if (e.affectsConfiguration('ipcraft.generate.hdlLanguage')) {
        void updateWebview();
      }
      if (e.affectsConfiguration('ipcraft.toolbar.targets')) {
        void updateWebview();
      }
      if (e.affectsConfiguration('ipcraft.generate.bahonaviMethodology')) {
        void updateWebview();
      }
    });
    const fileWatcher = this.watchGeneratedFiles(document, updateWebview);
    this.registerDisposal(webviewPanel, () => {
      isDisposed = true;
      changeDocumentSubscription.dispose();
      configSubscription.dispose();
      fileWatcher.dispose();
    });
    this.registerWebviewMessageHandlers(document, webviewPanel, updateWebview);

    setTimeout(() => {
      void updateWebview();
    }, 100);
  }

  private subscribeToDocumentChanges(
    document: vscode.TextDocument,
    updateWebview: () => Promise<void>
  ): vscode.Disposable {
    return vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        void updateWebview();
      }
    });
  }

  private watchGeneratedFiles(
    document: vscode.TextDocument,
    updateWebview: () => Promise<void>
  ): vscode.Disposable {
    const baseDir = path.dirname(document.uri.fsPath);

    // Use name-agnostic globs: vlnv.name (used by the scaffolder) may differ from the filename.
    const patterns = [
      new vscode.RelativePattern(baseDir, 'xilinx/component.xml'),
      new vscode.RelativePattern(baseDir, 'altera/*_hw.tcl'),
      new vscode.RelativePattern(baseDir, 'xilinx/build/xpr/*.xpr'),
      new vscode.RelativePattern(baseDir, 'xilinx/build/ooc/*.xpr'),
      new vscode.RelativePattern(baseDir, 'altera/build/*.qpf'),
    ];

    const watchers = patterns.map((pattern) => {
      const w = vscode.workspace.createFileSystemWatcher(pattern);
      w.onDidCreate(() => void updateWebview());
      w.onDidChange(() => void updateWebview());
      w.onDidDelete(() => void updateWebview());
      return w;
    });

    return {
      dispose: () => {
        watchers.forEach((w) => {
          w.dispose();
        });
      },
    };
  }

  private registerDisposal(webviewPanel: vscode.WebviewPanel, onDispose: () => void): void {
    webviewPanel.onDidDispose(() => {
      onDispose();
      this.logger.debug('Webview panel disposed');
    });
  }

  private registerWebviewMessageHandlers(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    updateWebview: () => Promise<void>
  ): void {
    type MessageHandlerFn = (message: IpcMessage) => Promise<void>;

    const messageHandlers: Record<string, MessageHandlerFn> = {
      ready: async () => {
        this.logger.info('Webview ready, sending initial update');
        await updateWebview();
      },
      selectFiles: async (message) => {
        await this.handleSelectFilesMessage(message, document, webviewPanel);
      },
      checkFilesExist: async (message) => {
        await this.handleCheckFilesExistMessage(message, document, webviewPanel);
      },
      generate: async (message) => {
        await handleGenerateRequest({
          logger: this.logger,
          context: this.context,
          documentManager: this.documentManager,
          document,
          webview: webviewPanel.webview,
          message: message as GenerateRequestMessage,
          refreshWebview: updateWebview,
        });
      },
      saveCustomBusDefinition: async (message) => {
        await this.handleSaveCustomBusDefinition(message, document, webviewPanel);
      },
      command: async (message) => {
        if (message.command) {
          await vscode.commands.executeCommand(String(message.command), document.uri);
          void updateWebview();
        }
      },
      setHdlLanguage: async (message) => {
        const lang = message.language as string;
        if (lang !== 'vhdl' && lang !== 'systemverilog') {
          return;
        }
        const cfg = vscode.workspace.getConfiguration('ipcraft.generate');
        await cfg.update('hdlLanguage', lang, vscode.ConfigurationTarget.Global);
        // onDidChangeConfiguration fires updateWebview automatically
      },
      setToolbarTargets: async (message) => {
        const raw = message.targets;
        if (!Array.isArray(raw) || !raw.every((t) => typeof t === 'string')) {
          return;
        }
        const cfg = vscode.workspace.getConfiguration('ipcraft.toolbar');
        await cfg.update('targets', raw, vscode.ConfigurationTarget.Global);
        // onDidChangeConfiguration fires updateWebview automatically
      },
      setBahonaviMethodology: async (message) => {
        const enabled = message.enabled;
        if (typeof enabled !== 'boolean') {
          return;
        }
        const cfg = vscode.workspace.getConfiguration('ipcraft.generate');
        await cfg.update('bahonaviMethodology', enabled, vscode.ConfigurationTarget.Global);
        // onDidChangeConfiguration fires updateWebview automatically
      },
      openFile: async (message) => {
        await this.handleOpenFileMessage(message, document);
      },
      addSubcore: async () => {
        await this.handleAddSubcoreMessage(webviewPanel);
      },
      editInIpPackager: async () => {
        const componentXmlPath = path.join(
          path.dirname(document.uri.fsPath),
          'xilinx',
          'component.xml'
        );
        await editInIpPackagerCommand(vscode.Uri.file(componentXmlPath));
      },
      editInPlatformDesigner: async () => {
        const ipName = path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');
        const hwTclPath = path.join(
          path.dirname(document.uri.fsPath),
          'altera',
          `${ipName}_hw.tcl`
        );
        await editInPlatformDesignerCommand(vscode.Uri.file(hwTclPath));
      },
      openInVivado: async () => {
        const ipName = path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');
        const baseDir = path.dirname(document.uri.fsPath);
        const xprFull = path.join(baseDir, 'xilinx', 'build', 'xpr', `${ipName}.xpr`);
        const xprOoc = path.join(baseDir, 'xilinx', 'build', 'ooc', `${ipName}.xpr`);
        const xprPath = await fs
          .access(xprFull)
          .then(() => xprFull)
          .catch(() => xprOoc);
        await openInVivadoCommand(vscode.Uri.file(xprPath));
      },
      openInQuartus: async () => {
        const ipName = path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');
        const qpfPath = path.join(
          path.dirname(document.uri.fsPath),
          'altera',
          'build',
          `${ipName}.qpf`
        );
        await openInQuartusCommand(vscode.Uri.file(qpfPath));
      },
    };

    webviewPanel.webview.onDidReceiveMessage(async (message: IpcMessage) => {
      const handler = messageHandlers[message.type];
      if (handler) {
        await handler(message);
        return;
      }
      await this.messageHandler.handleMessage(message, document);
    });
  }

  private async updateWebview(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    isDisposed: () => boolean
  ): Promise<void> {
    if (isDisposed()) {
      this.logger.debug('Webview already disposed, skipping update');
      return;
    }

    try {
      const text = document.getText();
      const parsed = jsyaml.load(text);
      const baseDir = path.dirname(document.uri.fsPath);
      const imports = await this.importResolver.resolveImports(
        parsed as Record<string, unknown>,
        baseDir
      );

      // vlnv.name (lowercased) is the name the scaffolder uses for generated files,
      // which can differ from the .ip.yml filename.
      const parsedData = parsed as Record<string, unknown>;
      const vlnv = parsedData?.vlnv as Record<string, unknown> | undefined;
      const ipName =
        typeof vlnv?.name === 'string'
          ? vlnv.name.toLowerCase()
          : path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');

      const accessOk = (p: string) =>
        fs
          .access(p)
          .then(() => true)
          .catch(() => false);

      const existsAny = async (dir: string, pattern: RegExp): Promise<boolean> => {
        try {
          const entries = await fs.readdir(dir);
          return entries.some((e) => pattern.test(e));
        } catch {
          return false;
        }
      };

      // _run_ooc.tcl sources _project.tcl which creates the project in build/ooc/;
      // _run_xpr.tcl creates a separate full project in build/xpr/.
      // Both are valid "open in Vivado" targets.
      const [hasComponentXml, hasHwTcl, hasXprFull, hasXprOoc, hasQpf] = await Promise.all([
        accessOk(path.join(baseDir, 'xilinx', 'component.xml')),
        accessOk(path.join(baseDir, 'altera', `${ipName}_hw.tcl`)),
        existsAny(path.join(baseDir, 'xilinx', 'build', 'xpr'), /\.xpr$/),
        existsAny(path.join(baseDir, 'xilinx', 'build', 'ooc'), /\.xpr$/),
        existsAny(path.join(baseDir, 'altera', 'build'), /\.qpf$/),
      ]);
      const hasXpr = hasXprFull || hasXprOoc;

      if (isDisposed()) {
        this.logger.debug('Webview disposed during import resolution, skipping update');
        return;
      }

      const generateCfg = vscode.workspace.getConfiguration('ipcraft.generate');
      const hdlLanguage = generateCfg.get<string>('hdlLanguage', 'vhdl');
      const bahonaviMethodology = generateCfg.get<boolean>('bahonaviMethodology', false);

      const toolbarTargets = vscode.workspace
        .getConfiguration('ipcraft.toolbar')
        .get<string[]>('targets', ['vivado', 'quartus']);

      const allToolchains = listAll().map((t) => ({ id: t.id, displayName: t.displayName }));

      const duplicatePrefixes = this.yamlValidator.findDuplicatePhysicalPrefixes(parsed);

      void webviewPanel.webview.postMessage({
        type: 'update',
        text,
        fileName: path.basename(document.uri.fsPath),
        imports,
        hasComponentXml,
        hasHwTcl,
        hasXpr,
        hasQpf,
        hdlLanguage,
        bahonaviMethodology,
        toolbarTargets,
        allToolchains,
        duplicatePrefixes,
      });
    } catch (error) {
      this.logger.error('Failed to update webview', error as Error);
    }
  }

  private async handleSelectFilesMessage(
    message: IpcMessage,
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    this.logger.info('Opening file picker dialog');
    const baseDir = path.dirname(document.uri.fsPath);
    const startPath = message.startPath as string | undefined;
    const startDir = startPath
      ? path.dirname(path.isAbsolute(startPath) ? startPath : path.join(baseDir, startPath))
      : baseDir;
    const options: vscode.OpenDialogOptions = {
      canSelectMany: message.multi ?? true,
      openLabel: 'Select Files',
      canSelectFiles: true,
      canSelectFolders: false,
      filters: message.filters,
      defaultUri: vscode.Uri.file(startDir),
    };

    const fileUris = await vscode.window.showOpenDialog(options);
    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const relativePaths = fileUris.map((uri) => path.relative(baseDir, uri.fsPath));
    void webviewPanel.webview.postMessage({
      type: 'filesSelected',
      files: relativePaths,
    });
    this.logger.info(`Selected ${relativePaths.length} file(s)`);
  }

  private async handleSaveCustomBusDefinition(
    message: IpcMessage,
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const baseDir = path.dirname(document.uri.fsPath);
    const typeName = String(message.typeName ?? 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_');
    const displayName = String(message.displayName ?? typeName);
    const ports = (message.ports ?? []) as Array<Record<string, unknown>>;
    const version = '1.0';

    const customDir = path.join(baseDir, 'custom_bus_definitions');
    const customDirUri = vscode.Uri.file(customDir);
    try {
      await vscode.workspace.fs.createDirectory(customDirUri);
    } catch {
      // Directory already exists — ignore
    }

    // Build the YAML content matching the existing bus_definitions format.
    // Widths in the bus definition must be constant literals so the file can be
    // reused across IP cores without depending on any particular parameter name.
    // When the user configured a port width as a parameter reference (e.g. XCVR_DW),
    // the webview resolves its default value and sends it as `defaultWidth`.
    const portWidthOverrides: Record<string, unknown> = {};

    const portEntries = ports.map((p) => {
      const entry: Record<string, unknown> = {
        name: p.name,
        presence: p.presence ?? 'required',
      };
      if (p.direction) {
        entry.direction = p.direction;
      }
      const isParamRef =
        typeof p.width === 'string' && isNaN(Number(p.width)) && String(p.width).trim() !== '';
      if (isParamRef) {
        // Use the resolved default literal for the bus definition file …
        const literalWidth = p.defaultWidth !== undefined ? p.defaultWidth : 1;
        entry.width = literalWidth;
        // … and record the parameter override so the ip.yml is updated.
        portWidthOverrides[String(p.name)] = p.width;
      } else if (p.width !== undefined && p.width !== null && p.width !== '') {
        entry.width = p.width;
      }
      return entry;
    });

    const busDefObj = {
      [displayName]: {
        busType: {
          vendor: 'user',
          library: 'busif',
          name: typeName,
          version,
        },
        ports: portEntries,
      },
    };

    const jsyaml = await import('js-yaml');
    const yamlContent = jsyaml.dump(busDefObj, { indent: 2, lineWidth: 120 });

    const filePath = path.join(customDir, `${typeName}.yml`);
    const fileUri = vscode.Uri.file(filePath);
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(yamlContent, 'utf8'));
    this.logger.info(`Saved custom bus definition: ${filePath}`);

    // Notify webview — it will add useBusLibrary and portWidthOverrides to the IP core
    void webviewPanel.webview.postMessage({
      type: 'customBusDefinitionSaved',
      typeName,
      filePath: path.relative(baseDir, filePath),
      customBusLibraryDir: 'custom_bus_definitions',
      portWidthOverrides:
        Object.keys(portWidthOverrides).length > 0 ? portWidthOverrides : undefined,
    });

    // Invalidate bus library cache so the new file is picked up on next reload
    this.importResolver.clearCache();
  }

  private async handleOpenFileMessage(
    message: IpcMessage,
    document: vscode.TextDocument
  ): Promise<void> {
    const filePath = String(message.path ?? '');
    if (!filePath) {
      return;
    }
    const baseDir = path.dirname(document.uri.fsPath);
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
    try {
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absolutePath));
    } catch (error) {
      this.logger.error('Failed to open file', error as Error);
    }
  }

  private async handleAddSubcoreMessage(webviewPanel: vscode.WebviewPanel): Promise<void> {
    const candidates = this.subcoreResolver.getAvailableIps();

    const items: vscode.QuickPickItem[] = [];

    const workspaceIps = candidates.filter((c) => c.source === 'workspace');
    if (workspaceIps.length > 0) {
      items.push({ label: 'Workspace IPs', kind: vscode.QuickPickItemKind.Separator });
      items.push(
        ...workspaceIps.map((c) => ({
          label: c.vlnv,
          description: c.fsPath ? path.basename(c.fsPath) : undefined,
        }))
      );
    }

    const repoIps = candidates.filter((c) => c.source === 'user-repo');
    if (repoIps.length > 0) {
      items.push({ label: 'User IP Repositories', kind: vscode.QuickPickItemKind.Separator });
      items.push(...repoIps.map((c) => ({ label: c.vlnv, description: c.fsPath })));
    }

    const catalogIps = candidates.filter(
      (c) => c.source === 'vivado-catalog' || c.source === 'builtin'
    );
    if (catalogIps.length > 0) {
      items.push({ label: 'Vivado Catalog', kind: vscode.QuickPickItemKind.Separator });
      items.push(...catalogIps.map((c) => ({ label: c.vlnv })));
    }

    items.push({
      label: 'Enter custom VLNV...',
      kind: vscode.QuickPickItemKind.Default,
      description: 'vendor:library:name:version',
    });

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select an IP dependency (vendor:library:name:version)',
      matchOnDescription: true,
    });

    if (!selected) {
      return;
    }

    let vlnv: string;
    if (selected.label === 'Enter custom VLNV...') {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter VLNV (vendor:library:name:version)',
        placeHolder: 'xilinx.com:ip:fifo_generator:13.2',
        validateInput: (v) => (isValidVlnv(v) ? null : 'Format: vendor:library:name:version'),
      });
      if (!input) {
        return;
      }
      vlnv = input;
    } else {
      vlnv = selected.label;
    }

    void webviewPanel.webview.postMessage({ type: 'subcoreAdded', vlnv });
  }

  private async handleCheckFilesExistMessage(
    message: IpcMessage,
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const baseDir = path.dirname(document.uri.fsPath);
    const filePaths: string[] = message.paths ?? [];
    const results: Record<string, boolean> = {};

    for (const filePath of filePaths) {
      try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
        results[filePath] = true;
      } catch {
        results[filePath] = false;
      }
    }

    void webviewPanel.webview.postMessage({
      type: 'filesExistResult',
      results,
    });
    this.logger.debug(`Checked ${filePaths.length} file(s) for existence`);
  }
}
