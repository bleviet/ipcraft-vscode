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
      // Tracks the column where the first preview was opened so all subsequent
      // previews reuse the same tab (preview:true replaces within the same column).
      let previewColumn: vscode.ViewColumn | undefined;

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
            await vscode.commands.executeCommand(
              'vscode.diff',
              diskUri,
              generatedUri,
              `${filename}: Current ↔ Generated`,
              { preview: true }
            );
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
              viewColumn: previewColumn ?? vscode.ViewColumn.Beside,
            });
            if (editor.viewColumn !== undefined) {
              previewColumn = editor.viewColumn;
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

  private static splitPath(relativePath: string): { dir: string; filename: string } {
    const lastSlash = relativePath.lastIndexOf('/');
    if (lastSlash === -1) {
      return { dir: '', filename: relativePath };
    }
    return {
      dir: relativePath.slice(0, lastSlash + 1),
      filename: relativePath.slice(lastSlash + 1),
    };
  }

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

    // SVG eye icon used in preview buttons.
    const eyeSvg = `<svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true"><path d="M8 0C4.5 0 1.5 2.2 0 6c1.5 3.8 4.5 6 8 6s6.5-2.2 8-6C14.5 2.2 11.5 0 8 0zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"/></svg>`;

    const fileRow = (f: StagedFile, showDiff: boolean, showPreview = false) => {
      const { dir, filename } = StagingPanel.splitPath(f.relativePath);
      const pathHtml = dir
        ? `<span class="path-dir">${StagingPanel.esc(dir)}</span><span class="path-file">${StagingPanel.esc(filename)}</span>`
        : `<span class="path-file">${StagingPanel.esc(filename)}</span>`;
      const escapedPath = StagingPanel.esc(JSON.stringify(f.relativePath));
      return `
      <div class="file-row">
        <span class="file-path">${pathHtml}</span>
        ${showDiff ? `<button class="btn-diff" onclick="viewDiff(${escapedPath})">View Diff</button>` : ''}
        ${showPreview ? `<button class="btn-preview" onclick="viewPreview(${escapedPath})" title="Preview generated file">${eyeSvg}</button>` : ''}
      </div>`;
    };

    const section = (dotClass: string, label: string, rows: string, collapsed = true) => `
      <div class="section">
        <div class="section-header ${collapsed ? 'collapsible' : ''}" ${collapsed ? `onclick="toggleSection('${dotClass}-list')"` : ''}>
          <span class="dot ${dotClass}"></span>
          <span>${label}</span>
          ${collapsed ? `<span class="toggle-hint" id="${dotClass}-list-hint">show</span>` : ''}
        </div>
        <div class="file-list" ${collapsed ? `id="${dotClass}-list" style="display:none"` : ''}>${rows}</div>
      </div>`;

    const summaryParts: string[] = [];
    if (modified.length) {
      summaryParts.push(`${modified.length} modified`);
    }
    if (newFiles.length) {
      summaryParts.push(`${newFiles.length} new`);
    }
    if (unchanged.length) {
      summaryParts.push(`${unchanged.length} unchanged`);
    }
    if (protectedFiles.length) {
      summaryParts.push(`${protectedFiles.length} protected`);
    }

    let noApplyBanner = '';
    if (!hasApplicableFiles) {
      if (protectedFiles.length > 0 && unchanged.length === 0) {
        noApplyBanner = `<div class="up-to-date">All modified files are user-managed (managed: false) and will not be overwritten.</div>`;
      } else if (protectedFiles.length > 0) {
        noApplyBanner = `<div class="up-to-date">&#10003; All files are either unchanged or user-managed — nothing to apply.</div>`;
      } else {
        noApplyBanner = `<div class="up-to-date">&#10003; All files are up to date — nothing to apply.</div>`;
      }
    }

    const sections = [
      modified.length
        ? section(
            'dot-modified',
            `Modified (${modified.length})`,
            modified.map((f) => fileRow(f, true)).join(''),
            false
          )
        : '',
      newFiles.length
        ? section(
            'dot-new',
            `New (${newFiles.length})`,
            newFiles.map((f) => fileRow(f, false, true)).join(''),
            false
          )
        : '',
      protectedFiles.length
        ? section(
            'dot-protected',
            `Protected — user-managed, will not be overwritten (${protectedFiles.length})`,
            protectedFiles.map((f) => fileRow(f, true)).join(''),
            false
          )
        : '',
      unchanged.length
        ? section(
            'dot-unchanged',
            `Unchanged (${unchanged.length})`,
            unchanged.map((f) => fileRow(f, false)).join(''),
            hasApplicableFiles
          )
        : '',
    ].join('');

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
.summary{font-size:12px;color:var(--vscode-descriptionForeground)}
.content{flex:1;overflow-y:auto;padding:12px 20px}
.section{margin-bottom:14px}
.section-header{
  display:flex;align-items:center;gap:6px;
  font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;
  padding:4px 0;margin-bottom:4px;user-select:none;
}
.collapsible{cursor:pointer;opacity:.8}
.collapsible:hover{opacity:1}
.toggle-hint{font-weight:400;text-transform:none;letter-spacing:0;margin-left:4px;color:var(--vscode-descriptionForeground)}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-modified{background:#d4a83a}
.dot-new{background:#4ea44e}
.dot-unchanged{background:#888}
.dot-protected{background:#888;opacity:.5}
.file-list{display:flex;flex-direction:column;gap:1px}
.file-row{
  display:flex;align-items:center;justify-content:space-between;
  padding:3px 8px;border-radius:3px;gap:12px;
  background:var(--vscode-list-hoverBackground);
}
.file-row:hover{background:var(--vscode-list-activeSelectionBackground)}
.file-path{
  font-family:var(--vscode-editor-font-family,monospace);font-size:12px;
  flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.path-dir{color:var(--vscode-descriptionForeground)}
.path-file{color:var(--vscode-foreground)}
.btn-diff{
  font-family:var(--vscode-font-family);font-size:11px;
  padding:2px 8px;
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
  border:none;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0;
}
.btn-diff:hover{background:var(--vscode-button-secondaryHoverBackground)}
.btn-preview{
  display:flex;align-items:center;justify-content:center;
  padding:3px 5px;
  background:transparent;
  color:var(--vscode-descriptionForeground);
  border:none;border-radius:3px;cursor:pointer;flex-shrink:0;
  opacity:0;transition:opacity 0.12s,color 0.12s;
}
.file-row:hover .btn-preview{opacity:1}
.btn-preview:hover{
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
}
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
.up-to-date{
  padding:10px 12px;margin-bottom:14px;border-radius:4px;
  background:var(--vscode-diffEditor-unchangedRegionBackground,rgba(128,128,128,.1));
  color:var(--vscode-descriptionForeground);font-size:12px;
}
</style>
</head>
<body>
<div class="header">
  <h1>IPCraft — Preview Generated Files</h1>
  <div class="summary">${StagingPanel.esc(summaryParts.join(' · '))}</div>
</div>
<div class="content">${noApplyBanner}${sections}</div>
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
function toggleSection(id){
  const list=document.getElementById(id);
  const hint=document.getElementById(id+'-hint');
  if(!list)return;
  const shown=list.style.display!=='none';
  list.style.display=shown?'none':'flex';
  if(hint)hint.textContent=shown?'show':'hide';
}
</script>
</body>
</html>`;
  }
}
