import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { TemplatePreviewProvider } from '../providers/TemplatePreviewProvider';
import { ScaffoldPackPanel } from '../providers/ScaffoldPackPanel';
import { ScaffoldPackLoader } from '../generator/ScaffoldPackLoader';
import { safeRegisterCommand } from '../utils/vscodeHelpers';

const logger = new Logger('ScaffoldPackCommands');

/** Key used to persist the user's pinned preview IP core across sessions. */
const PREVIEW_IP_CORE_KEY = 'ipcraft.scaffoldPreview.ipCorePath';

export function registerScaffoldPackCommands(
  context: vscode.ExtensionContext,
  previewProvider: TemplatePreviewProvider
): void {
  // ── Command: Preview Template Output ────────────────────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.previewTemplateOutput', async (uri?: vscode.Uri) => {
    await previewTemplateOutput(context, previewProvider, uri);
  });

  // ── Command: Export Built-in Scaffold Pack (Eject) ────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.exportScaffoldPack', async () => {
    await exportScaffoldPack(context);
  });

  // ── Command: Pin Preview IP Core ──────────────────────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.pinPreviewIpCore', async () => {
    await pinPreviewIpCore(context);
  });

  // ── File watcher: refresh preview when a .j2 template is saved ────────
  const j2Watcher = vscode.workspace.createFileSystemWatcher('**/*.j2');
  j2Watcher.onDidChange(async (uri) => {
    await refreshTemplatePreview(context, previewProvider, uri);
  });
  context.subscriptions.push(j2Watcher);

  // ── Document save watcher: refresh scaffold panel when scaffold.yml saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (path.basename(doc.fileName) === 'scaffold.yml') {
        const panel = ScaffoldPackPanel.instance;
        if (panel) {
          await panel.refresh(doc.fileName);
        }
      }
    })
  );
}

// ---------------------------------------------------------------------------
// Preview Template Output
// ---------------------------------------------------------------------------

async function previewTemplateOutput(
  context: vscode.ExtensionContext,
  provider: TemplatePreviewProvider,
  uri?: vscode.Uri
): Promise<void> {
  const templateUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!templateUri?.fsPath.endsWith('.j2')) {
    void vscode.window.showErrorMessage('Open a .j2 template file first.');
    return;
  }

  const ipCorePath = await resolvePreviewIpCore(context);
  if (!ipCorePath) {
    return;
  }

  const previewUri = TemplatePreviewProvider.buildUri(templateUri.fsPath, ipCorePath);

  // Open as virtual document beside the template editor
  const doc = await vscode.workspace.openTextDocument(previewUri);
  await vscode.window.showTextDocument(doc, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: true,
  });
}

/** Called by the file watcher when a .j2 file is saved. */
async function refreshTemplatePreview(
  context: vscode.ExtensionContext,
  provider: TemplatePreviewProvider,
  templateUri: vscode.Uri
): Promise<void> {
  const ipCorePath = context.workspaceState.get<string>(PREVIEW_IP_CORE_KEY);
  if (!ipCorePath) {
    return;
  }

  const previewUri = TemplatePreviewProvider.buildUri(templateUri.fsPath, ipCorePath);

  // Only refresh if the virtual document is currently visible
  const isVisible = vscode.window.visibleTextEditors.some(
    (e) => e.document.uri.toString() === previewUri.toString()
  );
  if (isVisible) {
    provider.refresh(previewUri);
  }
}

// ---------------------------------------------------------------------------
// Export Built-in Scaffold Pack (Eject)
// ---------------------------------------------------------------------------

