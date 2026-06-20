import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as jsyaml from 'js-yaml';
import * as YAML from 'yaml';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { WebviewRouter } from '../services/WebviewRouter';
import { YamlValidator } from '../services/YamlValidator';
import { DocumentManager } from '../services/DocumentManager';
import { ImportResolver } from '../services/ImportResolver';
import { getWorkspaceBusDefinitionScanner } from '../services/WorkspaceBusDefinitionScanner';
import { SubcoreResolver } from '../services/SubcoreResolver';
import { isValidVlnv } from '../utils/vlnv';
import { createNotIpCoreHtml } from './ipCoreErrorHtml';
import { createSharedProviderServices } from './providerServices';
import { handleGenerateRequest } from './IpCoreGenerateHandler';
import {
  IpCoreWebviewMessage,
  GenerateRequestMessage,
  GenerateOptionsMessage,
} from '../shared/messages/ipCore';
import { WebviewStagingBridge } from './WebviewStagingBridge';
import { STAGING_SCHEME } from './StagingContentProvider';
import { editInIpPackagerCommand } from '../commands/editInIpPackager';
import { editInPlatformDesignerCommand } from '../commands/editInPlatformDesigner';
import { openInVivadoCommand } from '../commands/openInVivado';
import { openInQuartusCommand } from '../commands/openInQuartus';
import { listAll } from '../services/toolchains/registry';
import { ScaffoldPackLoader } from '../generator/ScaffoldPackLoader';
import { ResourceRoots } from '../services/ResourceRoots';

interface IpcMessage {
  type: string;
  multi?: boolean;
  filters?: Record<string, string[]>;
  paths?: string[];
  options?: GenerateOptionsMessage;
  [key: string]: unknown;
}

/**
 * Commands the IP Core webview may invoke through the generic `command` message
 * bridge. The bundle is our own code, but a string-keyed dispatch to *any*
 * command is a capability we don't need — an explicit allow-list bounds the
 * blast radius if the bundle is ever compromised or a future message is
 * mishandled. Keep in sync with the `command="fpga-ip-core.*"` toolbar buttons
 * in `src/webview/ipcore/IpCoreApp.tsx`.
 */
const WEBVIEW_COMMAND_ALLOWLIST = new Set<string>([
  'fpga-ip-core.scaffoldProject',
  'fpga-ip-core.createMemoryMap',
  'fpga-ip-core.generateHdl',
  'fpga-ip-core.generateTestbench',
  'fpga-ip-core.exportAltera',
  'fpga-ip-core.exportXilinx',
  'fpga-ip-core.generateVivadoProject',
  'fpga-ip-core.generateQuartusProject',
  'fpga-ip-core.buildVivadoOoc',
  'fpga-ip-core.buildQuartusCompile',
  'fpga-ip-core.openSettings',
]);

/**
 * Custom editor provider for FPGA IP core YAML files.
 *
 * Detects IP core files by checking for required keys: vlnv
 */
