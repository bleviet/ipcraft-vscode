import * as vscode from 'vscode';
import { STAGING_SCHEME, setStagingContent, clearStagingContent } from './StagingContentProvider';

export interface StagedFile {
  relativePath: string;
  status: 'new' | 'modified' | 'unchanged';
  /** True when the file is managed:false in fileSets and already exists on disk. */
  protected: boolean;
  content: string;
  diskPath: string;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode[];
  file?: StagedFile;
}

export class StagingPanel {
  /**
   * Show the staging dashboard and return true if the user confirmed, false if cancelled.
   * The panel is opened beside the current active editor.
   */
  static async show(files: StagedFile[]): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let resolved = false;
      const resolveOnce = (value: boolean) => {
        if (!resolved) {
          resolved = true;
          resolve(value);
        }
      };

      const panel = vscode.window.createWebviewPanel(
        'ipcraft-staging',
        'IPCraft — Preview Generated Files',
        vscode.ViewColumn.Beside,
        { enableScripts: true, retainContextWhenHidden: true }
      );

      // Populate the virtual document store so diffs and previews can be opened immediately.
      clearStagingContent();
      for (const f of files) {
        setStagingContent(`/${f.relativePath}`, f.content);
      }

      panel.webview.html = StagingPanel.buildHtml(files);

      const disposables: vscode.Disposable[] = [];
      // Shared column for all side-panel actions (diff and preview). Whichever
      // fires first pins the column; subsequent calls reuse it so VS Code's
      // preview: true can replace the existing tab instead of opening a new one.
      let sideColumn: vscode.ViewColumn | undefined;

