import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { ScaffoldPackLoader } from '../generator/ScaffoldPackLoader';
import { TemplateLoader } from '../generator/TemplateLoader';
import { IpCoreScaffolder } from '../generator/IpCoreScaffolder';

interface PreviewFile {
  relativePath: string;
  conditionPassed: boolean;
  managed: boolean;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode[];
  file?: PreviewFile;
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
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.onDidDispose(
      () => {
        this.disposables.forEach((d) => d.dispose());
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
  // Tree rendering (same visual language as StagingPanel)
  // ---------------------------------------------------------------------------

  private static readonly lockSvg =
    `<svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">` +
    `<rect x="0.5" y="4.5" width="7" height="5" rx="1" fill="currentColor"/>` +
    `<path d="M2 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
    `</svg>`;

  private static readonly chevronSvg =
    `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">` +
    `<path d="M1.5 3.5l3.5 3.5 3.5-3.5"/></svg>`;

  private static esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private static buildTree(files: PreviewFile[]): TreeNode {
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
      n.children.sort((a, b) =>
        a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name)
      );
      n.children.forEach(sort);
    };
    sort(root);
    return root;
  }

  private static renderNode(node: TreeNode, depth: number): string {
    if (node.isDir && !node.name) {
      return node.children.map((c) => ScaffoldPackPanel.renderNode(c, depth)).join('');
    }
    const px = (n: number) => `${n}px`;
    const base = 6;
    const step = 20;
    if (node.isDir) {
      const id = `d-${node.fullPath.replace(/[^a-z0-9]/gi, '-')}`;
      const children = node.children
        .map((c) => ScaffoldPackPanel.renderNode(c, depth + 1))
        .join('');
      const guideX = px(base + depth * step + 7);
      return (
        `<div class="tree-dir">` +
        `<div class="tree-row tree-dir-header" style="padding-left:${px(base + depth * step)}" onclick="toggleDir('${id}')">` +
        `<span class="chevron" id="${id}-ch">${ScaffoldPackPanel.chevronSvg}</span>` +
        `<span class="dir-name">${ScaffoldPackPanel.esc(node.name)}/</span>` +
        `</div>` +
        `<div class="tree-children" id="${id}" style="--guide-x:${guideX}">${children}</div>` +
        `</div>`
      );
    }
    const file = node.file!;
    const isMuted = !file.conditionPassed;
    const indicator = !file.managed
      ? `<span class="status-lock">${ScaffoldPackPanel.lockSvg}</span>`
      : file.conditionPassed
        ? `<span class="dot dot-included"></span>`
        : `<span class="dot dot-skipped"></span>`;
    const badge = !file.conditionPassed ? `<span class="badge-skip">condition false</span>` : '';
    const lockBadge = !file.managed ? `<span class="badge-lock">user-owned</span>` : '';
    return (
      `<div class="tree-row tree-file-row${isMuted ? ' muted' : ''}" style="padding-left:${px(base + depth * step)}">` +
      indicator +
      `<span class="file-name">${ScaffoldPackPanel.esc(node.name)}</span>` +
      badge +
      lockBadge +
      `</div>`
    );
  }

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
        si(
          `<span class="status-lock">${ScaffoldPackPanel.lockSvg}</span>`,
          `${userOwned.length} user-owned`
        )
      );
    }
    const summaryHtml = parts.join(sep);

    const contextLine = ipCoreLabel
      ? `<div class="context-label">Preview context: <code>${ScaffoldPackPanel.esc(ipCoreLabel)}</code></div>`
      : '';

    const errorHtml = errorMsg
      ? `<div class="banner banner-warn">${ScaffoldPackPanel.esc(errorMsg)}</div>`
      : '';

    const tree = ScaffoldPackPanel.buildTree(files);
    const treeHtml = ScaffoldPackPanel.renderNode(tree, 0);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<title>IPCraft — Scaffold Pack Preview</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);display:flex;flex-direction:column;height:100vh}
.header{padding:14px 20px 10px;border-bottom:1px solid var(--vscode-panel-border);flex-shrink:0}
.header h1{font-size:14px;font-weight:600;margin-bottom:2px}
.pack-dir{font-size:11px;color:var(--vscode-descriptionForeground);font-family:var(--vscode-editor-font-family,monospace);margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.context-label{font-size:11px;color:var(--vscode-descriptionForeground);margin-top:4px}
.context-label code{font-family:var(--vscode-editor-font-family,monospace)}
.summary{display:flex;align-items:center;flex-wrap:wrap;gap:4px;margin-top:6px}
.summary-item{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--vscode-descriptionForeground)}
.summary-sep{font-size:11px;color:var(--vscode-descriptionForeground);opacity:.4;padding:0 2px}
.content{flex:1;overflow-y:auto;padding:10px 16px}
.tree-row{display:flex;align-items:center;gap:6px;border-radius:3px;padding-top:3px;padding-bottom:3px;padding-right:8px;min-height:22px}
.tree-dir-header{cursor:pointer;user-select:none}
.tree-dir-header:hover{background:var(--vscode-list-hoverBackground)}
.tree-file-row.muted{opacity:0.45}
.tree-children{position:relative}
.tree-children::before{content:'';position:absolute;left:var(--guide-x,12px);top:0;bottom:4px;width:1px;background:var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.18));pointer-events:none}
.tree-children.collapsed{display:none}
.chevron{display:flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;color:var(--vscode-descriptionForeground);transition:transform 0.15s}
.chevron svg{stroke:currentColor;stroke-width:1.5;fill:none}
.chevron.collapsed{transform:rotate(-90deg)}
.dir-name{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--vscode-descriptionForeground)}
.file-name{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--vscode-foreground);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-included{background:#4ea44e}
.dot-skipped{background:#888}
.status-lock{display:inline-flex;align-items:center;flex-shrink:0;color:var(--vscode-foreground)}
.badge-skip,.badge-lock{font-size:10px;padding:1px 5px;border-radius:3px;flex-shrink:0}
.badge-skip{background:rgba(128,128,128,.18);color:var(--vscode-descriptionForeground)}
.badge-lock{background:rgba(200,150,0,.15);color:var(--vscode-descriptionForeground)}
.banner{padding:8px 12px;margin-bottom:10px;border-radius:4px;font-size:12px;background:var(--vscode-diffEditor-unchangedRegionBackground,rgba(128,128,128,.1));color:var(--vscode-descriptionForeground)}
.banner-warn{background:rgba(200,100,0,.12);color:var(--vscode-editorWarning-foreground,#cca700)}
</style>
</head>
<body>
<div class="header">
  <h1>Scaffold Pack: ${ScaffoldPackPanel.esc(packName)}</h1>
  <div class="pack-dir">${ScaffoldPackPanel.esc(packDir)}</div>
  ${contextLine}
  <div class="summary">${summaryHtml}</div>
</div>
<div class="content">
  ${errorHtml}
  <div class="tree">${treeHtml}</div>
</div>
<script>
function toggleDir(id){
  const el=document.getElementById(id);
  const ch=document.getElementById(id+'-ch');
  if(!el)return;
  const closing=!el.classList.contains('collapsed');
  el.classList.toggle('collapsed',closing);
  if(ch)ch.classList.toggle('collapsed',closing);
}
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
