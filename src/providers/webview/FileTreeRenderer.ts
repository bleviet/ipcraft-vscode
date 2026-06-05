/**
 * Shared file-tree webview renderer for the staging and scaffold-pack panels.
 *
 * Both panels render the same collapsible directory tree (chevron + indent
 * guides + a status row per file) over different leaf types, so the tree
 * construction, node rendering, structural CSS, and the SVG/escape helpers live
 * here once. Each panel injects only what differs — the per-row indicator,
 * trailing markup, and muted predicate — via {@link TreeRenderHooks}.
 *
 * Panel-specific styling (status-dot colours, action buttons, badges, footer)
 * is appended by each panel after {@link TREE_CSS}.
 */

/** Minimum shape a leaf must provide: a workspace-relative path (`a/b/c.vhd`). */
export interface TreeLeaf {
  relativePath: string;
}

/** Per-panel rendering callbacks for the variable parts of a file row. */
export interface TreeRenderHooks<T extends TreeLeaf> {
  /** Status dot / lock icon rendered immediately before the file name. */
  indicator(file: T): string;
  /** Optional trailing markup after the file name (action buttons, badges). */
  trailing?(file: T): string;
  /** Whether the row should be rendered muted (dimmed). Defaults to `false`. */
  muted?(file: T): boolean;
}

interface TreeNode<T extends TreeLeaf> {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode<T>[];
  file?: T;
}

/**
 * Escape the four HTML-significant characters so a dynamic string is safe both
 * as text content and inside a double-quoted attribute value (e.g. `data-diff`).
 */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Chevron-down SVG — rotated via CSS when its row is collapsed.
export const CHEVRON_SVG =
  `<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true">` +
  `<path d="M1.5 3.5l3.5 3.5 3.5-3.5"/></svg>`;

// Closed padlock — used for protected / user-managed files.
export const LOCK_SVG =
  `<svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">` +
  `<rect x="0.5" y="4.5" width="7" height="5" rx="1" fill="currentColor"/>` +
  `<path d="M2 4.5V3a2 2 0 0 1 4 0v1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>` +
  `</svg>`;

/**
 * Structural tree CSS shared by every file-tree panel. Panels embed this inside
 * their own `<style>` block and append their panel-specific rules (status-dot
 * colours, buttons, badges, footer, muted opacity) after it.
 */
export const TREE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);background:var(--vscode-editor-background);display:flex;flex-direction:column;height:100vh}
.header{padding:14px 20px 10px;border-bottom:1px solid var(--vscode-panel-border);flex-shrink:0}
.summary{display:flex;align-items:center;flex-wrap:wrap;gap:4px}
.summary-item{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--vscode-descriptionForeground)}
.summary-sep{font-size:11px;color:var(--vscode-descriptionForeground);opacity:.4;padding:0 2px}
.content{flex:1;overflow-y:auto;padding:10px 16px}
.tree-row{display:flex;align-items:center;gap:6px;border-radius:3px;padding-top:3px;padding-bottom:3px;padding-right:8px;min-height:22px}
.tree-dir-header{cursor:pointer;user-select:none}
.tree-dir-header:hover{background:var(--vscode-list-hoverBackground)}
.tree-children{position:relative}
.tree-children::before{content:'';position:absolute;left:var(--guide-x,12px);top:0;bottom:4px;width:1px;background:var(--vscode-tree-indentGuidesStroke,rgba(128,128,128,.18));pointer-events:none}
.tree-children.collapsed{display:none}
.chevron{display:flex;align-items:center;justify-content:center;width:14px;height:14px;flex-shrink:0;color:var(--vscode-descriptionForeground);transition:transform 0.15s}
.chevron svg{stroke:currentColor;stroke-width:1.5;fill:none}
.chevron.collapsed{transform:rotate(-90deg)}
.dir-name{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--vscode-charts-purple,#b180d7)}
.file-name{font-family:var(--vscode-editor-font-family,monospace);font-size:12px;color:var(--vscode-foreground);flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.status-lock{display:inline-flex;align-items:center;flex-shrink:0;color:var(--vscode-foreground)}
`;

// Row layout constants.
const BASE_PADDING = 6;
// step = chevron-box (14px) + flex gap (6px) so file indicators land directly
// under the first letter of the parent directory name.
const STEP = 20;

function buildTree<T extends TreeLeaf>(files: T[]): TreeNode<T> {
  const root: TreeNode<T> = { name: '', fullPath: '', isDir: true, children: [] };

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

  const sort = (n: TreeNode<T>) => {
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

function renderNode<T extends TreeLeaf>(
  node: TreeNode<T>,
  depth: number,
  hooks: TreeRenderHooks<T>
): string {
  // Virtual root: render its children at the same depth, without a row of its own.
  if (node.isDir && !node.name) {
    return node.children.map((c) => renderNode(c, depth, hooks)).join('');
  }

  const px = (n: number) => `${n}px`;
  const padLeft = px(BASE_PADDING + depth * STEP);

  if (node.isDir) {
    const id = `d-${node.fullPath.replace(/[^a-z0-9]/gi, '-')}`;
    const children = node.children.map((c) => renderNode(c, depth + 1, hooks)).join('');
    // --guide-x: horizontal centre of this node's chevron icon.
    const guideX = px(BASE_PADDING + depth * STEP + 7);
    return (
      `<div class="tree-dir">` +
      `<div class="tree-row tree-dir-header" style="padding-left:${padLeft}" data-toggle="${id}">` +
      `<span class="chevron" id="${id}-ch">${CHEVRON_SVG}</span>` +
      `<span class="dir-name">${escHtml(node.name)}/</span>` +
      `</div>` +
      `<div class="tree-children" id="${id}" style="--guide-x:${guideX}">${children}</div>` +
      `</div>`
    );
  }

  const file = node.file!;
  const isMuted = hooks.muted?.(file) ?? false;
  const trailing = hooks.trailing?.(file) ?? '';

  // padding-left matches the dir-header at this depth — indicator aligns with parent dir-name.
  return (
    `<div class="tree-row tree-file-row${isMuted ? ' muted' : ''}" style="padding-left:${padLeft}">` +
    hooks.indicator(file) +
    `<span class="file-name">${escHtml(node.name)}</span>` +
    trailing +
    `</div>`
  );
}

/**
 * Build and render the collapsible file tree for `files`, delegating per-row
 * appearance to `hooks`. Returns the inner HTML for the `.tree` container.
 */
export function renderFileTree<T extends TreeLeaf>(files: T[], hooks: TreeRenderHooks<T>): string {
  return renderNode(buildTree(files), 0, hooks);
}
