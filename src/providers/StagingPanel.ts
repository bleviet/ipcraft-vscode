import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { STAGING_SCHEME, setStagingContent, clearStagingContent } from './StagingContentProvider';
import { openMergeEditorForConflict } from '../utils/importWrite';
import {
  renderFileTree,
  escHtml,
  TREE_CSS,
  LOCK_SVG,
  type TreeRenderHooks,
} from './webview/FileTreeRenderer';
import {
  renderStagingActionChoice,
  renderStagingBadges,
  STAGING_ACTIONS_CSS,
} from './webview/stagingActionsHtml';
import {
  allKeptBanner,
  parseStagingActions,
  type InterfaceDrift,
  type StagingAction,
} from '../shared/staging';

export type { InterfaceDrift, StagingAction };

export interface StagedFile {
  relativePath: string;
  status: 'new' | 'modified' | 'unchanged';
  /** True when the file is managed:false in fileSets and already exists on disk. */
  protected: boolean;
  content: string;
  diskPath: string;
  /**
   * Set when this file came from IPCraft's default framework testbench generation (tb/*,
   * .vscode/settings.json) rather than the active scaffold pack's own file rules (issue #156) —
   * the staging UI badges these so their presence is self-explanatory instead of blending in
   * with pack-generated output.
   */
  origin?: 'framework-testbench';
  /** Last content IPCraft generated for this path, when a baseline exists. */
  baseline?: string;
  /** Baseline exists and the on-disk file differs from it. */
  handEdited?: boolean;
  /** Clean diff3 result (base=baseline, current=disk, incoming=generated); absent on conflict / no baseline / not hand-edited. */
  autoMergeContent?: string;
  /** On-disk file with only its entity/module header replaced by the generated one (HDL only). */
  syncedContent?: string;
  /** Entity/module interface differences, on-disk vs generated (HDL only, only when non-empty). */
  interfaceDrift?: InterfaceDrift;
  /** Actions offered for a modified file (the merge editor is separate). Empty for new/unchanged. */
  actions: StagingAction[];
  /** Pre-selected action for a modified file; undefined for new/unchanged. */
  defaultAction?: StagingAction;
}

/**
 * The user's decision from the staging UI.
 *
 * `mergedPaths` are files the user chose to reconcile in the 3-way merge editor;
 * the merge editor writes them on completion, so the bulk apply must exclude them
 * to avoid clobbering the merge result.
 *
 * `actions` is the chosen action per modified file path (defaults to each
 * file's `defaultAction`); the bulk apply writes according to it.
 */
export interface StagingDecision {
  confirmed: boolean;
  mergedPaths: string[];
  actions: Record<string, StagingAction>;
}

/**
 * Opens the 3-way merge editor for one staged file (current on disk vs. the
 * generated content). Shared by both staging UIs. Returns true if it opened.
 */
export async function mergeStagedFile(file: StagedFile): Promise<boolean> {
  const diskUri = vscode.Uri.file(file.diskPath);
  let current = '';
  try {
    current = new TextDecoder().decode(await vscode.workspace.fs.readFile(diskUri));
  } catch {
    current = ''; // file vanished since categorization — treat as empty base
  }
  return openMergeEditorForConflict(diskUri, current, file.content, 'Generated', file.baseline);
}

