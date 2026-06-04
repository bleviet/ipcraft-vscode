/**
 * VS Code Commands for VHDL Code Generation
 *
 * Provides commands to generate VHDL files from IP core definitions.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as YAML from 'yaml';
import { mkdir, writeFile, readFile } from 'fs/promises';
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
import { createVivadoProject, createQuartusProject } from './projectCreator';
import { getBuildOutputChannel } from './BuildCommands';
import { StagingPanel } from '../providers/StagingPanel';
import type { StagedFile } from '../providers/StagingPanel';
import { WebviewStagingBridge } from '../providers/WebviewStagingBridge';

const logger = new Logger('GenerateCommands');

/**
 * Read the active scaffold pack name from settings, falling back to the legacy
 * bahonaviMethodology boolean. Returns undefined when the YAML's own scaffold_pack
 * field should take precedence (i.e. when the setting is empty).
 */
function readScaffoldPackSetting(genCfg: vscode.WorkspaceConfiguration): string | undefined {
  const explicit = genCfg.get<string>('scaffoldPack', '');
  return explicit || undefined;
}

/**
 * Register all generator commands with VS Code
 */

export function registerGeneratorCommands(context: vscode.ExtensionContext): void {
  safeRegisterCommand(context, 'fpga-ip-core.generateHdl', async (uri?: vscode.Uri) => {
    await generateHdl(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.scaffoldProject', async (uri?: vscode.Uri) => {
    await scaffoldProject(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.exportAltera', async (uri?: vscode.Uri) => {
    await exportAltera(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.exportXilinx', async (uri?: vscode.Uri) => {
    await exportXilinx(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateVivadoProject', async (uri?: vscode.Uri) => {
    await generateVivadoProject(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateQuartusProject', async (uri?: vscode.Uri) => {
    await generateQuartusProject(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateAndBuildVivado', async (uri?: vscode.Uri) => {
    await generateAndBuildVivado(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateAndBuildQuartus', async (uri?: vscode.Uri) => {
    await generateAndBuildQuartus(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.generateTestbench', async (uri?: vscode.Uri) => {
    await generateTestbench(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.openSettings', async () => {
    await vscode.commands.executeCommand(
      'workbench.action.openSettings',
      '@ext:bleviet.ipcraft-vscode'
    );
  });

  safeRegisterCommand(context, 'fpga-ip-core.parseVHDL', async (uri?: vscode.Uri) => {
    await parseVHDL(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.parseHwTcl', async (uri?: vscode.Uri) => {
    await parseHwTcl(context, uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.parseComponentXml', async (uri?: vscode.Uri) => {
    await parseComponentXml(context, uri);
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

async function generateHdl(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const genCfg = vscode.workspace.getConfiguration('ipcraft.generate');
  const hdlLanguage = genCfg.get<'vhdl' | 'systemverilog'>('hdlLanguage', 'vhdl');
  const bahonaviMethodology = genCfg.get<boolean>('bahonaviMethodology', false);
  const scaffoldPack = readScaffoldPackSetting(genCfg);
  const langLabel = hdlLanguage === 'systemverilog' ? 'SystemVerilog' : 'VHDL';
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: [],
      includeVhdl: true,
      includeRegs: true,
      includeTestbench: false,
      updateYaml: true,
      silent: true,
      hdlLanguage,
      bahonaviMethodology,
      scaffoldPack,
    },
    `Generating ${langLabel}...`
  );
}

async function scaffoldProject(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);

  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const genCfg = vscode.workspace.getConfiguration('ipcraft.generate');
  const includeTestbench = genCfg.get<boolean>('includeTestbench', true);
  const hdlLanguage = genCfg.get<'vhdl' | 'systemverilog'>('hdlLanguage', 'vhdl');
  const bahonaviMethodology = genCfg.get<boolean>('bahonaviMethodology', false);
  const scaffoldPack = readScaffoldPackSetting(genCfg);

  const targets = vscode.workspace
    .getConfiguration('ipcraft.toolbar')
    .get<string[]>('targets', ['vivado', 'quartus']);

  let targetPart: string | undefined;
  if (targets.includes('vivado')) {
    targetPart = await pickVivadoPart(
      context,
      cfg.get<string>('vivado.defaultPart', 'xc7z020clg484-1')
    );
    if (!targetPart) {
      return;
    }
  }

  let quartusDevice: string | undefined;
  if (targets.includes('quartus')) {
    quartusDevice = await pickQuartusDevice(
      context,
      cfg.get<string>('quartus.defaultDevice', '5CSEBA6U23I7')
    );
    if (!quartusDevice) {
      return;
    }
  }

  const ok = await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets,
      includeVhdl: true,
      includeRegs: true,
      includeTestbench,
      includeVivadoProject: targets.includes('vivado'),
      targetPart,
      includeQuartusProject: targets.includes('quartus'),
      quartusDevice,
      updateYaml: true,
      silent: true,
      hdlLanguage,
      bahonaviMethodology,
      scaffoldPack,
    },
    'Scaffolding project...'
  );

  if (ok) {
    const name = path
      .basename(ipCoreUri.fsPath)
      .replace(/\.ip\.ya?ml$/, '')
      .toLowerCase();
    await Promise.all([
      targets.includes('vivado') ? runCreateVivadoProjectStep(name, outputDir) : Promise.resolve(),
      targets.includes('quartus')
        ? runCreateQuartusProjectStep(name, outputDir)
        : Promise.resolve(),
    ]);
  }
}

async function exportAltera(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      silent: true,
    },
    'Exporting Altera Platform Designer component...'
  );
}

async function exportXilinx(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['vivado'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      silent: true,
    },
    'Exporting Xilinx Vivado component...'
  );
}

async function generateTestbench(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const framework = cfg.get<string>('testbench.framework', 'cocotb');
  const engine = cfg.get<string>('testbench.engine', 'ghdl');
  const outputDir = path.dirname(ipCoreUri.fsPath);
  await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: [],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: true,
      framework,
      engine,
      silent: true,
    },
    `Generating ${framework} testbench...`
  );
}

async function generateVivadoProject(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
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
  const name = path
    .basename(ipCoreUri.fsPath)
    .replace(/\.ip\.ya?ml$/, '')
    .toLowerCase();

  const ok = await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['vivado'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeVivadoProject: true,
      targetPart,
      silent: true,
    },
    'Generating Vivado project...'
  );

  if (ok) {
    await runCreateVivadoProjectStep(name, outputDir);
  }
}

async function generateQuartusProject(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
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
  const name = path
    .basename(ipCoreUri.fsPath)
    .replace(/\.ip\.ya?ml$/, '')
    .toLowerCase();

  const ok = await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeQuartusProject: true,
      quartusDevice,
      silent: true,
    },
    'Generating Quartus project...'
  );

  if (ok) {
    await runCreateQuartusProjectStep(name, outputDir);
  }
}

async function generateAndBuildVivado(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
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
  const ok = await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['vivado'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeVivadoProject: true,
      targetPart,
      silent: true,
    },
    'Generating Vivado project...'
  );

  if (ok) {
    await vscode.commands.executeCommand('fpga-ip-core.buildVivadoOoc', ipCoreUri);
  }
}

