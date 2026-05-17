/**
 * VS Code Commands for VHDL Code Generation
 *
 * Provides commands to generate VHDL files from IP core definitions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';
import { parseVhdlFile } from '../parser/VhdlParser';
import { parseHwTclFile } from '../parser/HwTclParser';
import { parseComponentXmlFile } from '../parser/ComponentXmlParser';
import { pickVivadoPart, pickQuartusDevice } from '../utils/pickBoard';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { updateFileSets } from '../services/FileSetUpdater';
import { resolveVendor } from '../utils/resolveVendor';
import type { GenerateOptions } from '../generator/types';

const logger = new Logger('GenerateCommands');

/**
 * Register all generator commands with VS Code
 */

export function registerGeneratorCommands(context: vscode.ExtensionContext): void {
  safeRegisterCommand(context, 'fpga-ip-core.generateVHDL', async () => {
    await generateVHDL(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.scaffoldProject', async () => {
    await scaffoldProject(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.exportAltera', async () => {
    await exportAltera(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.exportXilinx', async () => {
    await exportXilinx(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateVivadoProject', async () => {
    await generateVivadoProject(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateQuartusProject', async () => {
    await generateQuartusProject(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateTestbench', async () => {
    await generateTestbench(context);
  });

  safeRegisterCommand(context, 'fpga-ip-core.parseVHDL', async (uri?: vscode.Uri) => {
    await parseVHDL(uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.parseHwTcl', async (uri?: vscode.Uri) => {
    await parseHwTcl(uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.parseComponentXml', async (uri?: vscode.Uri) => {
    await parseComponentXml(uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.viewBusDefinitions', async () => {
    await viewBusDefinitions(context);
  });
}

/**
 * Let the user pick a bus definition file and open it in a read-only editor tab
 */
async function viewBusDefinitions(context: vscode.ExtensionContext): Promise<void> {
  const busDirPath = path.join(context.extensionPath, 'dist', 'resources', 'bus_definitions');
  const dirUri = vscode.Uri.file(busDirPath);

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(dirUri);
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to open bus definitions: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const ymlFiles = entries
    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.yml'))
    .map(([name]) => name)
    .sort();

  if (ymlFiles.length === 0) {
    void vscode.window.showInformationMessage('No bus definitions found.');
    return;
  }

  const selected = await vscode.window.showQuickPick(ymlFiles, {
    placeHolder: 'Select a bus definition to view',
    title: 'Bus Definitions',
  });

  if (!selected) {
    return;
  }

  const uri = vscode.Uri.file(path.join(busDirPath, selected));
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      preserveFocus: false,
    });
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Failed to open bus definition: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function isIpCoreFile(fsPath: string): boolean {
  return fsPath.endsWith('.ip.yml') || fsPath.endsWith('.ip.yaml');
}

function getActiveIpCoreFile(): vscode.Uri | undefined {
  // Text editor active (e.g. YAML opened as raw text)
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    if (isIpCoreFile(editor.document.fileName)) {
      return editor.document.uri;
    }
    void vscode.window.showErrorMessage('Active file is not an IP core file (*.ip.yml).');
    return undefined;
  }

  // Custom editor active (IP Core Visual Editor webview)
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab?.input instanceof vscode.TabInputCustom) {
    const { uri } = activeTab.input;
    if (isIpCoreFile(uri.fsPath)) {
      return uri;
    }
  }

  void vscode.window.showErrorMessage('No active IP core file. Please open a .ip.yml file.');
  return undefined;
}

async function generateVHDL(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const outputDir = await pickOutputDir(ipCoreUri, 'Select output directory for VHDL files');
  if (!outputDir) {
    return;
  }
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'none',
      includeVhdl: true,
      includeRegs: true,
      updateYaml: true,
      silent: true,
    },
    'Generating VHDL...'
  );
}

async function scaffoldProject(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);

  let dirExists = false;
  try {
    await vscode.workspace.fs.stat(vscode.Uri.file(outputDir));
    dirExists = true;
  } catch {
    // directory does not exist yet — will be created by the generator
  }

  if (dirExists) {
    const answer = await vscode.window.showWarningMessage(
      `Output directory already exists. Overwrite contents?`,
      { modal: true },
      'Overwrite'
    );
    if (answer !== 'Overwrite') {
      return;
    }
  }

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const genCfg = vscode.workspace.getConfiguration('ipcraft.generate');
  const includeTestbench = genCfg.get<boolean>('includeTestbench', true);

  const targetPart = await pickVivadoPart(
    context,
    cfg.get<string>('vivado.defaultPart', 'xc7z020clg484-1')
  );
  if (!targetPart) {
    return;
  }

  const quartusDevice = await pickQuartusDevice(
    context,
    cfg.get<string>('quartus.defaultDevice', '5CSEBA6U23I7')
  );
  if (!quartusDevice) {
    return;
  }

  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'both',
      includeVhdl: true,
      includeRegs: true,
      includeTestbench,
      includeVivadoProject: true,
      targetPart,
      includeQuartusProject: true,
      quartusDevice,
      updateYaml: true,
      silent: true,
    },
    'Scaffolding project...'
  );
}

async function exportAltera(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'altera',
      includeVhdl: false,
      includeRegs: false,
      silent: true,
    },
    'Exporting Altera Platform Designer component...'
  );
}

