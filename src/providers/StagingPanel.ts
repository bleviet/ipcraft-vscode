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
}

/**
 * The user's decision from the staging UI.
 *
 * `mergedPaths` are files the user chose to reconcile in the 3-way merge editor;
 * the merge editor writes them on completion, so the bulk apply must exclude them
 * to avoid clobbering the merge result.
 *
 * `overwritePaths` are every modified file the user left (or set) to "will be
 * applied" — defaults to all normal modified files plus none of the protected
 * (`managed: false`) ones; the bulk apply writes exactly this set.
 */
export interface StagingDecision {
  confirmed: boolean;
  mergedPaths: string[];
  overwritePaths: string[];
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
  return openMergeEditorForConflict(diskUri, current, file.content, 'Generated');
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
      // Files that will be written on Apply — set from the 'apply' message,
      // which carries the webview's current per-file toggle state.
      let overwritePaths: string[] = [];
      const resolveOnce = (confirmed: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve({ confirmed, mergedPaths: [...mergedPaths], overwritePaths });
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
        async (message: { type: string; relativePath?: string; overwritePaths?: unknown }) => {
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
            overwritePaths = Array.isArray(message.overwritePaths)
              ? message.overwritePaths.filter((p): p is string => typeof p === 'string')
              : [];
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
    muted: (f) => f.status === 'unchanged' || f.protected,
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
      // Every modified file gets an explicit accept/skip toggle: the user
      // either takes the generated content as-is (Overwrite) or reconciles it
      // (Merge). Defaults to on for normal files (today's implicit
      // Apply-everything behavior) and off for protected files (today's
      // implicit skip) — see the default seeding in the inline script below.
      const overwriteBtn =
        f.status === 'modified'
          ? `<button class="btn-action btn-overwrite${f.protected ? '' : ' btn-overwrite-active'}" data-overwrite="${dataPath}" title="${
              f.protected
                ? 'Include this file in Apply, overwriting it on disk'
                : 'Included in Apply — click to exclude this file instead'
            }">${f.protected ? 'Overwrite' : '✓ Overwrite'}</button>`
          : '';
      const previewBtn =
        f.status === 'new'
          ? `<button class="btn-action btn-preview" data-preview="${dataPath}" title="Preview generated file">${StagingPanel.eyeSvg}</button>`
          : '';
      const frameworkBadge =
        f.origin === 'framework-testbench'
          ? `<span class="badge-framework" title="Generated by IPCraft's default framework testbench (tb/*, .vscode/settings.json) — not part of the active scaffold pack's own output">framework</span>`
          : '';
      return frameworkBadge + diffBtn + mergeBtn + overwriteBtn + previewBtn;
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
    // via its Overwrite toggle, so their presence alone makes Apply meaningful.
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
    if (protectedModified.length > 0 && modified.length === 0 && newFiles.length === 0) {
      noApplyBanner = `<div class="banner">${protectedModified.length} file(s) are user-managed (managed: false) and locked — use Overwrite on a file to include it in Apply anyway.</div>`;
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

    // Files whose Overwrite toggle starts "on" — every normal modified file,
    // matching today's implicit Apply-everything behavior. Protected files
    // start off. Embedded into the script below to seed its overwrite set.
    // `<` is escaped so a pathological path can't break out of the <script> tag.
    const defaultOverwritePaths = JSON.stringify(modified.map((f) => f.relativePath)).replace(
      /</g,
      '\\u003c'
    );

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
.header h1{font-size:14px;font-weight:600;margin-bottom:4px}
.summary{margin-top:4px}
.tree-file-row:hover{background:var(--vscode-list-activeSelectionBackground)}
.tree-file-row.muted{opacity:0.55}
/* A locked+modified file can show three action buttons (View Diff, Merge,
   Overwrite) at once — wrap instead of forcing a horizontal scrollbar. */
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
.btn-overwrite{font-size:11px;padding:2px 8px;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.btn-overwrite:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn-overwrite.btn-overwrite-active{background:var(--vscode-inputValidation-warningBackground,#5a3d00);color:var(--vscode-inputValidation-warningForeground,#fff)}
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
// Files that will be written on Apply — every normal modified file starts in
// here (matching today's implicit apply-everything behavior); protected files
// start out, opted in per-file via the Overwrite toggle. Sent with 'apply'.
const overwritePaths = new Set(${defaultOverwritePaths});
function toggleDir(id){
  const el = document.getElementById(id);
  const ch = document.getElementById(id + '-ch');
  if (!el) return;
  const closing = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', closing);
  if (ch) ch.classList.toggle('collapsed', closing);
}
function toggleOverwrite(btn){
  const path = btn.dataset.overwrite;
  const row = btn.closest('.tree-file-row');
  const willOverwrite = !overwritePaths.has(path);
  if (willOverwrite) {
    overwritePaths.add(path);
    btn.textContent = '✓ Overwrite';
    btn.classList.add('btn-overwrite-active');
    btn.title = 'Included in Apply — click to exclude this file instead';
  } else {
    overwritePaths.delete(path);
    btn.textContent = 'Overwrite';
    btn.classList.remove('btn-overwrite-active');
    btn.title = 'Include this file in Apply, overwriting it on disk';
  }
  if (row) {
    // Muted = excluded from Apply; applies equally to a locked file the user
    // hasn't opted in and a normal file they opted out of. will-overwrite only
    // recolors the padlock icon on a protected row that is now included.
    row.classList.toggle('muted', !willOverwrite);
    row.classList.toggle('will-overwrite', willOverwrite);
  }
}
// Single delegated, nonce-gated click handler — no inline JS anywhere in markup.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle],[data-diff],[data-merge],[data-overwrite],[data-preview],[data-action]');
  if (!t) return;
  if (t.dataset.toggle !== undefined) { toggleDir(t.dataset.toggle); return; }
  if (t.dataset.diff !== undefined) { vscode.postMessage({ type: 'viewDiff', relativePath: t.dataset.diff }); return; }
  if (t.dataset.merge !== undefined) { vscode.postMessage({ type: 'merge', relativePath: t.dataset.merge }); return; }
  if (t.dataset.overwrite !== undefined) { toggleOverwrite(t); return; }
  if (t.dataset.preview !== undefined) { vscode.postMessage({ type: 'viewPreview', relativePath: t.dataset.preview }); return; }
  if (t.dataset.action) { vscode.postMessage({ type: t.dataset.action, overwritePaths: [...overwritePaths] }); }
});
// Mark a file's Merge button once its merge editor has opened — it is now
// excluded from Apply. Also drop any Overwrite toggle for that file: the merge
// editor is already reconciling it, so overwriting would race the merge result.
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
  overwritePaths.delete(m.relativePath);
  document.querySelectorAll('[data-overwrite]').forEach((b) => {
    if (b.dataset.overwrite === m.relativePath) {
      b.closest('.tree-file-row')?.classList.remove('will-overwrite');
      b.remove();
    }
  });
});
</script>
</body>
</html>`;
  }
}
