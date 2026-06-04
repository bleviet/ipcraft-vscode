import * as path from 'path';
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

      // Populate the virtual document store so diffs can be opened immediately.
      // Keys use plain relative paths because vscode.Uri.from encodes internally and
      // uri.path is already decoded when the provider is called.
      clearStagingContent();
      for (const f of files) {
        setStagingContent(`/${f.relativePath}`, f.content);
      }

      panel.webview.html = StagingPanel.buildHtml(files);

      const disposables: vscode.Disposable[] = [];

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
            const filename = path.basename(file.relativePath);
            await vscode.commands.executeCommand(
              'vscode.diff',
              diskUri,
              generatedUri,
              `${filename}: Current ↔ Generated`,
              { preview: true }
            );
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

  private static buildHtml(files: StagedFile[]): string {
    const modified = files.filter((f) => f.status === 'modified' && !f.protected);
    const newFiles = files.filter((f) => f.status === 'new');
    const unchanged = files.filter((f) => f.status === 'unchanged');
    const protectedFiles = files.filter((f) => f.protected);

    // True when at least one file will actually be written on Apply.
    const hasApplicableFiles = modified.length > 0 || newFiles.length > 0;

    const fileRow = (f: StagedFile, showDiff: boolean) => `
      <div class="file-row">
        <span class="file-path">${StagingPanel.esc(f.relativePath)}</span>
        ${showDiff ? `<button class="btn-diff" onclick="viewDiff(${StagingPanel.esc(JSON.stringify(f.relativePath))})">View Diff</button>` : ''}
      </div>`;

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

    // Informational banner shown when nothing will be written.
    let noApplyBanner = '';
    if (!hasApplicableFiles) {
      if (protectedFiles.length > 0 && unchanged.length === 0) {
        noApplyBanner = `<div class="up-to-date">All modified files are user-managed (managed: false) and will not be overwritten.</div>`;
      } else if (protectedFiles.length > 0) {
        noApplyBanner = `<div class="up-to-date">✓ All files are either unchanged or user-managed — nothing to apply.</div>`;
      } else {
        noApplyBanner = `<div class="up-to-date">✓ All files are up to date — nothing to apply.</div>`;
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
            newFiles.map((f) => fileRow(f, false)).join(''),
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
            hasApplicableFiles // collapsed when actionable files are present; expanded when not
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
.btn-diff{
  font-family:var(--vscode-font-family);font-size:11px;
  padding:2px 8px;
  background:var(--vscode-button-secondaryBackground);
  color:var(--vscode-button-secondaryForeground);
  border:none;border-radius:3px;cursor:pointer;white-space:nowrap;flex-shrink:0;
}
.btn-diff:hover{background:var(--vscode-button-secondaryHoverBackground)}
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
    ${hasApplicableFiles ? '✓ Confirm &amp; Apply' : 'Close'}
  </button>
  ${hasApplicableFiles ? '<button class="btn-cancel" onclick="cancel()">✕ Cancel</button>' : ''}
</div>
<script>
const vscode = acquireVsCodeApi();
function viewDiff(p){vscode.postMessage({type:'viewDiff',relativePath:p});}
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