export class StagingPanel {
  /**
   * Show the staging dashboard and return true if the user confirmed, false if cancelled.
   * The panel is opened beside the current active editor.
   */
  static async show(files: StagedFile[], warnings: string[] = []): Promise<StagingDecision> {
    return new Promise<StagingDecision>((resolve) => {
      let resolved = false;
      // Files the user reconciled in the merge editor — excluded from bulk apply.
      const mergedPaths = new Set<string>();
      // Chosen action per modified file — set from the 'apply' message,
      // which carries the webview's current per-file state.
      let actions: Record<string, StagingAction> = {};
      const resolveOnce = (confirmed: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve({ confirmed, mergedPaths: [...mergedPaths], actions });
        }
      };

      const panel = vscode.window.createWebviewPanel(
        'ipcraft-staging',
        'IPCraft — Preview Generated Files',
        vscode.ViewColumn.Beside,
        // This panel's HTML is fully self-contained (inline styles + a single
        // nonce'd inline script); it loads zero local resources, so the tightest
        // correct lockdown is an empty resource-root list rather than the
        // default (which would grant read access to every workspace folder).
        { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] }
      );

      // Populate the virtual document store so diffs and previews can be opened immediately.
      clearStagingContent();
      for (const f of files) {
        setStagingContent(`/${f.relativePath}`, f.content);
      }

      panel.webview.html = StagingPanel.buildHtml(files, warnings);

      const disposables: vscode.Disposable[] = [];
      // Shared column for all side-panel actions (diff and preview). Whichever
      // fires first pins the column; subsequent calls reuse it so VS Code's
      // preview: true can replace the existing tab instead of opening a new one.
      let sideColumn: vscode.ViewColumn | undefined;

      panel.webview.onDidReceiveMessage(
        async (message: { type: string; relativePath?: string; actions?: unknown }) => {
          if (message.type === 'viewDiff' && message.relativePath) {
            const file = files.find((f) => f.relativePath === message.relativePath);
            if (!file) {
              return;
            }
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
              { preview: true, viewColumn: sideColumn ?? vscode.ViewColumn.Beside }
            );
            if (diffEditor?.viewColumn !== undefined) {
              sideColumn = diffEditor.viewColumn;
            }
          } else if (message.type === 'viewPreview' && message.relativePath) {
            const file = files.find((f) => f.relativePath === message.relativePath);
            if (!file) {
              return;
            }
            const generatedUri = vscode.Uri.from({
              scheme: STAGING_SCHEME,
              path: `/${file.relativePath}`,
            });
            const doc = await vscode.workspace.openTextDocument(generatedUri);
            const editor = await vscode.window.showTextDocument(doc, {
              preview: true,
              viewColumn: sideColumn ?? vscode.ViewColumn.Beside,
            });
            if (editor.viewColumn !== undefined) {
              sideColumn = editor.viewColumn;
            }
          } else if (message.type === 'merge' && message.relativePath) {
            const file = files.find((f) => f.relativePath === message.relativePath);
            if (!file) {
              return;
            }
            if (await mergeStagedFile(file)) {
              mergedPaths.add(file.relativePath);
              void panel.webview.postMessage({
                type: 'fileMerged',
                relativePath: file.relativePath,
              });
            }
          } else if (message.type === 'apply') {
            actions = parseStagingActions(message.actions);
            resolveOnce(true);
            panel.dispose();
          } else if (message.type === 'cancel') {
            resolveOnce(false);
            panel.dispose();
          }
        },
        undefined,
        disposables
      );