export class IpCoreEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('IpCoreEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly documentManager: DocumentManager;
  private readonly importResolver: ImportResolver;
  private readonly subcoreResolver: SubcoreResolver;
  private readonly yamlValidator = new YamlValidator();

  private readonly resourceRoots: ResourceRoots;

  constructor(
    private readonly context: vscode.ExtensionContext,
    resourceRoots: ResourceRoots
  ) {
    this.resourceRoots = resourceRoots;
    const services = createSharedProviderServices(context);
    this.htmlGenerator = services.htmlGenerator;
    this.documentManager = services.documentManager;
    this.importResolver = new ImportResolver(this.logger, resourceRoots.busDefinitionsDir);
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
   * Restrict webview resource loading to the bundle output and codicons only,
   * instead of the default that grants read access to every workspace folder.
   */
  private getLocalResourceRoots(): vscode.Uri[] {
    return [
      vscode.Uri.joinPath(this.context.extensionUri, 'dist'),
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons'),
    ];
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
      webviewPanel.webview.options = {
        enableScripts: false,
        localResourceRoots: this.getLocalResourceRoots(),
      };
      webviewPanel.webview.html = createNotIpCoreHtml();
      return;
    }

    this.logger.info('Document is an IP core file');

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    };

    // Set HTML content - use ipcore-specific HTML
    webviewPanel.webview.html = this.htmlGenerator.generateIpCoreHtml(webviewPanel.webview);

    let isDisposed = false;

    const router = new WebviewRouter<IpCoreWebviewMessage>({
      webviewPanel,
      document,
      logger: this.logger,
      commandAllowlist: WEBVIEW_COMMAND_ALLOWLIST,
      onReady: async () => {
        await updateWebview();
      },
    });

    const updateWebview = async (sourceEditId?: number, forceResync = false) => {
      if (isDisposed) {
        return;
      }
      await this.updateWebview(document, router, () => isDisposed, sourceEditId, forceResync);
    };

    router.useStandardDocumentHandlers(this.documentManager, this.yamlValidator, () => {
      void updateWebview(undefined, true);
    });

    const changeDocumentSubscription = this.subscribeToDocumentChanges(
      document,
      router,
      updateWebview
    );
    const configSubscription = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('ipcraft.busLibraryPaths')) {
        this.importResolver.clearCache();
        void updateWebview(undefined, true);
      }
      if (e.affectsConfiguration('ipcraft.generate.hdlLanguage')) {
        void updateWebview(undefined, true);
      }
      if (e.affectsConfiguration('ipcraft.toolbar.targets')) {
        void updateWebview(undefined, true);
      }
      if (e.affectsConfiguration('ipcraft.generate.scaffoldPack')) {
        void updateWebview(undefined, true);
      }
    });
    // Refresh when workspace bus definitions are re-scanned, so the Inspector
    // picks up newly discovered (or removed) workspace bus definitions without
    // requiring the user to re-open the editor.
    const workspaceBusDefSubscription = getWorkspaceBusDefinitionScanner().onDidScan(() => {
      this.importResolver.clearCache();
      void updateWebview(undefined, true);
    });
    const fileWatcher = this.watchGeneratedFiles(document, () => updateWebview(undefined, true));
    this.registerDisposal(webviewPanel, () => {
      isDisposed = true;
      changeDocumentSubscription.dispose();
      configSubscription.dispose();
      workspaceBusDefSubscription.dispose();
      fileWatcher.dispose();
      router.dispose();
    });
    this.registerWebviewMessageHandlers(document, webviewPanel, router, updateWebview);
    WebviewStagingBridge.getInstance().register(document.uri.fsPath, webviewPanel);
  }

  private subscribeToDocumentChanges(
    document: vscode.TextDocument,
    router: WebviewRouter<IpCoreWebviewMessage>,
    updateWebview: (sourceEditId?: number) => Promise<void>
  ): vscode.Disposable {
    return vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        const sourceEditId = router.popSourceEditId();
        void updateWebview(sourceEditId);
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
    router: WebviewRouter<IpCoreWebviewMessage>,
    updateWebview: (sourceEditId?: number) => Promise<void>
  ): void {
    // Shared column for staging diff/preview actions. Pinned after the first open so
    // every subsequent View Diff / Preview reuses the same tab instead of opening new ones.
    let stagingSideColumn: vscode.ViewColumn | undefined;

    router.on('selectFiles', async (message) => {
      await this.handleSelectFilesMessage(message, document, webviewPanel);
    });

    router.on('checkFilesExist', async (message) => {
      await this.handleCheckFilesExistMessage(message, document, webviewPanel);
    });

    router.on('generate', async (message) => {
      await handleGenerateRequest({
        logger: this.logger,
        resourceRoots: this.resourceRoots,
        documentManager: this.documentManager,
        document,
        webview: webviewPanel.webview,
        message: message as GenerateRequestMessage,
        refreshWebview: updateWebview,
      });
    });

    router.on('saveCustomBusDefinition', async (message) => {
      await this.handleSaveCustomBusDefinition(message, document, webviewPanel);
    });

    // This overrides the standard `command` handler registered by
    // `useStandardDocumentHandlers`: the IP Core webview only uses `command` to
    // invoke allow-listed VS Code command IDs. File opening uses the dedicated
    // `openFile` message (handled below), and save/validate are not sent here.
    router.on('command', async (message) => {
      const cmd = String(message.command ?? '');
      if (!WEBVIEW_COMMAND_ALLOWLIST.has(cmd)) {
        this.logger.warn(`Blocked non-allowlisted webview command: ${cmd}`);
        return;
      }
      await vscode.commands.executeCommand(cmd, document.uri);
      void updateWebview();
    });

    router.on('setHdlLanguage', async (message) => {
      const lang = message.language;
      if (lang !== 'vhdl' && lang !== 'systemverilog') {
        return;
      }
      const cfg = vscode.workspace.getConfiguration('ipcraft.generate');
      await cfg.update('hdlLanguage', lang, vscode.ConfigurationTarget.Global);
    });

    router.on('setToolbarTargets', async (message) => {
      const raw = message.targets;
      if (!Array.isArray(raw) || !raw.every((t) => typeof t === 'string')) {
        return;
      }
      const cfg = vscode.workspace.getConfiguration('ipcraft.toolbar');
      await cfg.update('targets', raw, vscode.ConfigurationTarget.Global);
    });

    router.on('setScaffoldPack', async (message) => {
      const packName = message.packName;
      if (typeof packName !== 'string') {
        return;
      }
      await this.writeScaffoldPackToDocument(document, packName);
      const cfg = vscode.workspace.getConfiguration('ipcraft.generate');
      await cfg.update('scaffoldPack', packName, vscode.ConfigurationTarget.Global);
    });

    router.on('openScaffoldPacksWalkthrough', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        'bleviet.ipcraft-vscode#scaffold-packs-getting-started',
        false
      );
    });

    router.on('openWalkthroughMenu', async () => {
      await vscode.commands.executeCommand('fpga-ip-core.openWalkthroughMenu');
    });

    router.on('openFile', async (message) => {
      await this.handleOpenFileMessage(message, document);
    });

    router.on('addSubcore', async () => {
      await this.handleAddSubcoreMessage(webviewPanel);
    });

    router.on('editInIpPackager', async () => {
      const componentXmlPath = path.join(
        path.dirname(document.uri.fsPath),
        'xilinx',
        'component.xml'
      );
      await editInIpPackagerCommand(vscode.Uri.file(componentXmlPath));
    });

    router.on('editInPlatformDesigner', async () => {
      const ipName = path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');
      const hwTclPath = path.join(path.dirname(document.uri.fsPath), 'altera', `${ipName}_hw.tcl`);
      await editInPlatformDesignerCommand(vscode.Uri.file(hwTclPath));
    });

    router.on('openInVivado', async () => {
      const ipName = path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');
      const baseDir = path.dirname(document.uri.fsPath);
      const xprFull = path.join(baseDir, 'xilinx', 'build', 'xpr', `${ipName}.xpr`);
      const xprOoc = path.join(baseDir, 'xilinx', 'build', 'ooc', `${ipName}.xpr`);
      const xprPath = await fs
        .access(xprFull)
        .then(() => xprFull)
        .catch(() => xprOoc);
      await openInVivadoCommand(vscode.Uri.file(xprPath));
    });

    router.on('openInQuartus', async () => {
      const ipName = path.basename(document.uri.fsPath).replace(/\.ip\.ya?ml$/, '');
      const qpfPath = path.join(
        path.dirname(document.uri.fsPath),
        'altera',
        'build',
        `${ipName}.qpf`
      );
      await openInQuartusCommand(vscode.Uri.file(qpfPath));
    });

    router.on('stagingResult', async (message) => {
      stagingSideColumn = undefined;
      WebviewStagingBridge.getInstance().resolveStaging(document.uri.fsPath, message.confirmed);
    });

    router.on('stagingAction', async (message) => {
      const files = WebviewStagingBridge.getInstance().getFiles(document.uri.fsPath);
      if (!files) {
        return;
      }
      const relativePath = String(message.relativePath ?? '');
      const file = files.find((f) => f.relativePath === relativePath);
      if (!file) {
        return;
      }
      if (message.action === 'viewDiff') {
        const diskUri = vscode.Uri.file(file.diskPath);
        const generatedUri = vscode.Uri.from({
          scheme: STAGING_SCHEME,
          path: `/${file.relativePath}`,
        });
        const filename = generatedUri.path.split('/').pop() ?? file.relativePath;
        const diffEditor = await vscode.commands.executeCommand<vscode.TextEditor | undefined>(
          'vscode.diff',
          diskUri,
          generatedUri,
          `${filename}: Current ↔ Generated`,
          { preview: true, viewColumn: stagingSideColumn ?? vscode.ViewColumn.Beside }
        );
        if (diffEditor?.viewColumn !== undefined) {
          stagingSideColumn = diffEditor.viewColumn;
        }
      } else if (message.action === 'viewPreview') {
        const generatedUri = vscode.Uri.from({
          scheme: STAGING_SCHEME,
          path: `/${file.relativePath}`,
        });
        const doc = await vscode.workspace.openTextDocument(generatedUri);
        const editor = await vscode.window.showTextDocument(doc, {
          preview: true,
          viewColumn: stagingSideColumn ?? vscode.ViewColumn.Beside,
        });
        if (editor.viewColumn !== undefined) {
          stagingSideColumn = editor.viewColumn;
        }
      }
    });
  }

  private async updateWebview(
    document: vscode.TextDocument,
    router: WebviewRouter<IpCoreWebviewMessage>,
    isDisposed: () => boolean,
    sourceEditId?: number,
    forceResync = false
  ): Promise<void> {
    if (isDisposed()) {
      this.logger.debug('Webview already disposed, skipping update');
      return;
    }

    try {
      const text = document.getText();
      // Capture the version now, alongside the text, so the async work below
      // (import resolution, fs stats) can't let a concurrent edit bump the live
      // version and desync the docVersion we stamp on this text.
      const docVersion = document.version;
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
      // Cascade: .ip.yml scaffold_pack > workspace setting > default
      const yamlScaffoldPack =
        typeof parsedData.scaffold_pack === 'string' ? parsedData.scaffold_pack : undefined;
      const scaffoldPack =
        yamlScaffoldPack ?? (generateCfg.get<string>('scaffoldPack', '') || 'builtin-minimal');
      const availableScaffoldPacks = collectAvailableScaffoldPacks(
        this.resourceRoots.builtinPacksDir
      );

      const toolbarTargets = vscode.workspace
        .getConfiguration('ipcraft.toolbar')
        .get<string[]>('targets', ['vivado', 'quartus']);

      const allToolchains = listAll().map((t) => ({ id: t.id, displayName: t.displayName }));

      const duplicatePrefixes = this.yamlValidator.findDuplicatePhysicalPrefixes(parsed);

      router.postUpdate(
        {
          text,
          fileName: path.basename(document.uri.fsPath),
          imports,
          hasComponentXml,
          hasHwTcl,
          hasXpr,
          hasQpf,
          hdlLanguage,
          scaffoldPack,
          availableScaffoldPacks,
          toolbarTargets,
          allToolchains,
          duplicatePrefixes,
          sourceEditId,
          ...(forceResync ? { forceResync: true } : {}),
        },
        docVersion
      );
    } catch (error) {
      this.logger.error('Failed to update webview', error as Error);
    }
  }

  private async writeScaffoldPackToDocument(
    document: vscode.TextDocument,
    packName: string
  ): Promise<void> {
    try {
      const doc = YAML.parseDocument(document.getText());
      doc.set('scaffold_pack', packName);
      const newText = doc.toString();
      const edit = new vscode.WorkspaceEdit();
      const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
      edit.replace(
        document.uri,
        new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
        newText
      );
      await vscode.workspace.applyEdit(edit);
      await document.save();
    } catch (error) {
      this.logger.error('Failed to write scaffold_pack to document', error as Error);
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

    // For .mm.yml files, also extract the first map's `name` field from the
    // file content so the webview can use the canonical name instead of the filename.
    const memoryMapNames: Record<string, string> = {};
    for (const uri of fileUris) {
      const relPath = path.relative(baseDir, uri.fsPath);
      if (relPath.endsWith('.mm.yml') || relPath.endsWith('.mm.yaml')) {
        try {
          const content = await fs.readFile(uri.fsPath, 'utf8');
          const parsed: unknown = jsyaml.load(content);
          const first: unknown = Array.isArray(parsed) ? parsed[0] : parsed;
          const mapName = (first as Record<string, unknown>)?.name;
          if (mapName && typeof mapName === 'string') {
            memoryMapNames[relPath] = mapName;
          }
        } catch {
          // If the file can't be read/parsed, fall back to filename-derived name on the webview side
        }
      }
    }

    void webviewPanel.webview.postMessage({
      type: 'filesSelected',
      files: relativePaths,
      memoryMapNames,
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
    const absolutePath = path.normalize(
      path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath)
    );
    if (!isWithinWorkspace(absolutePath)) {
      this.logger.warn(`Blocked webview open request outside workspace: ${absolutePath}`);
      return;
    }
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
      const fullPath = path.normalize(
        path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath)
      );
      if (!isWithinWorkspace(fullPath)) {
        this.logger.warn(`Blocked webview stat request outside workspace: ${fullPath}`);
        results[filePath] = false;
        continue;
      }
      try {
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

// ---------------------------------------------------------------------------
// Path-safety helper
// ---------------------------------------------------------------------------

/**
 * Returns true only when `absolutePath` is under at least one workspace folder
 * (after `path.normalize`, so `../` traversal is already collapsed before the
 * check). An empty workspace (no open folder) rejects every path.
 */
function isWithinWorkspace(absolutePath: string): boolean {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return false;
  }
  const normalized = absolutePath.endsWith(path.sep) ? absolutePath : absolutePath + path.sep;
  return folders.some((f) => {
    const root = f.uri.fsPath.endsWith(path.sep) ? f.uri.fsPath : f.uri.fsPath + path.sep;
    return normalized.startsWith(root);
  });
}

// ---------------------------------------------------------------------------
// Scaffold pack discovery — module-level helper (no class state needed)
// ---------------------------------------------------------------------------

interface PackSummaryForWebview {
  id: string;
  label: string;
  description: string;
  category: string;
}

/** Derive a short human-readable label from a pack directory name. */
function packLabel(id: string): string {
  return id
    .replace(/^(builtin|example)-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Collect all scaffold packs visible to the current workspace:
 *  1. Built-in packs from the extension bundle
 *  2. Workspace packs from .vscode/ipcraft/packs/
 */
function collectAvailableScaffoldPacks(builtinPacksDir: string): PackSummaryForWebview[] {
  const result: PackSummaryForWebview[] = [];

  const loadDir = (dir: string, defaultCategory: string) => {
    if (!fsSync.existsSync(dir)) {
      return;
    }
    let entries: string[];
    try {
      entries = fsSync.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const manifestPath = path.join(dir, entry, 'scaffold.yml');
      if (!fsSync.existsSync(manifestPath)) {
        continue;
      }
      try {
        const pack = ScaffoldPackLoader.load(path.join(dir, entry));
        result.push({
          id: entry,
          label: packLabel(entry),
          description: pack.description?.split('\n')[0].trim() ?? '',
          category: pack.category ?? defaultCategory,
        });
      } catch {
        // malformed pack — skip
      }
    }
  };

  loadDir(builtinPacksDir, 'builtin');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    loadDir(path.join(workspaceRoot, '.vscode', 'ipcraft', 'packs'), 'workspace');
  }

  return result;
}
