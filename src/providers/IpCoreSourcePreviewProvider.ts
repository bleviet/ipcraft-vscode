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
import { writeImportedFile, describeOutcome } from '../utils/importWrite';
import { legacyVendorToTargets } from '../utils/migrateIpCore';
import type { GenerateOptionsMessage } from './IpCoreGenerateHandler';

import { WebviewRouter } from '../services/WebviewRouter';
import { EDITOR_VIEW_TYPE_IP_CORE } from '../utils/editorViewTypes';
import { CONFIG_KEY_IPCRAFT_IMPORT } from '../utils/configKeys';

type SourceKind = 'hwTcl' | 'componentXml' | 'vhdl' | 'verilog';

interface ParsedSource {
  yamlText: string;
  name: string;
  /** Memory map YAML, when the source carried register definitions. */
  mmYamlText?: string;
  /** Filename the .ip.yml's `memoryMaps.import` points at (e.g. core.mm.yml). */
  mmFileName?: string;
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
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_IMPORT);
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
      return {
        yamlText: result.ipYamlText,
        name: result.componentName,
        mmYamlText: result.mmYamlText,
        mmFileName: result.mmFileName,
      };
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
    // Memory map extracted alongside the .ip.yml (component.xml with registers).
    // The .ip.yml references it via `memoryMaps.import`, so it must be written too.
    let currentMmYaml: string | undefined;
    let currentMmFileName: string | undefined;

    const router = new WebviewRouter({
      webviewPanel,
      document,
      logger: this.logger,
      onReady: async () => {
        await parseAndUpdate();
      },
    });

    const parseAndUpdate = async (): Promise<void> => {
      if (isDisposed) {
        return;
      }
      try {
        const parsed = await parseSource(document.uri.fsPath, kind);
        currentYaml = parsed.yamlText;
        componentName = parsed.name;
        currentMmYaml = parsed.mmYamlText;
        currentMmFileName = parsed.mmFileName;
        router.postUpdate({
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

    router.on('update', async (message: { text?: string }) => {
      if (message.text) {
        currentYaml = message.text;
      }
    });

    router.on('generate', async (message: GenerateMessage) => {
      await this.handleGenerate(message, currentYaml, webviewPanel.webview, {
        mmYamlText: currentMmYaml,
        mmFileName: currentMmFileName,
      });
    });

    router.on('saveAsIpYml', async () => {
      await this.handleSaveAsIpYml(document.uri, currentYaml, componentName, {
        mmYamlText: currentMmYaml,
        mmFileName: currentMmFileName,
      });
    });

    webviewPanel.onDidDispose(() => {
      isDisposed = true;
      changeSubscription.dispose();
      router.dispose();
    });
  }

  private async handleGenerate(
    message: GenerateMessage,
    currentYaml: string,
    webview: vscode.Webview,
    memoryMap?: { mmYamlText?: string; mmFileName?: string }
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

    // Use a unique temp directory so the memory map can sit beside the .ip.yml
    // under the exact name its `memoryMaps.import` references — otherwise the
    // scaffolder cannot resolve registers and silently skips the register file.
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft_preview_'));
    const tmpFile = path.join(tmpDir, 'preview.ip.yml');
    await fs.writeFile(tmpFile, currentYaml, 'utf-8');
    if (memoryMap?.mmYamlText && memoryMap.mmFileName) {
      await fs.writeFile(path.join(tmpDir, memoryMap.mmFileName), memoryMap.mmYamlText, 'utf-8');
    }

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
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async handleSaveAsIpYml(
    sourceUri: vscode.Uri,
    currentYaml: string,
    componentName: string,
    memoryMap?: { mmYamlText?: string; mmFileName?: string }
  ): Promise<void> {
    const dir = path.dirname(sourceUri.fsPath);
    const outputPath = path.join(dir, `${componentName}.ip.yml`);
    const outputUri = vscode.Uri.file(outputPath);
    const ipOutcome = await writeImportedFile(outputUri, currentYaml);

    // The .ip.yml references the memory map via `memoryMaps.import`, so it must
    // be written alongside or the reference dangles. Never clobber user edits.
    if (memoryMap?.mmYamlText && memoryMap.mmFileName) {
      const mmUri = vscode.Uri.file(path.join(dir, memoryMap.mmFileName));
      const mmOutcome = await writeImportedFile(mmUri, memoryMap.mmYamlText);
      void vscode.window.showInformationMessage(
        `${describeOutcome(`${componentName}.ip.yml`, ipOutcome)}, ` +
          `${describeOutcome(memoryMap.mmFileName, mmOutcome)}.`
      );
    }

    // 'merged' means the merge editor is now open on the .ip.yml; opening the
    // custom visual editor would replace it before the user can resolve.
    if (ipOutcome !== 'merged') {
      await vscode.commands.executeCommand('vscode.openWith', outputUri, EDITOR_VIEW_TYPE_IP_CORE);
    }
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