      panel.onDidDispose(
        () => {
          disposables.forEach((d) => {
            d.dispose();
          });
          resolveOnce(false);
        },
        undefined,
        disposables
      );
    });
  }

  // Eye SVG for the "preview generated file" action button (staging-only).
  private static readonly eyeSvg =
    `<svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">` +
    `<path d="M8 0C4.5 0 1.5 2.2 0 6c1.5 3.8 4.5 6 8 6s6.5-2.2 8-6C14.5 2.2 11.5 0 8 0z` +
    `m0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>`;

  // ---------------------------------------------------------------------------
  // Per-row rendering hooks injected into the shared FileTreeRenderer.
  // ---------------------------------------------------------------------------

  private static readonly treeHooks: TreeRenderHooks<StagedFile> = {
    muted: (f) => f.status === 'unchanged' || f.defaultAction === 'keep',
    indicator: (f) =>
      f.protected
        ? `<span class="status-lock">${LOCK_SVG}</span>`
        : `<span class="dot dot-${f.status}"></span>`,
    trailing: (f) => {
      // HTML-escaped relative path carried in a data-* attribute (no inline JS).
      const dataPath = escHtml(f.relativePath);
      const diffBtn =
        f.status === 'modified' || f.protected
          ? `<button class="btn-action btn-diff" data-diff="${dataPath}">View Diff</button>`
          : '';
      // Merge is only meaningful for a real conflict between the generated
      // content and what is already on disk — protected files qualify too,
      // since merge writes directly to disk independent of the lock.
      const mergeBtn =
        f.status === 'modified'
          ? `<button class="btn-action btn-merge" data-merge="${dataPath}" title="Reconcile this file in the 3-way merge editor (excluded from Apply)">Merge</button>`
          : '';
      // Every modified file gets an explicit action choice, seeded from its
      // `defaultAction`; clicks are handled by the inline script below.
      const actionChoice = f.status === 'modified' ? renderStagingActionChoice(f) : '';
      const previewBtn =
        f.status === 'new'
          ? `<button class="btn-action btn-preview" data-preview="${dataPath}" title="Preview generated file">${StagingPanel.eyeSvg}</button>`
          : '';
      const frameworkBadge =
        f.origin === 'framework-testbench'
          ? `<span class="badge-framework" title="Generated by IPCraft's default framework testbench (tb/*, .vscode/settings.json) — not part of the active scaffold pack's own output">framework</span>`
          : '';
      return (
        frameworkBadge + renderStagingBadges(f) + diffBtn + mergeBtn + actionChoice + previewBtn
      );
    },
  };

  // ---------------------------------------------------------------------------
  // HTML shell
  // ---------------------------------------------------------------------------

  private static buildHtml(files: StagedFile[], warnings: string[] = []): string {
    const modified = files.filter((f) => f.status === 'modified' && !f.protected);
    const newFiles = files.filter((f) => f.status === 'new');
    const unchanged = files.filter((f) => f.status === 'unchanged');
    const protectedFiles = files.filter((f) => f.protected);
    // Protected files with real changes — each can individually opt into Apply
    // via its action choice, so their presence alone makes Apply meaningful.
    const protectedModified = protectedFiles.filter((f) => f.status === 'modified');

    const hasApplicableFiles =
      modified.length > 0 || newFiles.length > 0 || protectedModified.length > 0;
    const allNewOnly =
      modified.length === 0 && newFiles.length > 0 && protectedModified.length === 0;

    const applyLabel = hasApplicableFiles
      ? allNewOnly
        ? '&#10003; Create Files'
        : '&#10003; Confirm &amp; Apply'
      : 'Close';

    const dot = (cls: string) => `<span class="dot ${cls}"></span>`;
    const si = (indicator: string, label: string) =>
      `<span class="summary-item">${indicator}${label}</span>`;
    const summaryItems: string[] = [];
    if (modified.length) {
      summaryItems.push(si(dot('dot-modified'), `${modified.length} modified`));
    }
    if (newFiles.length) {
      summaryItems.push(si(dot('dot-new'), `${newFiles.length} new`));
    }
    if (unchanged.length) {
      summaryItems.push(si(dot('dot-unchanged'), `${unchanged.length} unchanged`));
    }
    if (protectedFiles.length) {
      summaryItems.push(
        si(`<span class="status-lock">${LOCK_SVG}</span>`, `${protectedFiles.length} protected`)
      );
    }
    const summaryHtml = summaryItems.join('<span class="summary-sep">·</span>');

    let noApplyBanner = '';
    const keptText = allKeptBanner(files, (f) => f.defaultAction ?? 'keep');
    if (keptText) {
      noApplyBanner = `<div class="banner">${keptText}</div>`;
    } else if (!hasApplicableFiles) {
      if (protectedFiles.length > 0) {
        noApplyBanner = `<div class="banner">&#10003; All files are either unchanged or user-managed — nothing to apply.</div>`;
      } else {
        noApplyBanner = `<div class="banner">&#10003; All files are up to date — nothing to apply.</div>`;
      }
    }

    const warningBanner = warnings.length
      ? warnings.map((w) => `<div class="banner banner-warning">${escHtml(w)}</div>`).join('')
      : '';

    const treeHtml = renderFileTree(files, StagingPanel.treeHooks);

    // Each modified file's default action seeds the script's action map.
    // `<` is escaped so a pathological path can't break out of the <script> tag.
    const defaultActions = JSON.stringify(
      Object.fromEntries(
        files
          .filter((f) => f.status === 'modified' && f.defaultAction !== undefined)
          .map((f) => [f.relativePath, f.defaultAction])
      )
    ).replace(/</g, '\\u003c');

    // Per-render nonce so the inline <script> can run while the CSP stays
    // fail-closed: an accidentally-unescaped value can no longer execute.
    const nonce = randomBytes(16).toString('base64');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>IPCraft — Preview Generated Files</title>
<style>
${TREE_CSS}
${STAGING_ACTIONS_CSS}
.header h1{font-size:14px;font-weight:600;margin-bottom:4px}
.summary{margin-top:4px}
.tree-file-row:hover{background:var(--vscode-list-activeSelectionBackground)}
.tree-file-row.muted{opacity:0.55}
/* A locked+modified file can show several action buttons (View Diff, Merge,
   the action choice) at once — wrap instead of forcing a horizontal scrollbar. */
.tree-file-row{flex-wrap:wrap;row-gap:2px}
.dot-new{background:#4ea44e}
.dot-modified{background:#d4a83a}
.dot-unchanged{background:#888}
/* Action buttons revealed on row hover. display:none (not opacity:0) so a
   hidden button reserves no row width — otherwise the filename gets
   squeezed/truncated by buttons that aren't even visible yet. */
.btn-action{font-family:var(--vscode-font-family);border:none;border-radius:3px;cursor:pointer;flex-shrink:0;display:none}
.tree-row:hover .btn-action{display:inline-flex;align-items:center;justify-content:center}
.btn-diff{font-size:11px;padding:2px 8px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-diff:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn-merge{font-size:11px;padding:2px 8px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-merge:hover{background:var(--vscode-button-secondaryHoverBackground)}
/* Persistent (not hover-gated) once a file has been sent to the merge editor. */
.btn-merge.btn-merged{display:inline-flex;background:transparent;color:var(--vscode-charts-green,#4ea44e);cursor:default}
.tree-file-row.will-overwrite .status-lock{color:var(--vscode-charts-orange,#d18616)}
.btn-preview{padding:3px 5px;background:transparent;color:var(--vscode-descriptionForeground)}
.btn-preview:hover{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
/* footer / banner */
.footer{padding:10px 20px;border-top:1px solid var(--vscode-panel-border);display:flex;gap:8px;flex-shrink:0}
.btn-apply{font-family:var(--vscode-font-family);font-size:13px;font-weight:500;padding:5px 16px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:none;border-radius:3px;cursor:pointer}
.btn-apply:hover{background:var(--vscode-button-hoverBackground)}
.btn-cancel{font-family:var(--vscode-font-family);font-size:13px;padding:5px 16px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:none;border-radius:3px;cursor:pointer}
.btn-cancel:hover{background:var(--vscode-button-secondaryHoverBackground)}
.banner{padding:10px 12px;margin-bottom:12px;border-radius:4px;background:var(--vscode-diffEditor-unchangedRegionBackground,rgba(128,128,128,.1));color:var(--vscode-descriptionForeground);font-size:12px}
.banner-warning{background:var(--vscode-inputValidation-warningBackground,rgba(212,168,58,.15));color:var(--vscode-inputValidation-warningForeground,var(--vscode-foreground));border:1px solid var(--vscode-inputValidation-warningBorder,transparent)}
.badge-framework{display:inline-flex;align-items:center;flex-shrink:0;padding:1px 6px;border-radius:10px;font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;background:color-mix(in srgb,var(--vscode-charts-blue,#3794ff) 16%,transparent);color:var(--vscode-charts-blue,#3794ff);border:1px solid color-mix(in srgb,var(--vscode-charts-blue,#3794ff) 30%,transparent);white-space:nowrap}
</style>
</head>
<body>
<div class="header">
  <h1>IPCraft — Preview Generated Files</h1>
  <div class="summary">${summaryHtml}</div>
</div>
<div class="content">${warningBanner}${noApplyBanner}<div class="tree">${treeHtml}</div></div>
<div class="footer">
  <button class="btn-apply" data-action="${hasApplicableFiles ? 'apply' : 'cancel'}">
    ${applyLabel}
  </button>
  ${hasApplicableFiles ? '<button class="btn-cancel" data-action="cancel">&#10005; Cancel</button>' : ''}
</div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
// Chosen action per modified file, seeded from each file's default action.
// Sent with 'apply'.
const actions = ${defaultActions};
function toggleDir(id){
  const el = document.getElementById(id);
  const ch = document.getElementById(id + '-ch');
  if (!el) return;
  const closing = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', closing);
  if (ch) ch.classList.toggle('collapsed', closing);
}
function chooseAction(btn){
  const path = btn.dataset.path;
  const choice = btn.dataset.choice;
  actions[path] = choice;
  const row = btn.closest('.tree-file-row');
  btn.parentElement.querySelectorAll('[data-choice]').forEach((b) => {
    const active = b === btn;
    b.classList.toggle('choice-active', active);
    b.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-chosen-for]').forEach((el) => {
    if (el.dataset.chosenFor === path) el.textContent = btn.textContent;
  });
  document.querySelectorAll('[data-hint-for]').forEach((el) => {
    if (el.dataset.hintFor === path) el.hidden = choice !== 'sync-interface';
  });
  if (row) {
    // Muted = kept on disk; will-overwrite only recolors the padlock icon on a
    // protected row whose action is not Keep.
    row.classList.toggle('muted', choice === 'keep');
    row.classList.toggle('will-overwrite', choice !== 'keep');
  }
}
// Single delegated, nonce-gated click handler — no inline JS anywhere in markup.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle],[data-diff],[data-merge],[data-choice],[data-preview],[data-action]');
  if (!t) return;
  if (t.dataset.toggle !== undefined) { toggleDir(t.dataset.toggle); return; }
  if (t.dataset.diff !== undefined) { vscode.postMessage({ type: 'viewDiff', relativePath: t.dataset.diff }); return; }
  if (t.dataset.merge !== undefined) { vscode.postMessage({ type: 'merge', relativePath: t.dataset.merge }); return; }
  if (t.dataset.choice !== undefined) { chooseAction(t); return; }
  if (t.dataset.preview !== undefined) { vscode.postMessage({ type: 'viewPreview', relativePath: t.dataset.preview }); return; }
  if (t.dataset.action) { vscode.postMessage({ type: t.dataset.action, actions }); }
});
// Mark a file's Merge button once its merge editor has opened — it is now
// excluded from Apply. Also drop its action choice: the merge editor is already
// reconciling it, so applying an action would race the merge result.
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || m.type !== 'fileMerged' || !m.relativePath) return;
  document.querySelectorAll('[data-merge]').forEach((b) => {
    if (b.dataset.merge === m.relativePath) {
      b.textContent = '✓ Merging';
      b.classList.add('btn-merged');
      b.removeAttribute('data-merge');
    }
  });
  delete actions[m.relativePath];
  document.querySelectorAll('[data-chosen-for],[data-hint-for]').forEach((el) => {
    if ((el.dataset.chosenFor || el.dataset.hintFor) === m.relativePath) el.remove();
  });
  document.querySelectorAll('.action-group').forEach((g) => {
    const first = g.querySelector('[data-path]');
    if (first && first.dataset.path === m.relativePath) {
      first.closest('.tree-file-row')?.classList.remove('will-overwrite');
      g.remove();
    }
  });
});
</script>
</body>
</html>`;
  }
}