async function exportXilinx(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'xilinx',
      includeVhdl: false,
      includeRegs: false,
      silent: true,
    },
    'Exporting Xilinx Vivado component...'
  );
}

async function generateTestbench(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'none',
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: true,
      silent: true,
    },
    'Generating CocoTB testbench...'
  );
}

async function generateVivadoProject(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const targetPart = await pickVivadoPart(
    context,
    cfg.get<string>('vivado.defaultPart', 'xc7z020clg484-1')
  );
  if (!targetPart) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'none',
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeVivadoProject: true,
      targetPart,
      silent: true,
    },
    'Generating Vivado project...'
  );
}

async function generateQuartusProject(context: vscode.ExtensionContext): Promise<void> {
  const ipCoreUri = getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const quartusDevice = await pickQuartusDevice(
    context,
    cfg.get<string>('quartus.defaultDevice', '5CSEBA6U23I7')
  );
  if (!quartusDevice) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      vendor: 'none',
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeQuartusProject: true,
      quartusDevice,
      silent: true,
    },
    'Generating Quartus project...'
  );
}

async function pickOutputDir(ipCoreUri: vscode.Uri, title: string): Promise<string | undefined> {
  const defaultDir = path.dirname(ipCoreUri.fsPath);
  const picked = await vscode.window.showOpenDialog({
    defaultUri: vscode.Uri.file(defaultDir),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Select Directory',
    title,
  });
  return picked?.[0]?.fsPath ?? defaultDir;
}

async function runGenerator(
  context: vscode.ExtensionContext,
  ipCoreUri: vscode.Uri,
  outputDir: string,
  options: GenerateOptions & { updateYaml?: boolean; silent?: boolean },
  progressTitle: string
): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
    async () => {
      const generator = new IpCoreScaffolder(logger, new TemplateLoader(logger), context);
      const result = await generator.generateAll(ipCoreUri.fsPath, outputDir, options);

      if (result.success) {
        if (options.updateYaml && result.files) {
          await updateFileSetsInYaml(ipCoreUri, outputDir, Object.keys(result.files));
        }
        if (options.silent) {
          return;
        }
        const action = await vscode.window.showInformationMessage(
          `✓ Generated ${String(result.count)} files`,
          'Open Folder'
        );
        if (action === 'Open Folder') {
          await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
        }
      } else {
        void vscode.window.showErrorMessage(`Generation failed: ${String(result.error)}`);
      }
    }
  );
}

/**
 * Parse VHDL file and generate IP core YAML
 */
