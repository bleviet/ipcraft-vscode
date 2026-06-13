import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { parseHwTclFile } from '../parser/HwTclParser';
import { parseComponentXmlFile } from '../parser/ComponentXmlParser';
import { parseVhdlFile } from '../parser/VhdlParser';
import { parseVerilogFile } from '../parser/VerilogParser';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';
import { TemplateLoader } from '../generator/TemplateLoader';
import { ResourceRoots } from '../services/ResourceRoots';
import { resolveVendor } from '../utils/resolveVendor';
import { legacyVendorToTargets } from '../utils/migrateIpCore';
import type { GenerateOptionsMessage } from './IpCoreGenerateHandler';

type SourceKind = 'hwTcl' | 'componentXml' | 'vhdl' | 'verilog';

interface ParsedSource {
  yamlText: string;
  name: string;
}

interface GenerateMessage {
  options?: GenerateOptionsMessage;
}

function detectKind(fsPath: string): SourceKind | null {
  if (fsPath.endsWith('_hw.tcl')) {
    return 'hwTcl';
  }
  if (path.basename(fsPath) === 'component.xml') {
    return 'componentXml';
  }
  if (fsPath.endsWith('.vhd') || fsPath.endsWith('.vhdl')) {
    return 'vhdl';
  }
  if (fsPath.endsWith('.v') || fsPath.endsWith('.sv')) {
    return 'verilog';
  }
  return null;
}

async function parseSource(fsPath: string, kind: SourceKind): Promise<ParsedSource> {
  const cfg = vscode.workspace.getConfiguration('ipcraft.import');
  switch (kind) {
    case 'hwTcl': {
      const result = await parseHwTclFile(fsPath, {
        library: cfg.get<string>('library'),
        vendor: resolveVendor(cfg.get<string>('vendor')),
      });
      return { yamlText: result.yamlText, name: result.componentName };
    }
    case 'componentXml': {
      const result = await parseComponentXmlFile(fsPath, {
        library: cfg.get<string>('library'),
      });
      return { yamlText: result.ipYamlText, name: result.componentName };
    }
    case 'vhdl': {
      const result = await parseVhdlFile(fsPath, {
        detectBus: true,
        vendor: resolveVendor(cfg.get<string>('vendor')),
        library: cfg.get<string>('library'),
        version: cfg.get<string>('version'),
      });
      const baseName = path.basename(fsPath, path.extname(fsPath));
      return { yamlText: result.yamlText, name: result.entityName ?? baseName };
    }
    case 'verilog': {
      const result = await parseVerilogFile(fsPath, {
        detectBus: true,
        vendor: resolveVendor(cfg.get<string>('vendor')),
        library: cfg.get<string>('library'),
        version: cfg.get<string>('version'),
      });
      return { yamlText: result.yamlText, name: result.moduleName };
    }
  }
}

/**
 * Custom editor provider that shows a live IPCraft visual preview for source
 * files (_hw.tcl, component.xml, .vhd/.vhdl) without writing a .ip.yml to
 * disk first. Reuses the same webview and message protocol as IpCoreEditorProvider.
 */
export class IpCoreSourcePreviewProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('IpCoreSourcePreviewProvider');
  private readonly htmlGenerator: HtmlGenerator;

  private readonly resourceRoots: ResourceRoots;

  constructor(
    private readonly context: vscode.ExtensionContext,
    resourceRoots: ResourceRoots
  ) {
    this.htmlGenerator = new HtmlGenerator(context);
    this.resourceRoots = resourceRoots;
  }

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    const kind = detectKind(document.uri.fsPath);
    if (!kind) {
      webviewPanel.webview.options = { enableScripts: false };
      webviewPanel.webview.html = '<p>Unsupported file type for IPCraft preview.</p>';
      return;
    }

    webviewPanel.webview.options = { enableScripts: true };
    webviewPanel.webview.html = this.htmlGenerator.generateIpCoreHtml(webviewPanel.webview);

    this.showExperimentalPreviewNotice();

    let isDisposed = false;
    // Track the latest YAML — seeded from the parsed source, updated by webview edits
    let currentYaml = '';
    let componentName = path.basename(document.uri.fsPath, path.extname(document.uri.fsPath));

    const parseAndUpdate = async (): Promise<void> => {
      if (isDisposed) {
        return;
      }
      try {
        const parsed = await parseSource(document.uri.fsPath, kind);
        currentYaml = parsed.yamlText;
        componentName = parsed.name;
        void webviewPanel.webview.postMessage({
          type: 'update',
          text: currentYaml,
          fileName: path.basename(document.uri.fsPath),
          isPreview: true,
          hasComponentXml: false,
          hasHwTcl: false,
          hasXpr: false,
          hasQpf: false,
        });
      } catch (error) {
        this.logger.error('Failed to parse source for preview', error as Error);
      }
    };

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        void parseAndUpdate();
      }
    });

    webviewPanel.onDidDispose(() => {
      isDisposed = true;
      changeSubscription.dispose();
    });

    webviewPanel.webview.onDidReceiveMessage(
      async (message: { type: string; text?: string; options?: GenerateOptionsMessage }) => {
        switch (message.type) {
          case 'ready':
            await parseAndUpdate();
            break;
          case 'update':
            // User edited in the visual editor — track in memory, don't touch source file
            if (message.text) {
              currentYaml = message.text;
            }
            break;
          case 'generate':
            await this.handleGenerate(
              message as GenerateMessage,
              currentYaml,
              webviewPanel.webview
            );
            break;
          case 'saveAsIpYml':
            await this.handleSaveAsIpYml(document.uri, currentYaml, componentName);
            break;
        }
      }
    );

    // Handshake complete, initial parse triggers strictly on 'ready' message
  }

  private async handleGenerate(
    message: GenerateMessage,
    currentYaml: string,
    webview: vscode.Webview
  ): Promise<void> {
    const folderUris = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Select Output Folder',
      title: 'Select Output Directory for Generated Files',
    });

    if (!folderUris?.length) {
      void webview.postMessage({
        type: 'generateResult',
        success: false,
        error: 'No output directory selected',
      });
      return;
    }
    const outputDir = folderUris[0].fsPath;

    const tmpFile = path.join(os.tmpdir(), `ipcraft_preview_${Date.now()}.ip.yml`);
    await fs.writeFile(tmpFile, currentYaml, 'utf-8');

    try {
      const generator = new IpCoreScaffolder(
        this.logger,
        new TemplateLoader(this.logger, this.resourceRoots.templatesDir),
        this.resourceRoots
      );
      const result = await generator.generateAll(tmpFile, outputDir, {
        targets: legacyVendorToTargets(message.options?.vendorFiles ?? 'none'),
        includeTestbench: message.options?.includeTestbench !== false,
        includeRegs: message.options?.includeRegfile !== false,
        includeVhdl: message.options?.includeVhdl !== false,
        updateYaml: false,
      });

      if (!result.success) {
        void webview.postMessage({
          type: 'generateResult',
          success: false,
          error: result.error ?? 'Generation failed',
        });
        return;
      }

      const writtenFiles = result.files ? Object.keys(result.files) : [];
      void webview.postMessage({ type: 'generateResult', success: true, files: writtenFiles });

      const action = await vscode.window.showInformationMessage(
        `Generated ${writtenFiles.length} files to ${outputDir}`,
        'Open Folder'
      );
      if (action === 'Open Folder') {
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
      }
    } finally {
      await fs.unlink(tmpFile).catch(() => {});
    }
  }

  private async handleSaveAsIpYml(
    sourceUri: vscode.Uri,
    currentYaml: string,
    componentName: string
  ): Promise<void> {
    const dir = path.dirname(sourceUri.fsPath);
    const outputPath = path.join(dir, `${componentName}.ip.yml`);
    const outputUri = vscode.Uri.file(outputPath);
    await vscode.workspace.fs.writeFile(outputUri, Buffer.from(currentYaml, 'utf-8'));
    await vscode.commands.executeCommand('vscode.openWith', outputUri, 'fpgaIpCore.editor');
  }

  private showExperimentalPreviewNotice(): void {
    const KEY = 'ipcraft.hideExperimentalPreviewNotice';
    if (this.context.globalState.get<boolean>(KEY)) {
      return;
    }
    void this.context.globalState.update(KEY, true);
    void vscode.window.showInformationMessage(
      '⚠️ IPCraft source preview is experimental. The detected IP core structure may be ' +
        'incomplete for complex files. Use "Save as .ip.yml" to persist and refine the result.',
      'Got it'
    );
  }
}