      panel.webview.onDidReceiveMessage(
        async (message: { type: string; relativePath?: string }) => {
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
          } else if (message.type === 'apply') {
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
          disposables.forEach((d) => d.dispose());
          resolveOnce(false);
        },
        undefined,
        disposables
      );
    });
  }

  private static esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------------------------
  // Tree construction
  // ---------------------------------------------------------------------------

  private static buildTree(files: StagedFile[]): TreeNode {
    const root: TreeNode = { name: '', fullPath: '', isDir: true, children: [] };

    for (const file of files) {
      const parts = file.relativePath.split('/');
      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i === parts.length - 1) {
          node.children.push({
            name: part,
            fullPath: file.relativePath,
            isDir: false,
            children: [],
            file,
          });
        } else {
          const dirPath = parts.slice(0, i + 1).join('/');
          let dir = node.children.find((c) => c.isDir && c.name === part);
          if (!dir) {
            dir = { name: part, fullPath: dirPath, isDir: true, children: [] };
            node.children.push(dir);
          }
          node = dir;
        }
      }
    }

    const sort = (n: TreeNode) => {
      n.children.sort((a, b) => {
        if (a.isDir !== b.isDir) {
          return a.isDir ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      });
      n.children.forEach(sort);
    };
    sort(root);

    return root;
  }

  // ---------------------------------------------------------------------------
  // Tree rendering
  // ---------------------------------------------------------------------------

  private static readonly eyeSvg =
    `<svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">` +
    `<path d="M8 0C4.5 0 1.5 2.2 0 6c1.5 3.8 4.5 6 8 6s6.5-2.2 8-6C14.5 2.2 11.5 0 8 0z` +
    `m0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>`;

  // Closed padlock — used for protected (user-managed) files.
  private static readonly lockSvg =
    `<svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">` +
    `<rect x="0.5" y="4.5" width="7" height="5" rx="1" fill="currentColor"/>` +
    `<path d="M2 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
    `</svg>`;

  // Chevron-down SVG — rotated via CSS when collapsed.
  private static readonly chevronSvg =
    `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">` +
    `<path d="M1.5 3.5l3.5 3.5 3.5-3.5"/></svg>`;

  private static renderNode(node: TreeNode, depth: number): string {
    if (node.isDir && !node.name) {
      return node.children.map((c) => StagingPanel.renderNode(c, depth)).join('');
    }

    const px = (n: number) => `${n}px`;
    const base = 6;
    // step = chevron-box (14 px) + flex gap (6 px) so that file dots land
    // directly under the first letter of the parent directory name.
    const step = 20;

    if (node.isDir) {
      const id = `d-${node.fullPath.replace(/[^a-z0-9]/gi, '-')}`;
      const children = node.children.map((c) => StagingPanel.renderNode(c, depth + 1)).join('');
      // --guide-x: horizontal centre of this node's chevron icon.
      const guideX = px(base + depth * step + 7);
      return (
        `<div class="tree-dir">` +
        `<div class="tree-row tree-dir-header" style="padding-left:${px(base + depth * step)}" onclick="toggleDir('${id}')">` +
        `<span class="chevron" id="${id}-ch">${StagingPanel.chevronSvg}</span>` +
        `<span class="dir-name">${StagingPanel.esc(node.name)}/</span>` +
        `</div>` +
        `<div class="tree-children" id="${id}" style="--guide-x:${guideX}">${children}</div>` +
        `</div>`
      );
    }

    const file = node.file!;
    const isMuted = file.status === 'unchanged' || file.protected;
    const escapedPath = StagingPanel.esc(JSON.stringify(file.relativePath));

    const statusIndicator = file.protected
      ? `<span class="status-lock">${StagingPanel.lockSvg}</span>`
      : `<span class="dot dot-${file.status}"></span>`;

    const diffBtn =
      file.status === 'modified' || file.protected
        ? `<button class="btn-action btn-diff" onclick="viewDiff(${escapedPath})">View Diff</button>`
        : '';
    const previewBtn =
      file.status === 'new'
        ? `<button class="btn-action btn-preview" onclick="viewPreview(${escapedPath})" title="Preview generated file">${StagingPanel.eyeSvg}</button>`
        : '';

    // padding-left matches the dir-header at this depth — dot aligns with parent dir-name.
    return (
      `<div class="tree-row tree-file-row${isMuted ? ' muted' : ''}" style="padding-left:${px(base + depth * step)}">` +
      statusIndicator +
      `<span class="file-name">${StagingPanel.esc(node.name)}</span>` +
      diffBtn +
      previewBtn +
      `</div>`
    );
  }

  // ---------------------------------------------------------------------------
  // HTML shell
  // ---------------------------------------------------------------------------

  private static buildHtml(files: StagedFile[]): string {
    const modified = files.filter((f) => f.status === 'modified' && !f.protected);
    const newFiles = files.filter((f) => f.status === 'new');
    const unchanged = files.filter((f) => f.status === 'unchanged');
    const protectedFiles = files.filter((f) => f.protected);

    const hasApplicableFiles = modified.length > 0 || newFiles.length > 0;
    const allNewOnly = modified.length === 0 && newFiles.length > 0;

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
        si(
          `<span class="status-lock">${StagingPanel.lockSvg}</span>`,
          `${protectedFiles.length} protected`
        )
      );
    }
    const summaryHtml = summaryItems.join('<span class="summary-sep">·</span>');

    let noApplyBanner = '';
    if (!hasApplicableFiles) {
      if (protectedFiles.length > 0 && unchanged.length === 0) {
        noApplyBanner = `<div class="banner">All modified files are user-managed (managed: false) and will not be overwritten.</div>`;
      } else if (protectedFiles.length > 0) {
        noApplyBanner = `<div class="banner">&#10003; All files are either unchanged or user-managed — nothing to apply.</div>`;
      } else {
        noApplyBanner = `<div class="banner">&#10003; All files are up to date — nothing to apply.</div>`;
      }
    }

    const tree = StagingPanel.buildTree(files);
    const treeHtml = StagingPanel.renderNode(tree, 0);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>IPCraft — Preview Generated Files</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--vscode-font-family);
  font-size:var(--vscode-font-size);
  color:var(--vscode-foreground);
  background:var(--vscode-editor-background);
  display:flex;flex-direction:column;height:100vh;
}
.header{
  padding:14px 20px 10px;
  border-bottom:1px solid var(--vscode-panel-border);
  flex-shrink:0;
}
.header h1{font-size:14px;font-weight:600;margin-bottom:4px}
.summary{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:4px}
.summary-item{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--vscode-descriptionForeground)}
.summary-sep{font-size:11px;color:var(--vscode-descriptionForeground);opacity:.4;padding:0 2px}
.content{flex:1;overflow-y:auto;padding:10px 16px}
/* ── tree ─────────────────────────────────────────────────────────────── */
.tree-row{
  display:flex;align-items:center;gap:6px;
  border-radius:3px;padding-top:3px;padding-bottom:3px;padding-right:8px;
  min-height:22px;
}
.tree-dir-header{cursor:pointer;user-select:none}
.tree-dir-header:hover{background:var(--vscode-list-hoverBackground)}
.tree-file-row:hover{background:var(--vscode-list-activeSelectionBackground)}
.tree-file-row.muted{opacity:0.55}
.tree-children{position:relative}
.tree-children::before{
  content:'';position:absolute;
  left:var(--guide-x,12px);top:0;bottom:4px;
  width:1px;
  background:var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.18));
  pointer-events:none;
}
.tree-children.collapsed{display:none}
/* chevron */
.chevron{
  display:flex;align-items:center;justify-content:center;
  width:14px;height:14px;flex-shrink:0;
  color:var(--vscode-descriptionForeground);
  transition:transform 0.15s;
}
.chevron svg{stroke:currentColor;stroke-width:1.5;fill:none}
.chevron.collapsed{transform:rotate(-90deg)}
/* dir / file labels */
.dir-name{
  font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
  color:var(--vscode-descriptionForeground);
}
.file-name{
  font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
  color:var(--vscode-foreground);
  flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
/* status dot */
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-new{background:#4ea44e}
.dot-modified{background:#d4a83a}
.dot-unchanged{background:#888}
.status-lock{display:inline-flex;align-items:center;flex-shrink:0;color:var(--vscode-foreground)}
/* action buttons — revealed on row hover */
.btn-action{
  font-family:var(--vscode-font-family);
  border:none;border-radius:3px;cursor:pointer;flex-shrink:0;
  opacity:0;transition:opacity 0.12s;
}
.tree-row:hover .btn-action{opacity:1}
.btn-diff{
  font-size:11px;padding:2px 8px;
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
}
.btn-diff:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn-preview{
  display:flex;align-items:center;justify-content:center;
  padding:3px 5px;
  background:transparent;
  color:var(--vscode-descriptionForeground);
}
.btn-preview:hover{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
}
/* ── footer / banner ──────────────────────────────────────────────────── */
.footer{
  padding:10px 20px;border-top:1px solid var(--vscode-panel-border);
  display:flex;gap:8px;flex-shrink:0;
}
.btn-apply{
  font-family:var(--vscode-font-family);font-size:13px;font-weight:500;
  padding:5px 16px;
  background:var(--vscode-button-background);color:var(--vscode-button-foreground);
  border:none;border-radius:3px;cursor:pointer;
}
.btn-apply:hover{background:var(--vscode-button-hoverBackground)}
.btn-cancel{
  font-family:var(--vscode-font-family);font-size:13px;
  padding:5px 16px;
  background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);
  border:none;border-radius:3px;cursor:pointer;
}
.btn-cancel:hover{background:var(--vscode-button-secondaryHoverBackground)}
.banner{
  padding:10px 12px;margin-bottom:12px;border-radius:4px;
  background:var(--vscode-diffEditor-unchangedRegionBackground,rgba(128,128,128,.1));
  color:var(--vscode-descriptionForeground);font-size:12px;
}
</style>
</head>
<body>
<div class="header">
  <h1>IPCraft — Preview Generated Files</h1>
  <div class="summary">${summaryHtml}</div>
</div>
<div class="content">${noApplyBanner}<div class="tree">${treeHtml}</div></div>
<div class="footer">
  <button class="btn-apply" onclick="${hasApplicableFiles ? 'apply()' : 'cancel()'}">
    ${applyLabel}
  </button>
  ${hasApplicableFiles ? '<button class="btn-cancel" onclick="cancel()">&#10005; Cancel</button>' : ''}
</div>
<script>
const vscode = acquireVsCodeApi();
function viewDiff(p){vscode.postMessage({type:'viewDiff',relativePath:p});}
function viewPreview(p){vscode.postMessage({type:'viewPreview',relativePath:p});}
function apply(){vscode.postMessage({type:'apply'});}
function cancel(){vscode.postMessage({type:'cancel'});}
function toggleDir(id){
  const el = document.getElementById(id);
  const ch = document.getElementById(id + '-ch');
  if (!el) return;
  const closing = !el.classList.contains('collapsed');
  el.classList.toggle('collapsed', closing);
  if (ch) ch.classList.toggle('collapsed', closing);
}
</script>
</body>
</html>`;
  }
}
