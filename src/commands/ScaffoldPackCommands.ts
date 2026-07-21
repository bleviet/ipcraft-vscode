import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { sync as globSync } from 'glob';
import { Logger } from '../utils/Logger';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { TemplatePreviewProvider } from '../providers/TemplatePreviewProvider';
import { ScaffoldPackPanel } from '../providers/ScaffoldPackPanel';
import { ScaffoldPackLoader } from '../generator/ScaffoldPackLoader';
import { ResourceRoots } from '../services/ResourceRoots';
import { safeRegisterCommand } from '../utils/vscodeHelpers';

const logger = new Logger('ScaffoldPackCommands');

/** Key used to persist the user's pinned preview IP core across sessions. */
const PREVIEW_IP_CORE_KEY = 'ipcraft.scaffoldPreview.ipCorePath';

let globalResourceRoots: ResourceRoots;
let scaffoldPackLoader: ScaffoldPackLoader;

export function registerScaffoldPackCommands(
  context: vscode.ExtensionContext,
  previewProvider: TemplatePreviewProvider,
  resourceRoots: ResourceRoots
): void {
  globalResourceRoots = resourceRoots;
  scaffoldPackLoader = new ScaffoldPackLoader(resourceRoots.builtinPacksDir);
  // ── Command: Preview Template Output ────────────────────────────────────
  safeRegisterCommand(
    context,
    'fpga-ip-core.previewTemplateOutput',
    async (uri?: vscode.Uri) => {
      await previewTemplateOutput(context, previewProvider, uri);
    },
    { requiresWorkspaceTrust: true }
  );

  // ── Command: Export Built-in Scaffold Pack (Eject) ────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.exportScaffoldPack', async () => {
    await exportScaffoldPack(context);
  });

  // ── Command: Pin Preview IP Core ──────────────────────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.pinPreviewIpCore', async () => {
    await pinPreviewIpCore(context);
  });

  // ── Command: Open Scaffold Packs walkthrough ──────────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.openScaffoldPacksWalkthrough', async () => {
    await vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      'bleviet.ipcraft-vscode#scaffold-packs-getting-started',
      false
    );
  });

  // ── Commands: Individual walkthroughs ─────────────────────────────────
  const openWalkthrough = (id: string) =>
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      `bleviet.ipcraft-vscode#${id}`,
      false
    );

  safeRegisterCommand(context, 'fpga-ip-core.openFreshIpCoreWalkthrough', async () => {
    await openWalkthrough('fresh-ip-core');
  });
  safeRegisterCommand(context, 'fpga-ip-core.openIpCoreWithRegistersWalkthrough', async () => {
    await openWalkthrough('ip-core-with-registers');
  });
  safeRegisterCommand(context, 'fpga-ip-core.openImportFromVhdlWalkthrough', async () => {
    await openWalkthrough('import-from-vhdl');
  });
  safeRegisterCommand(context, 'fpga-ip-core.openImportFromVendorWalkthrough', async () => {
    await openWalkthrough('import-from-vendor-tools');
  });
  safeRegisterCommand(context, 'fpga-ip-core.openBuildAndVerifyWalkthrough', async () => {
    await openWalkthrough('build-and-verify');
  });

  // ── Command: Walkthrough picker menu ──────────────────────────────────
  safeRegisterCommand(context, 'fpga-ip-core.openWalkthroughMenu', async () => {
    type WalkthroughItem = vscode.QuickPickItem & { id: string };
    const items: WalkthroughItem[] = [
      {
        label: '$(mortar-board) Design Your First IP Core',
        description: 'Start from scratch — canvas, bus interfaces, ports, and your first scaffold',
        id: 'fresh-ip-core',
      },
      {
        label: '$(circuit-board) IP Core with a Register Map',
        description: 'Memory-mapped registers with AXI-Lite or Avalon-MM bus decode',
        id: 'ip-core-with-registers',
      },
      {
        label: '$(file-code) Bring Your VHDL into IPCraft',
        description: 'Import an existing .vhd entity and generate vendor packaging',
        id: 'import-from-vhdl',
      },
      {
        label: '$(extensions) Import from Xilinx or Intel Tools',
        description: 'Convert hw.tcl or component.xml to a portable .ip.yml spec',
        id: 'import-from-vendor-tools',
      },
      {
        label: '$(pulse) Synthesize and Check Timing',
        description: 'Run OOC synthesis and read WNS / Fmax in the Build Reports panel',
        id: 'build-and-verify',
      },
      {
        label: '$(tools) Get Started with Scaffold Packs',
        description: 'Customise what IPCraft generates — file layout, naming, and templates',
        id: 'scaffold-packs-getting-started',
      },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Which guide would you like to follow?',
      title: 'IPCraft Walkthroughs',
      matchOnDescription: true,
    });
    if (!picked) {
      return;
    }

    await openWalkthrough(picked.id);
  });

  // ── File watcher: refresh preview when a .j2 template is saved ────────
  const j2Watcher = vscode.workspace.createFileSystemWatcher('**/*.j2');
  j2Watcher.onDidChange(async (uri) => {
    if (vscode.workspace.isTrusted) {
      await refreshTemplatePreview(context, previewProvider, uri);
    }
  });
  context.subscriptions.push(j2Watcher);

  // ── Document save watcher: refresh scaffold panel when scaffold.yml saved
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (vscode.workspace.isTrusted && path.basename(doc.fileName) === 'scaffold.yml') {
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
  const packNames = scaffoldPackLoader.listBuiltinPacks();
  if (packNames.length === 0) {
    void vscode.window.showErrorMessage('No built-in scaffold packs found.');
    return;
  }

  // Load metadata for each pack so we can show descriptions and group by category
  const packs = packNames.map((name) => {
    try {
      return ScaffoldPackLoader.load(path.join(scaffoldPackLoader.builtinPacksDirectory, name));
    } catch {
      return { name, description: undefined, category: undefined };
    }
  });

  // Group into sections: Built-in first, then Examples
  type PickItem = vscode.QuickPickItem & { packName: string };
  const items: PickItem[] = [];

  const addGroup = (label: string, filter: (c?: string) => boolean) => {
    const group = packs.filter((p) => filter(p.category));
    if (group.length === 0) {
      return;
    }
    items.push({ label, kind: vscode.QuickPickItemKind.Separator, packName: '' });
    for (const p of group) {
      items.push({
        label: p.name,
        description: p.description?.split('\n')[0].trim() ?? '',
        packName: p.name,
      });
    }
  };

  addGroup('Built-in', (c) => !c || c === 'builtin');
  addGroup('Examples', (c) => c === 'example');

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a scaffold pack to export to your workspace',
    title: 'Export Scaffold Pack',
    matchOnDescription: true,
  });
  if (!selected?.packName) {
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    void vscode.window.showErrorMessage('No workspace folder open.');
    return;
  }

  // Strip well-known prefixes so the exported name is clean
  const defaultName = selected.packName.replace(/^(builtin|example)-/, '');
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
  const srcDir = path.join(scaffoldPackLoader.builtinPacksDirectory, selected.packName);

  try {
    // Step 1: copy the pack directory (scaffold.yml + any pack-local templates)
    await copyDir(srcDir, destDir);

    // Step 2: copy all .j2 templates referenced by the pack into the pack directory
    // so the user can edit them immediately without hunting for them elsewhere.
    const pack = ScaffoldPackLoader.load(destDir);
    const copied = await copyReferencedTemplates(
      pack.files.map((r) => r.source),
      destDir
    );

    const templateNote =
      copied.length > 0
        ? ` Copied ${copied.length} template${copied.length !== 1 ? 's' : ''} for editing.`
        : '';

    void vscode.window
      .showInformationMessage(
        `Scaffold pack exported to .vscode/ipcraft/packs/${newName}/.${templateNote}`,
        'Open scaffold.yml'
      )
      .then(async (action) => {
        if (action === 'Open scaffold.yml') {
          const manifestUri = vscode.Uri.file(path.join(destDir, 'scaffold.yml'));
          const doc = await vscode.workspace.openTextDocument(manifestUri);
          await vscode.window.showTextDocument(doc);
          const panel = ScaffoldPackPanel.show(logger, context, globalResourceRoots);
          await panel.refresh(manifestUri.fsPath);
        }
      });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    void handleErrorWithUserNotification(err, 'exportScaffoldPack', `Export failed: ${msg}`);
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

/**
 * Copy every built-in .j2 template referenced by the exported pack into `destDir`
 * so the user can edit them immediately without digging into the extension bundle.
 *
 * Source expressions may be static (`"top.vhdl.j2"`) or Nunjucks strings
 * (`"bus_{{ bus_type }}.vhdl.j2"`). Dynamic parts are replaced with `*` and
 * resolved against the built-in templates directory using glob.
 *
 * Files that already exist in `destDir` (e.g. copied from the pack's own srcDir)
 * are skipped so user overrides are never clobbered.
 *
 * Returns the basenames of all files actually written.
 */
async function copyReferencedTemplates(
  sourceExpressions: string[],
  destDir: string
): Promise<string[]> {
  const templatesDir = globalResourceRoots.templatesDir;
  const copied: string[] = [];

  // Deduplicate expressions — many packs list the same source for VHDL and SV variants
  const seen = new Set<string>();
  const patterns = sourceExpressions
    .filter((expr) => expr.endsWith('.j2') || expr.includes('.j2'))
    .map((expr) => {
      // Convert Nunjucks placeholders to glob wildcards: {{ anything }} → *
      return expr.replace(/\{\{[^}]+\}\}/g, '*');
    })
    .filter((p) => {
      if (seen.has(p)) {
        return false;
      }
      seen.add(p);
      return true;
    });

  await Promise.all(
    patterns.map(async (pattern) => {
      const matches = globSync(pattern, { cwd: templatesDir, nodir: true });
      await Promise.all(
        matches.map(async (filename) => {
          const destPath = path.join(destDir, filename);
          // Skip if already present (pack's own copy takes priority)
          try {
            await fs.stat(destPath);
            return; // already exists
          } catch {
            // does not exist — safe to copy
          }
          await fs.copyFile(path.join(templatesDir, filename), destPath);
          copied.push(filename);
        })
      );
    })
  );

  return copied;
}
