import * as vscode from 'vscode';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { Logger } from '../utils/Logger';
import { ScaffoldPackLoader } from '../generator/ScaffoldPackLoader';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';
import {
  renderFileTree,
  escHtml,
  TREE_CSS,
  LOCK_SVG,
  type TreeRenderHooks,
} from './webview/FileTreeRenderer';

interface PreviewFile {
  relativePath: string;
  conditionPassed: boolean;
  managed: boolean;
}

/**
 * Persistent (non-modal) webview panel that shows which files a scaffold pack
 * would generate, updating live whenever scaffold.yml or its templates are saved.
 *
 * One panel per workspace — subsequent calls to show() reuse and focus the existing panel.
 */
export class ScaffoldPackPanel {
  private static _instance: ScaffoldPackPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly logger: Logger;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(logger: Logger, context: vscode.ExtensionContext) {
    this.logger = logger;
    this.context = context;

    this.panel = vscode.window.createWebviewPanel(
      'ipcraft-scaffold-preview',
      'IPCraft — Scaffold Pack Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        // Scope resource loading to the bundle + codicons instead of defaulting
        // to every workspace folder.
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
          vscode.Uri.joinPath(context.extensionUri, 'node_modules', '@vscode', 'codicons'),
        ],
      }
    );

    this.panel.onDidDispose(
      () => {
        this.disposables.forEach((d) => {
          d.dispose();
        });
        ScaffoldPackPanel._instance = undefined;
      },
      undefined,
      this.disposables
    );
  }

  static show(logger: Logger, context: vscode.ExtensionContext): ScaffoldPackPanel {
    if (!ScaffoldPackPanel._instance) {
      ScaffoldPackPanel._instance = new ScaffoldPackPanel(logger, context);
    } else {
      ScaffoldPackPanel._instance.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    return ScaffoldPackPanel._instance;
  }

  static get instance(): ScaffoldPackPanel | undefined {
    return ScaffoldPackPanel._instance;
  }

  /**
   * Refresh the panel for the given scaffold.yml path.
   * Scans workspace for .ip.yml files to use as preview context.
   */
  async refresh(scaffoldYmlPath: string): Promise<void> {
    const packDir = path.dirname(scaffoldYmlPath);
    const ipCorePath = await findPreviewIpCore(scaffoldYmlPath);

    let files: PreviewFile[] = [];
    let errorMsg: string | undefined;
    let packName = path.basename(packDir);

    try {
      const pack = ScaffoldPackLoader.load(packDir);
      packName = pack.name;

      if (ipCorePath) {
        const scaffolder = new IpCoreScaffolder(
          this.logger,
          new TemplateLoader(this.logger),
          this.context
        );
        const ctx = await scaffolder.buildTemplateContextPublic(ipCorePath);

        const packLoader = new TemplateLoader(this.logger, [
          pack.packDir,
          TemplateLoader.resolveTemplatesPath(),
        ]);

        files = pack.files.map((rule) => {
          const conditionPassed = packLoader.evaluateCondition(rule.condition, ctx);
          let relativePath = rule.target;
          try {
            relativePath = packLoader.renderString(rule.target, ctx);
          } catch {
            // leave as template string if render fails
          }
          return {
            relativePath,
            conditionPassed,
            managed: rule.managed !== false,
          };
        });
      } else {
        // No IP core found — show rules without evaluating conditions
        files = pack.files.map((rule) => ({
          relativePath: rule.target,
          conditionPassed: true,
          managed: rule.managed !== false,
        }));
        errorMsg = 'No .ip.yml found in workspace — showing unevaluated rules.';
      }
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : String(err);
      this.logger.error('Scaffold pack preview failed', err as Error);
    }

    const ipCoreLabel = ipCorePath ? path.basename(ipCorePath) : undefined;
    this.panel.webview.html = ScaffoldPackPanel.buildHtml(
      packName,
      packDir,
      files,
      ipCoreLabel,
      errorMsg
    );
  }

  // ---------------------------------------------------------------------------
  // Per-row rendering hooks injected into the shared FileTreeRenderer.
  // ---------------------------------------------------------------------------

  private static readonly treeHooks: TreeRenderHooks<PreviewFile> = {
    muted: (f) => !f.conditionPassed,
    indicator: (f) =>
      !f.managed
        ? `<span class="status-lock">${LOCK_SVG}</span>`
        : f.conditionPassed
          ? `<span class="dot dot-included"></span>`
          : `<span class="dot dot-skipped"></span>`,
    trailing: (f) =>
      (!f.conditionPassed ? `<span class="badge-skip">condition false</span>` : '') +
      (!f.managed ? `<span class="badge-lock">user-owned</span>` : ''),
  };

  private static buildHtml(
    packName: string,
    packDir: string,
    files: PreviewFile[],
    ipCoreLabel: string | undefined,
    errorMsg: string | undefined
  ): string {
    const included = files.filter((f) => f.conditionPassed);
    const skipped = files.filter((f) => !f.conditionPassed);
    const userOwned = files.filter((f) => !f.managed && f.conditionPassed);

    const dot = (cls: string) => `<span class="dot ${cls}"></span>`;
    const si = (ind: string, label: string) => `<span class="summary-item">${ind}${label}</span>`;
    const sep = `<span class="summary-sep">·</span>`;
    const parts: string[] = [];
    if (included.length) {
      parts.push(si(dot('dot-included'), `${included.length} generated`));
    }
    if (skipped.length) {
      parts.push(si(dot('dot-skipped'), `${skipped.length} skipped`));
    }
    if (userOwned.length) {
      parts.push(
        si(`<span class="status-lock">${LOCK_SVG}</span>`, `${userOwned.length} user-owned`)
      );
    }
    const summaryHtml = parts.join(sep);

    const contextLine = ipCoreLabel
      ? `<div class="context-label">Preview context: <code>${escHtml(ipCoreLabel)}</code></div>`
      : '';

    const errorHtml = errorMsg ? `<div class="banner banner-warn">${escHtml(errorMsg)}</div>` : '';

    const treeHtml = renderFileTree(files, ScaffoldPackPanel.treeHooks);

    // Per-render nonce so the inline <script> runs while the CSP stays fail-closed.
    const nonce = randomBytes(16).toString('base64');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>IPCraft — Scaffold Pack Preview</title>
<style>
${TREE_CSS}
.header h1{font-size:14px;font-weight:600;margin-bottom:2px}
.pack-dir{font-size:11px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family,monospace);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.context-label{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px}
.context-label code{font-family:var(--vscode-editor-font-family,monospace)}
.summary{margin-top:6px}
.tree-file-row.muted{opacity:0.45}
.dot-included{background:#4ea44e}
.dot-skipped{background:#888}
.badge-skip,.badge-lock{font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0}
.badge-skip{background:rgba(128,128,128,.18);color:var(--vscode-descriptionForeground)}
.badge-lock{background:rgba(200,150,0,.15);color:var(--vscode-descriptionForeground)}
.banner{padding:8px 12px;margin-bottom:10px;border-radius:4px;font-size:12px;background:var(--vscode-diffEditor-unchangedRegionBackground,rgba(128,128,128,.1));color:var(--vscode-descriptionForeground)}
.banner-warn{background:rgba(200,100,0,.12);color:var(--vscode-editorWarning-foreground,#cca700)}
</style>
</head>
<body>
<div class="header">
  <h1>Scaffold Pack: ${escHtml(packName)}</h1>
  <div class="pack-dir">${escHtml(packDir)}</div>
  ${contextLine}
  <div class="summary">${summaryHtml}</div>
</div>
<div class="content">
  ${errorHtml}
  <div class="tree">${treeHtml}</div>
</div>
<script nonce="${nonce}">
function toggleDir(id){
  const el=document.getElementById(id);
  const ch=document.getElementById(id+'-ch');
  if(!el)return;
  const closing=!el.classList.contains('collapsed');
  el.classList.toggle('collapsed',closing);
  if(ch)ch.classList.toggle('collapsed',closing);
}
// Single delegated, nonce-gated click handler — no inline JS in the markup.
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-toggle]');
  if (t) toggleDir(t.dataset.toggle);
});
</script>
</body>
</html>`;
  }
}

/** Find the best .ip.yml to use as preview context for a scaffold.yml file. */
async function findPreviewIpCore(scaffoldYmlPath: string): Promise<string | undefined> {
  const ipFiles = await vscode.workspace.findFiles('**/*.ip.yml', '**/node_modules/**', 5);
  if (ipFiles.length === 0) {
    return undefined;
  }

  // Prefer files closest to the scaffold.yml location
  const packDir = path.dirname(scaffoldYmlPath);
  const sorted = ipFiles.slice().sort((a, b) => {
    const distA = path.relative(packDir, a.fsPath).split(path.sep).length;
    const distB = path.relative(packDir, b.fsPath).split(path.sep).length;
    return distA - distB;
  });

  return sorted[0].fsPath;
}
