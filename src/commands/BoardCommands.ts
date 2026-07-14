/**
 * VS Code command for scaffolding a programmable board project (board-top wrapper +
 * real pin assignments + board-mode SDC + Quartus board project) from an IP core and a
 * board definition. See src/generator/board/BoardProjectScaffolder.ts.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as yaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from '../generator/TemplateLoader';
import type { ResourceRoots } from '../services/ResourceRoots';
import { scaffoldBoardProject } from '../generator/board/BoardProjectScaffolder';
import { loadBoardDefinition } from '../generator/board/BoardDefinitionLoader';
import { isIpCoreFile } from '../utils/fileExtensions';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { CONFIG_KEY_IPCRAFT, CONFIG_KEY_IPCRAFT_GENERATE } from '../utils/configKeys';
import { getToolchain } from '../services/toolchains/registry';
import { computeMountBase } from '../services/toolchains/QuartusToolchain';
import { runProcess } from '../services/BuildRunner';
import { fileExists } from '../utils/fsHelpers';
import { parseQuartusReports } from '../services/ReportParser';
import { openInQuartusCommand } from './openInQuartus';
import { programBoard as jtagProgramBoard } from '../services/JtagProgrammer';
import { getBuildOutputChannel } from './BuildCommands';
import { categorizeFiles } from './GenerateCommands';
import { StagingPanel } from '../providers/StagingPanel';
import { WebviewStagingBridge } from '../providers/WebviewStagingBridge';

const logger = new Logger('BoardCommands');
let globalResourceRoots: ResourceRoots;

/** Subdirectory (relative to the .ip.yml directory) where board project files are generated. */
export const BOARD_PROJECT_SUBDIR = 'altera-board';