async function generateAndBuildQuartus(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
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
  const ok = await runGenerator(
    context,
    ipCoreUri,
    outputDir,
    {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeQuartusProject: true,
      quartusDevice,
      silent: true,
    },
    'Generating Quartus project...'
  );

  if (ok) {
    await vscode.commands.executeCommand('fpga-ip-core.buildQuartusCompile', ipCoreUri);
  }
}

/**
 * Run the Vivado project-creation step after Generate, showing a progress notification.
 * If Vivado is not found, shows an info message with manual instructions.
 */
async function runCreateVivadoProjectStep(name: string, ipDir: string): Promise<void> {
  const ch = getBuildOutputChannel();
  let success = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating Vivado project (.xpr)…',
      cancellable: false,
    },
    async () => {
      success = await createVivadoProject(name, ipDir, ch);
    }
  );
  if (!success) {
    void vscode.window.showInformationMessage(
      `Vivado project TCL written. Run manually to create the .xpr:\n` +
        `  vivado -mode batch -source ${name}_project.tcl -nojournal -nolog\n` +
        `(from the xilinx/ directory)`
    );
  }
}

/**
 * Run the Quartus project-creation step after Generate, showing a progress notification.
 * If Quartus is not found, shows an info message with manual instructions.
 */
async function runCreateQuartusProjectStep(name: string, ipDir: string): Promise<void> {
  const ch = getBuildOutputChannel();
  let success = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Creating Quartus project (.qpf)…',
      cancellable: false,
    },
    async () => {
      success = await createQuartusProject(name, ipDir, ch);
    }
  );
  if (!success) {
    void vscode.window.showInformationMessage(
      `Quartus project TCL written. Run manually to create the .qpf:\n` +
        `  quartus_sh -t ${name}_project.tcl\n` +
        `(from the altera/build/ directory)`
    );
  }
}

