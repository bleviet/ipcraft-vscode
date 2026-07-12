/**
 * VS Code command for scaffolding a programmable board project (board-top wrapper +
 * real pin assignments + board-mode SDC + Quartus board project) from an IP core and a
 * board definition. See src/generator/board/BoardProjectScaffolder.ts.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { TemplateLoader } from '../generator/TemplateLoader';
import type { ResourceRoots } from '../services/ResourceRoots';
import { scaffoldBoardProject } from '../generator/board/BoardProjectScaffolder';
import { loadBoardDefinition } from '../generator/board/BoardDefinitionLoader';
import { isIpCoreFile } from '../utils/fileExtensions';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { CONFIG_KEY_IPCRAFT_GENERATE } from '../utils/configKeys';

const logger = new Logger('BoardCommands');
let globalResourceRoots: ResourceRoots;

export function registerBoardCommands(
  context: vscode.ExtensionContext,
  resourceRoots: ResourceRoots
): void {
  globalResourceRoots = resourceRoots;
  safeRegisterCommand(context, 'fpga-ip-core.newBoardProject', async (uri?: vscode.Uri) => {
    await newBoardProject(uri);
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

async function pickBoardDefinition(): Promise<string | undefined> {
  const boards = await listBoardCatalog();
  if (boards.length === 0) {
    void vscode.window.showErrorMessage('No board definitions are bundled with IPCraft.');
    return undefined;
  }
  if (boards.length === 1) {
    return path.join(globalResourceRoots.boardsDir, boards[0].file);
  }
  const picked = await vscode.window.showQuickPick(
    boards.map((b) => ({ label: b.name, description: b.device, file: b.file })),
    { title: 'Select Target Board', placeHolder: 'Search by board name or device…' }
  );
  return picked ? path.join(globalResourceRoots.boardsDir, picked.file) : undefined;
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
    const { files, wrapperName } = await vscode.window.withProgress(
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

    const existing: string[] = [];
    for (const relPath of Object.keys(files)) {
      try {
        await fs.stat(path.join(outputDir, relPath));
        existing.push(relPath);
      } catch {
        // Not on disk yet — nothing to warn about.
      }
    }
    if (existing.length > 0) {
      const choice = await vscode.window.showWarningMessage(
        `${existing.length} board project file(s) already exist and will be overwritten:\n${existing.join('\n')}`,
        { modal: true },
        'Overwrite'
      );
      if (choice !== 'Overwrite') {
        return;
      }
    }

    await Promise.all(
      Object.entries(files).map(async ([relPath, content]) => {
        const fullPath = path.join(outputDir, relPath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf8');
      })
    );

    const action = await vscode.window.showInformationMessage(
      `✓ Generated board project (${wrapperName}) — ${Object.keys(files).length} file(s) in altera-board/`,
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