export function registerBoardCommands(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots
): void {
  globalResourceRoots = resourceRoots;
  safeRegisterCommand(context, 'fpga-ip-core.newBoardProject', async (uri?: vscode.Uri) => {
    await newBoardProject(uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.openBoardProject', async (uri?: vscode.Uri) => {
    await openBoardProjectCommand(uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.buildBoardProject', async (uri?: vscode.Uri) => {
    await buildBoardProject(uri);
  });

  safeRegisterCommand(context, 'fpga-ip-core.changeDefaultBoard', async () => {
    await changeDefaultBoard();
  });

  safeRegisterCommand(context, 'fpga-ip-core.programBoard', async (uri?: vscode.Uri) => {
    await programBoardCommand(uri);
  });
}

function getActiveIpCoreFile(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    if (isIpCoreFile(editor.document.fileName)) {
      return editor.document.uri;
    }
  }
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

interface BoardCatalogEntry {
  file: string;
  name: string;
  device: string;
}

async function listBoardCatalog(): Promise<BoardCatalogEntry[]> {
  const entries = await fs.readdir(globalResourceRoots.boardsDir);
  const boards: BoardCatalogEntry[] = [];
  for (const file of entries.filter((f) => f.endsWith('.board.yml'))) {
    try {
      const board = await loadBoardDefinition(
        path.join(globalResourceRoots.boardsDir, file),
        globalResourceRoots
      );
      boards.push({ file, name: board.name, device: board.device });
    } catch (err) {
      logger.warn(`Skipping invalid bundled board definition '${file}'`, err as Error);
    }
  }
  return boards;
}

export async function pickBoardDefinition(): Promise<string | undefined> {
  const boards = await listBoardCatalog();
  if (boards.length === 0) {
    void vscode.window.showErrorMessage('No board definitions are bundled with IPCraft.');
    return undefined;
  }
  // Single-board bundles never prompt — this must stay true regardless of the
  // defaultBoard setting so behavior is unchanged when only DE10-Nano ships.
  if (boards.length === 1) {
    return path.join(globalResourceRoots.boardsDir, boards[0].file);
  }

  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const defaultBoard = genCfg.get<string>('defaultBoard', '').trim();
  if (defaultBoard) {
    const match = boards.find((b) => b.file === defaultBoard);
    if (match) {
      return path.join(globalResourceRoots.boardsDir, match.file);
    }
    logger.warn(
      `Configured default board '${defaultBoard}' is not in the board catalog; falling back to the picker.`
    );
  }

  const picked = await vscode.window.showQuickPick(
    boards.map((b) => ({ label: b.name, description: b.device, file: b.file })),
    { title: 'Select Target Board', placeHolder: 'Search by board name or device…' }
  );
  if (!picked) {
    return undefined;
  }

  const setDefault = await vscode.window.showInformationMessage(
    `Set '${picked.label}' as the default board? Future board projects will use it without asking.`,
    'Set as Default',
    'Not Now'
  );
  if (setDefault === 'Set as Default') {
    await genCfg.update('defaultBoard', picked.file, vscode.ConfigurationTarget.Global);
  }

  return path.join(globalResourceRoots.boardsDir, picked.file);
}

/** Let the user pick a new default board, or clear it so the picker prompts again. */
export async function changeDefaultBoard(): Promise<void> {
  const boards = await listBoardCatalog();
  if (boards.length === 0) {
    void vscode.window.showErrorMessage('No board definitions are bundled with IPCraft.');
    return;
  }

  const CLEAR_FILE = '__clear__';
  const items = [
    { label: '$(close) Clear default (always ask)', file: CLEAR_FILE },
    ...boards.map((b) => ({ label: b.name, description: b.device, file: b.file })),
  ];
  const picked = await vscode.window.showQuickPick(items, { title: 'Change Default Board' });
  if (!picked) {
    return;
  }

  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const value = picked.file === CLEAR_FILE ? '' : picked.file;
  await genCfg.update('defaultBoard', value, vscode.ConfigurationTarget.Global);
  void vscode.window.showInformationMessage(
    value
      ? `Default board set to ${picked.label}.`
      : 'Default board cleared — the picker will ask again.'
  );
}

/** Read `vlnv.name` (lowercased) from an .ip.yml file — the name the scaffolder uses on disk. */
async function readIpCoreName(ipCoreUri: vscode.Uri): Promise<string | undefined> {
  try {
    const content = await fs.readFile(ipCoreUri.fsPath, 'utf8');
    const data = yaml.load(content) as { vlnv?: { name?: string } } | undefined;
    const name = data?.vlnv?.name;
    return name ? name.toLowerCase() : undefined;
  } catch (err) {
    logger.warn(`Failed to read vlnv.name from '${ipCoreUri.fsPath}'`, err as Error);
    return undefined;
  }
}

async function newBoardProject(resourceUri?: vscode.Uri): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }

  const boardYamlPath = await pickBoardDefinition();
  if (!boardYamlPath) {
    return;
  }

  const outputDir = path.dirname(ipCoreUri.fsPath);
  const genCfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT_GENERATE);
  const hdlLanguage = genCfg.get<'vhdl' | 'systemverilog'>('hdlLanguage', 'vhdl');

  try {
    const { files, wrapperName, unmappedPorts } = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Generating board project…',
        cancellable: false,
      },
      () =>
        scaffoldBoardProject({
          ipYamlPath: ipCoreUri.fsPath,
          boardYamlPath,
          resourceRoots: globalResourceRoots,
          templates: new TemplateLoader(logger, globalResourceRoots.templatesDir),
          hdlLanguage,
        })
    );

    // Preview/diff/merge each generated file before writing — the same staging
    // pipeline GenerateCommands.ts's runGenerator() uses for Scaffold/Generate
    // Quartus/Vivado Project, so board project files get the identical "Preview
    // Generated Files" experience (per-file diff, protected-file merge, etc).
    const staged = await categorizeFiles(files, outputDir, []);
    let mergedPaths = new Set<string>();
    let overwritePaths = new Set<string>();
    const bridge = WebviewStagingBridge.getInstance();
    const bridgeResult = await bridge.showInWebview(
      ipCoreUri.fsPath,
      staged,
      path.basename(outputDir)
    );
    const decision = bridgeResult ?? (await StagingPanel.show(staged));
    if (!decision.confirmed) {
      return;
    }
    mergedPaths = new Set(decision.mergedPaths);
    overwritePaths = new Set(decision.overwritePaths);

    const filesToWrite = staged.filter(
      (f) =>
        f.status !== 'unchanged' &&
        !mergedPaths.has(f.relativePath) &&
        (f.status === 'new' || overwritePaths.has(f.relativePath))
    );

    await Promise.all(
      filesToWrite.map(async (f) => {
        await fs.mkdir(path.dirname(f.diskPath), { recursive: true });
        await fs.writeFile(f.diskPath, f.content, 'utf8');
      })
    );

    const ch = getBuildOutputChannel();
    let projectCreated = false;
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Creating Quartus board project (.qpf)…',
        cancellable: false,
      },
      async () => {
        projectCreated = await createBoardQuartusProject(wrapperName, outputDir, ch);
      }
    );

    const qpfNote = projectCreated
      ? ''
      : ` (Quartus not found — run 'quartus_sh -t ${wrapperName}_board_project.tcl' manually from altera-board/ to create the .qpf)`;
    const mergeNote =
      mergedPaths.size > 0
        ? `; ${mergedPaths.size} opened in the merge editor (resolve and save)`
        : '';
    const unmappedNote =
      unmappedPorts.length > 0
        ? ` — ${unmappedPorts.length} port(s) need manual pin assignment (see altera-board/${ipNameFromWrapperName(wrapperName)}_board_pins.tcl): ${unmappedPorts.map((p) => p.name).join(', ')}`
        : '';
    const action = await vscode.window.showInformationMessage(
      `✓ Generated board project (${wrapperName}) — ${filesToWrite.length} file(s) written to altera-board/${mergeNote}${qpfNote}${unmappedNote}`,
      'Open Folder'
    );
    if (action === 'Open Folder') {
      await vscode.commands.executeCommand(
        'revealFileInOS',
        vscode.Uri.file(path.join(outputDir, 'altera-board'))
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void handleErrorWithUserNotification(
      error,
      'newBoardProject',
      `Board project generation failed: ${message}`
    );
  }
}