async function categorizeFiles(
  generatedContents: Record<string, string>,
  outputDir: string,
  protectedPaths: string[]
): Promise<StagedFile[]> {
  const protectedSet = new Set(protectedPaths);
  return Promise.all(
    Object.entries(generatedContents).map(async ([relativePath, content]) => {
      const diskPath = path.join(outputDir, relativePath);
      const isProtected = protectedSet.has(relativePath);
      try {
        const existing = await readFile(diskPath, 'utf8');
        const status = existing === content ? 'unchanged' : 'modified';
        return { relativePath, status, content, diskPath, protected: isProtected } as StagedFile;
      } catch {
        return { relativePath, status: 'new', content, diskPath, protected: false } as StagedFile;
      }
    })
  );
}

async function runGenerator(
  context: vscode.ExtensionContext,
  ipCoreUri: vscode.Uri,
  outputDir: string,
  options: GenerateOptions & { updateYaml?: boolean; silent?: boolean },
  progressTitle: string
): Promise<boolean> {
  // Phase 1: Generate all file content in memory (no disk writes).
  // Use a neutral label — the operation title is reserved for Phase 4 when files are written.
  let dryResult:
    | Awaited<ReturnType<InstanceType<typeof IpCoreScaffolder>['generateAll']>>
    | undefined;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Analyzing…', cancellable: false },
    async () => {
      const generator = new IpCoreScaffolder(logger, new TemplateLoader(logger), context);
      dryResult = await generator.generateAll(ipCoreUri.fsPath, outputDir, {
        ...options,
        dryRun: true,
      });
    }
  );

  if (!dryResult?.success || !dryResult.generatedContents) {
    void vscode.window.showErrorMessage(
      `Generation failed: ${dryResult?.error ?? 'Unknown error'}`
    );
    return false;
  }

  // Phase 2: Categorise generated files against what is currently on disk
  const staged = await categorizeFiles(
    dryResult.generatedContents,
    outputDir,
    dryResult.protectedPaths ?? []
  );

  // Phase 3: Show the staging overlay in the canvas webview when possible; fall back to
  // a separate StagingPanel when the canvas webview is not registered (e.g. command run
  // while the editor is not open, or from the Source Control / Explorer view).
  if (staged.length > 0) {
    const bridge = WebviewStagingBridge.getInstance();
    const bridgeResult = await bridge.showInWebview(
      ipCoreUri.fsPath,
      staged,
      path.basename(outputDir)
    );
    const confirmed = bridgeResult !== null ? bridgeResult : await StagingPanel.show(staged);
    if (!confirmed) {
      return false;
    }
  }

  // Phase 4: Write new + modified files; skip unchanged and protected-existing files.
  // Pre-compute the write list so we only show the progress notification when there
  // is real disk work to do — avoiding a misleading "Generating…" flash otherwise.
  const protectedExisting = new Set(dryResult.protectedPaths ?? []);
  const filesToWrite = staged.filter(
    (f) => f.status !== 'unchanged' && !(f.protected && protectedExisting.has(f.relativePath))
  );
  const writtenRelPaths: string[] = [];
  let writeError: string | undefined;

  if (filesToWrite.length > 0) {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: progressTitle, cancellable: false },
      async () => {
        try {
          await Promise.all(
            filesToWrite.map(async (f) => {
              await mkdir(path.dirname(f.diskPath), { recursive: true });
              await writeFile(f.diskPath, f.content, 'utf8');
              writtenRelPaths.push(f.relativePath);
            })
          );
        } catch (err) {
          writeError = err instanceof Error ? err.message : String(err);
        }
      }
    );
  }

  if (writeError) {
    void vscode.window.showErrorMessage(`Failed to write files: ${writeError}`);
    return false;
  }

  if (options.updateYaml) {
    await updateFileSetsInYaml(ipCoreUri, outputDir, writtenRelPaths);
  }

  if (!options.silent) {
    const action = await vscode.window.showInformationMessage(
      `✓ Generated ${writtenRelPaths.length} file(s)`,
      'Open Folder'
    );
    if (action === 'Open Folder') {
      await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputDir));
    }
  }

  return true;
}