async function parseVHDL(resourceUri?: vscode.Uri): Promise<void> {
  // Get VHDL file URI from context menu or active editor
  let vhdlUri = resourceUri;

  if (!vhdlUri) {
    const editor = vscode.window.activeTextEditor;
    if (
      editor &&
      (editor.document.fileName.endsWith('.vhd') || editor.document.fileName.endsWith('.vhdl'))
    ) {
      vhdlUri = editor.document.uri;
    }
  }

  if (!vhdlUri) {
    // Show file picker
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'VHDL Files': ['vhd', 'vhdl'] },
      title: 'Select VHDL file to parse',
    });
    vhdlUri = files?.[0];
  }

  if (!vhdlUri) {
    return;
  }

  // Generate output path (.ip.yml next to .vhd)
  const vhdlPath = vhdlUri.fsPath;
  const baseName = path.basename(vhdlPath, path.extname(vhdlPath));
  const outputDir = path.dirname(vhdlPath);
  const defaultOutput = path.join(outputDir, `${baseName}.ip.yml`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating IP Core from VHDL...',
      cancellable: false,
    },
    async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('ipcraft.import');
        const result = await parseVhdlFile(vhdlPath, {
          detectBus: true,
          vendor: cfg.get<string>('vendor'),
          library: cfg.get<string>('library'),
          version: cfg.get<string>('version'),
        });

        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(defaultOutput),
          encoder.encode(result.yamlText)
        );

        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(defaultOutput),
          'fpgaIpCore.editor'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Parse failed: ${message}`);
      }
    }
  );
}

/**
 * Parse Platform Designer _hw.tcl file and generate IP core YAML
 */
async function parseHwTcl(resourceUri?: vscode.Uri): Promise<void> {
  let tclUri = resourceUri;

  if (!tclUri) {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.fileName.endsWith('.tcl')) {
      tclUri = editor.document.uri;
    }
  }

  if (!tclUri) {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'Platform Designer Component': ['tcl'] },
      title: 'Select Platform Designer _hw.tcl file',
    });
    tclUri = files?.[0];
  }

  if (!tclUri) {
    return;
  }

  const tclPath = tclUri.fsPath;
  const baseName = path
    .basename(tclPath)
    .replace(/_hw\.tcl$/i, '')
    .replace(/\.tcl$/i, '');
  const outputDir = path.dirname(tclPath);
  const outputPath = path.join(outputDir, `${baseName}.ip.yml`);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Importing from Platform Designer component...',
      cancellable: false,
    },
    async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('ipcraft.import');
        const result = await parseHwTclFile(tclPath, {
          library: cfg.get<string>('library'),
          vendor: resolveVendor(cfg.get<string>('vendor')),
        });

        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(outputPath),
          encoder.encode(result.yamlText)
        );

        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(outputPath),
          'fpgaIpCore.editor'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Import failed: ${message}`);
      }
    }
  );
}

async function parseComponentXml(resourceUri?: vscode.Uri): Promise<void> {
  let xmlUri = resourceUri;

  if (!xmlUri) {
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.fileName.endsWith('component.xml')) {
      xmlUri = editor.document.uri;
    }
  }

  if (!xmlUri) {
    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      filters: { 'Vivado IP-XACT Component': ['xml'] },
      title: 'Select Xilinx component.xml file',
    });
    xmlUri = files?.[0];
  }

  if (!xmlUri) {
    return;
  }

  const xmlPath = xmlUri.fsPath;
  const outputDir = path.dirname(xmlPath);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Importing from Xilinx component.xml...',
      cancellable: false,
    },
    async () => {
      try {
        const cfg = vscode.workspace.getConfiguration('ipcraft.import');
        const result = await parseComponentXmlFile(xmlPath, {
          library: cfg.get<string>('library'),
        });

        const encoder = new TextEncoder();
        const ipOutputPath = path.join(outputDir, `${result.componentName}.ip.yml`);
        await vscode.workspace.fs.writeFile(
          vscode.Uri.file(ipOutputPath),
          encoder.encode(result.ipYamlText)
        );

        // Write memory map file if register data was found
        if (result.mmYamlText && result.mmFileName) {
          const mmOutputPath = path.join(outputDir, result.mmFileName);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(mmOutputPath),
            encoder.encode(result.mmYamlText)
          );
          void vscode.window.showInformationMessage(
            `Generated ${result.componentName}.ip.yml and ${result.mmFileName}`
          );
        }

        await vscode.commands.executeCommand(
          'vscode.openWith',
          vscode.Uri.file(ipOutputPath),
          'fpgaIpCore.editor'
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Import failed: ${message}`);
      }
    }
  );
}

async function updateFileSetsInYaml(
  ipCoreUri: vscode.Uri,
  outputBaseDir: string,
  writtenFiles: string[]
): Promise<void> {
  try {
    const document = await vscode.workspace.openTextDocument(ipCoreUri);
    const baseDir = path.dirname(ipCoreUri.fsPath);
    const doc = YAML.parseDocument(document.getText());
    const yamlRelativeFiles = writtenFiles.map((file) => {
      const absolutePath = path.join(outputBaseDir, file);
      return path.relative(baseDir, absolutePath);
    });

    const currentData = doc.toJSON() as Record<string, unknown>;
    let fileSets = (currentData.fileSets ?? currentData.file_sets ?? []) as Array<{
      name?: string;
      description?: string;
      files?: Array<{ path?: string; type?: string }>;
    }>;
    const key = currentData.fileSets
      ? 'fileSets'
      : currentData.file_sets
        ? 'file_sets'
        : 'fileSets';

    if (!Array.isArray(fileSets)) {
      fileSets = [];
    }
    fileSets = updateFileSets(fileSets, yamlRelativeFiles);

    doc.setIn([key], fileSets);
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
    logger.error('Failed to update fileSets', error as Error);
  }
}