/**
 * Run the board project's Quartus project-creation TCL, producing the .qpf/.qsf
 * directly in altera-board/ — not a nested build/ subdir, since the generated
 * TCL's own usage comment assumes it runs from altera-board/ itself (RTL and pin
 * file paths inside it are relative to that directory).
 */
async function createBoardQuartusProject(
  wrapperName: string,
  ipDir: string,
  outputChannel: vscode.OutputChannel
): Promise<boolean> {
  const boardDir = path.join(ipDir, BOARD_PROJECT_SUBDIR);
  const projectTcl = path.join(boardDir, `${wrapperName}_board_project.tcl`);
  if (!(await fileExists(projectTcl))) {
    return false;
  }

  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return false;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const launcher = toolchain.resolve('quartus_sh', cfg);
  if (!launcher?.exe) {
    return false;
  }

  const mountBase = await computeMountBase(ipNameFromWrapperName(wrapperName), ipDir);
  const docker = toolchain.getDocker(cfg, mountBase);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  const result = await runProcess(launcher.exe, ['-t', projectTcl], {
    cwd: boardDir,
    outputChannel,
    docker,
    env,
    extraMounts,
  });
  return result.success;
}

/** Board-top wrapper name the scaffolder derives from an .ip.yml's vlnv.name (see BoardProjectScaffolder). */
export async function resolveBoardWrapperName(ipCoreUri: vscode.Uri): Promise<string | undefined> {
  const name = await readIpCoreName(ipCoreUri);
  return name ? `${name}_board_top` : undefined;
}

/**
 * Recovers the plain IP core name (matching the .ip.yml filename, e.g. "led_blink") from a
 * board wrapper name (e.g. "led_blink_board_top") — computeMountBase needs the former to find
 * the .ip.yml on disk and read its fileSets.
 */
function ipNameFromWrapperName(wrapperName: string): string {
  return wrapperName.replace(/_board_top$/, '');
}

export async function openBoardProjectCommand(resourceUri?: vscode.Uri): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const wrapperName = await resolveBoardWrapperName(ipCoreUri);
  if (!wrapperName) {
    void vscode.window.showErrorMessage('Cannot read vlnv.name from IP core file.');
    return;
  }
  const ipDir = path.dirname(ipCoreUri.fsPath);
  const qpfPath = path.join(ipDir, BOARD_PROJECT_SUBDIR, `${wrapperName}.qpf`);
  if (!(await fileExists(qpfPath))) {
    void vscode.window.showErrorMessage(
      'No board project (.qpf) found. Run "Generate Board Project" first.'
    );
    return;
  }
  await openInQuartusCommand(vscode.Uri.file(qpfPath), ipDir);
}