async function exportScaffoldPack(context: vscode.ExtensionContext): Promise<void> {
  const builtinPacks = ScaffoldPackLoader.listBuiltinPacks();
  if (builtinPacks.length === 0) {
    void vscode.window.showErrorMessage('No built-in scaffold packs found.');
    return;
  }

  const selected = await vscode.window.showQuickPick(
    builtinPacks.map((name) => ({ label: name, description: 'Built-in pack' })),
    { placeHolder: 'Select a built-in scaffold pack to export', title: 'Export Scaffold Pack' }
  );
  if (!selected) {
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  // Default export name: strip the 'builtin-' prefix so users start fresh
  const defaultName = selected.label.replace(/^builtin-/, '');
  const newName = await vscode.window.showInputBox({
    prompt: 'Name for your scaffold pack',
    value: defaultName,
    validateInput: (v) =>
      /^[a-zA-Z0-9_-]+$/.test(v.trim())
        ? undefined
        : 'Use letters, numbers, hyphens, underscores only',
  });
  if (!newName) {
    return;
  }

  const destDir = path.join(workspaceRoot, '.vscode', 'ipcraft', 'packs', newName.trim());
  const srcDir = path.join(ScaffoldPackLoader.builtinPacksDir, selected.label);

  try {
    await copyDir(srcDir, destDir);
    void vscode.window
      .showInformationMessage(
        `Scaffold pack exported to .vscode/ipcraft/packs/${newName}/`,
        'Open scaffold.yml'
      )
      .then(async (action) => {
        if (action === 'Open scaffold.yml') {
          const manifestUri = vscode.Uri.file(path.join(destDir, 'scaffold.yml'));
          const doc = await vscode.workspace.openTextDocument(manifestUri);
          await vscode.window.showTextDocument(doc);
          // Show the scaffold pack panel for this manifest
          const panel = ScaffoldPackPanel.show(logger, context);
          await panel.refresh(manifestUri.fsPath);
        }
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void vscode.window.showErrorMessage(`Export failed: ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Pin Preview IP Core
// ---------------------------------------------------------------------------

async function pinPreviewIpCore(context: vscode.ExtensionContext): Promise<void> {
  const ipFiles = await vscode.workspace.findFiles('**/*.ip.yml', '**/node_modules/**', 50);
  if (ipFiles.length === 0) {
    void vscode.window.showInformationMessage('No .ip.yml files found in workspace.');
    return;
  }

  const items = ipFiles.map((uri) => ({
    label: path.basename(uri.fsPath),
    description: vscode.workspace.asRelativePath(uri),
    fsPath: uri.fsPath,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select the IP core to use as template preview context',
    title: 'Pin Preview IP Core',
  });
  if (!picked) {
    return;
  }

  await context.workspaceState.update(PREVIEW_IP_CORE_KEY, picked.fsPath);
  void vscode.window.showInformationMessage(`Preview context set to: ${picked.label}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolvePreviewIpCore(context: vscode.ExtensionContext): Promise<string | undefined> {
  // Check pinned preference first
  const pinned = context.workspaceState.get<string>(PREVIEW_IP_CORE_KEY);
  if (pinned) {
    try {
      await fs.stat(pinned);
      return pinned;
    } catch {
      // Pinned file no longer exists — fall through to picker
      await context.workspaceState.update(PREVIEW_IP_CORE_KEY, undefined);
    }
  }

  // Auto-select if exactly one .ip.yml in workspace
  const ipFiles = await vscode.workspace.findFiles('**/*.ip.yml', '**/node_modules/**', 5);
  if (ipFiles.length === 1) {
    return ipFiles[0].fsPath;
  }

  if (ipFiles.length === 0) {
    void vscode.window.showErrorMessage(
      'No .ip.yml file found in workspace. Create one first, or use "IPCraft: Pin Preview IP Core" to set a context file.'
    );
    return undefined;
  }

  // Multiple found — ask user to pick (and offer to pin)
  const items = ipFiles.map((uri) => ({
    label: path.basename(uri.fsPath),
    description: vscode.workspace.asRelativePath(uri),
    fsPath: uri.fsPath,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select an IP core to use as template preview context',
    title: 'Preview Context',
  });
  if (!picked) {
    return undefined;
  }

  const pin = await vscode.window.showInformationMessage(
    `Use "${picked.label}" as the preview context?`,
    'Always use this file',
    'Just this once'
  );
  if (pin === 'Always use this file') {
    await context.workspaceState.update(PREVIEW_IP_CORE_KEY, picked.fsPath);
  }

  return picked.fsPath;
}

async function copyDir(src: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    })
  );
}