const HIDE_EXPERIMENTAL_IMPORT_WARNING = 'ipcraft.hideExperimentalImportWarning';

/**
 * Show a one-time dismissable warning before experimental parse/import operations.
 * Returns true when the caller should proceed, false when the user cancelled.
 */
async function showExperimentalParseWarning(context: vscode.ExtensionContext): Promise<boolean> {
  if (context.globalState.get<boolean>(HIDE_EXPERIMENTAL_IMPORT_WARNING)) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    '⚠️ This import feature is experimental. Results may be incomplete or require manual ' +
      'adjustments for complex files. Review the generated .ip.yml before using it for code generation.',
    'Continue',
    "Don't show again",
    'Cancel'
  );
  if (!choice || choice === 'Cancel') {
    return false;
  }
  if (choice === "Don't show again") {
    void context.globalState.update(HIDE_EXPERIMENTAL_IMPORT_WARNING, true);
  }
  return true;
}

/**
 * Build a human-readable summary of what was detected in a parsed .ip.yml YAML string.
 */
function buildParseSummary(yamlText: string): string {
  try {
    const data = YAML.parse(yamlText) as Record<string, unknown>;
    const name = String((data.name as string | undefined) ?? '');
    const ports = Array.isArray(data.ports) ? data.ports.length : 0;
    const params = Array.isArray(data.parameters) ? data.parameters.length : 0;
    const buses = Array.isArray(data.busInterfaces) ? data.busInterfaces.length : 0;
    const parts: string[] = [];
    if (ports > 0) {
      parts.push(`${ports} port${ports !== 1 ? 's' : ''}`);
    }
    if (params > 0) {
      parts.push(`${params} parameter${params !== 1 ? 's' : ''}`);
    }
    if (buses > 0) {
      parts.push(`${buses} bus interface${buses !== 1 ? 's' : ''}`);
    }
    const detail = parts.length > 0 ? parts.join(', ') : 'no items detected';
    return name ? `${name}: ${detail}` : detail;
  } catch {
    return '';
  }
}

/**
 * Parse VHDL file and generate IP core YAML
 */
async function parseVHDL(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  if (!(await showExperimentalParseWarning(context))) {
    return;
  }

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

        const summary = buildParseSummary(result.yamlText);
        if (summary) {
          void vscode.window.showInformationMessage(
            `Imported (experimental) — ${summary}. Review the .ip.yml carefully before generating code.`
          );
        }

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
async function parseHwTcl(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  if (!(await showExperimentalParseWarning(context))) {
    return;
  }

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

        const summary = buildParseSummary(result.yamlText);
        if (summary) {
          void vscode.window.showInformationMessage(
            `Imported (experimental) — ${summary}. Review the .ip.yml carefully before generating code.`
          );
        }

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

async function parseComponentXml(
  context: vscode.ExtensionContext,
  resourceUri?: vscode.Uri
): Promise<void> {
  if (!(await showExperimentalParseWarning(context))) {
    return;
  }

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

        const ipSummary = buildParseSummary(result.ipYamlText);

        // Write memory map file if register data was found
        if (result.mmYamlText && result.mmFileName) {
          const mmOutputPath = path.join(outputDir, result.mmFileName);
          await vscode.workspace.fs.writeFile(
            vscode.Uri.file(mmOutputPath),
            encoder.encode(result.mmYamlText)
          );
          void vscode.window.showInformationMessage(
            `Imported (experimental) — ${ipSummary ? `${ipSummary}; ` : ''}memory map saved to ${result.mmFileName}. Review carefully before generating code.`
          );
        } else if (ipSummary) {
          void vscode.window.showInformationMessage(
            `Imported (experimental) — ${ipSummary}. Review the .ip.yml carefully before generating code.`
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