async function buildBoardProject(resourceUri?: vscode.Uri): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const wrapperName = await resolveBoardWrapperName(ipCoreUri);
  if (!wrapperName) {
    void vscode.window.showErrorMessage('Cannot read vlnv.name from IP core file.');
    return;
  }

  const ipDir = path.dirname(ipCoreUri.fsPath);
  const boardDir = path.join(ipDir, BOARD_PROJECT_SUBDIR);
  const projectTcl = path.join(boardDir, `${wrapperName}_board_project.tcl`);
  if (!(await fileExists(projectTcl))) {
    void vscode.window.showErrorMessage(
      'No board project found. Run "Generate Board Project" first.'
    );
    return;
  }

  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const launcher = toolchain.resolve('quartus_sh', cfg);
  if (!launcher?.exe) {
    void vscode.window.showErrorMessage('Quartus not found. Configure it in IPCraft settings.');
    return;
  }
  const mountBase = await computeMountBase(ipNameFromWrapperName(wrapperName), ipDir);
  const docker = toolchain.getDocker(cfg, mountBase);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  const ch = getBuildOutputChannel();
  ch.show(true);
  ch.appendLine(`\n${'='.repeat(60)}`);
  ch.appendLine(`IPCraft Build — Quartus Board Compile`);
  ch.appendLine(`Project : ${wrapperName}`);
  ch.appendLine(`Dir     : ${boardDir}`);
  ch.appendLine('='.repeat(60));

  let success = false;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Building board project (${wrapperName})…`,
      cancellable: false,
    },
    async () => {
      const step1 = await runProcess(launcher.exe, ['-t', projectTcl], {
        cwd: boardDir,
        outputChannel: ch,
        docker,
        env,
        extraMounts,
      });
      if (!step1.success) {
        return;
      }
      const step2 = await runProcess(launcher.exe, ['--flow', 'compile', wrapperName], {
        cwd: boardDir,
        outputChannel: ch,
        docker,
        env,
        extraMounts,
      });
      success = step2.success;
    }
  );

  if (!success) {
    void vscode.window.showErrorMessage('Board project build failed — see IPCraft Build output.');
    return;
  }

  const reports = await parseQuartusReports(boardDir, wrapperName);
  const fmax = reports.timing?.fmax;
  const summary = fmax !== undefined ? `Fmax ${fmax.toFixed(0)} MHz` : 'Done';
  void vscode.window.showInformationMessage(
    `✓ Board project built (${wrapperName}) — ${summary}. Run "IPCraft: Program Board" to download it.`
  );
}

/**
 * Programs the board's compiled .sof over JTAG (issue #79) — runs jtagconfig, matches the
 * board definition's device against the detected JTAG chain, and derives the quartus_pgm
 * device index from that match instead of a hand-set `@N`.
 */
async function programBoardCommand(resourceUri?: vscode.Uri): Promise<void> {
  const ipCoreUri = resourceUri ?? getActiveIpCoreFile();
  if (!ipCoreUri) {
    return;
  }
  const wrapperName = await resolveBoardWrapperName(ipCoreUri);
  if (!wrapperName) {
    void vscode.window.showErrorMessage('Cannot read vlnv.name from IP core file.');
    return;
  }

  const ipDir = path.dirname(ipCoreUri.fsPath);
  const boardDir = path.join(ipDir, BOARD_PROJECT_SUBDIR);
  const sofPath = path.join(boardDir, 'output_files', `${wrapperName}.sof`);
  if (!(await fileExists(sofPath))) {
    void vscode.window.showErrorMessage(
      'No compiled .sof found. Run "Build the Board Project" first.'
    );
    return;
  }

  const boardYamlPath = await pickBoardDefinition();
  if (!boardYamlPath) {
    return;
  }
  const board = await loadBoardDefinition(boardYamlPath, globalResourceRoots);

  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const jtagconfigLauncher = toolchain.resolve('jtagconfig', cfg);
  const quartusPgmLauncher = toolchain.resolve('quartus_pgm', cfg);
  if (!jtagconfigLauncher?.exe || !quartusPgmLauncher?.exe) {
    void vscode.window.showErrorMessage('Quartus not found. Configure it in IPCraft settings.');
    return;
  }
  const mountBase = await computeMountBase(ipNameFromWrapperName(wrapperName), ipDir);
  const docker = toolchain.getDocker(cfg, mountBase);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  const ch = getBuildOutputChannel();
  ch.show(true);
  ch.appendLine(`\n${'='.repeat(60)}`);
  ch.appendLine('IPCraft Program — JTAG (auto-detected device)');
  ch.appendLine(`Project : ${wrapperName}`);
  ch.appendLine(`Board   : ${board.name} (${board.device})`);
  ch.appendLine('='.repeat(60));

  let result: Awaited<ReturnType<typeof jtagProgramBoard>> | undefined;
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Programming board (${wrapperName})…`,
      cancellable: false,
    },
    async () => {
      result = await jtagProgramBoard({
        jtagconfigExe: jtagconfigLauncher.exe,
        quartusPgmExe: quartusPgmLauncher.exe,
        sofPath,
        boardDevicePart: board.device,
        cwd: boardDir,
        outputChannel: ch,
        docker,
        env,
        extraMounts,
      });
    }
  );

  if (!result?.success) {
    void vscode.window.showErrorMessage(
      result?.error ?? 'Programming failed — see IPCraft Build output.'
    );
    return;
  }

  void vscode.window.showInformationMessage(`✓ Board programmed (${wrapperName}).`);
}
