import React, { useState, useRef, useCallback, useMemo } from 'react';
import { vscode } from '../../../vscode';

export interface StagedFileView {
  relativePath: string;
  status: 'new' | 'modified' | 'unchanged';
  protected: boolean;
}

interface StagingOverlayProps {
  files: StagedFileView[];
  rootLabel?: string;
  /** Files already opened in the merge editor — shown as "merging", skipped by Apply. */
  mergedPaths: Set<string>;
  /** Modified files that will be written on Apply — defaults to all normal
   *  modified files, none of the protected (managed: false) ones. */
  overwritePaths: Set<string>;
  onMerge: (relativePath: string) => void;
  onToggleOverwrite: (relativePath: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode[];
  file?: StagedFileView;
}

const INSPECTOR_WIDTH_KEY = 'ipcraft.inspectorWidth';
const INSPECTOR_MIN_WIDTH = 240;
const INSPECTOR_MAX_WIDTH = 640;
const STAGING_DEFAULT_WIDTH = 320;

function buildTree(files: StagedFileView[]): TreeNode {
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

type AggStatus = 'new' | 'modified' | 'protected' | 'unchanged';

function aggregateStatus(node: TreeNode): AggStatus | null {
  if (!node.isDir) {
    if (!node.file) {
      return null;
    }
    return node.file.protected ? 'protected' : node.file.status;
  }
  let hasModified = false;
  let hasNew = false;
  let hasProtected = false;
  let hasFiles = false;
  const traverse = (n: TreeNode) => {
    if (!n.isDir && n.file) {
      hasFiles = true;
      if (n.file.status === 'modified') {
        hasModified = true;
      }
      if (n.file.status === 'new') {
        hasNew = true;
      }
      if (n.file.protected) {
        hasProtected = true;
      }
    }
    n.children.forEach(traverse);
  };
  traverse(node);
  if (!hasFiles) {
    return null;
  }
  if (hasModified) {
    return 'modified';
  }
  if (hasNew) {
    return 'new';
  }
  if (hasProtected) {
    return 'protected';
  }
  return 'unchanged';
}

const DirStatusDot: React.FC<{ status: AggStatus | null }> = ({ status }) => {
  if (!status || status === 'unchanged') {
    return null;
  }
  if (status === 'protected') {
    return (
      <span className="staging-status-lock">
        <LockSvg />
      </span>
    );
  }
  return <span className={`staging-dot staging-dot--${status}`} />;
};

const ChevronSvg: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1.5 3.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

const EyeSvg: React.FC = () => (
  <svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
    <path d="M8 0C4.5 0 1.5 2.2 0 6c1.5 3.8 4.5 6 8 6s6.5-2.2 8-6C14.5 2.2 11.5 0 8 0zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
  </svg>
);

const LockSvg: React.FC = () => (
  <svg width="8" height="10" viewBox="0 0 8 10" fill="none" aria-hidden="true">
    <rect x="0.5" y="4.5" width="7" height="5" rx="1" fill="currentColor" />
    <path
      d="M2 4.5V3a2 2 0 0 1 4 0v1.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const TreeNodeView: React.FC<{
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  mergedPaths: Set<string>;
  overwritePaths: Set<string>;
  onToggle: (path: string) => void;
  onViewDiff: (path: string) => void;
  onViewPreview: (path: string) => void;
  onMerge: (path: string) => void;
  onToggleOverwrite: (path: string) => void;
}> = ({
  node,
  depth,
  collapsed,
  mergedPaths,
  overwritePaths,
  onToggle,
  onViewDiff,
  onViewPreview,
  onMerge,
  onToggleOverwrite,
}) => {
  if (node.isDir && !node.name) {
    return (
      <>
        {node.children.map((c) => (
          <TreeNodeView
            key={c.fullPath}
            node={c}
            depth={depth}
            collapsed={collapsed}
            mergedPaths={mergedPaths}
            overwritePaths={overwritePaths}
            onToggle={onToggle}
            onViewDiff={onViewDiff}
            onViewPreview={onViewPreview}
            onMerge={onMerge}
            onToggleOverwrite={onToggleOverwrite}
          />
        ))}
      </>
    );
  }

  const paddingLeft = 6 + depth * 20;
  const guideX = 6 + depth * 20 + 7;

  if (node.isDir) {
    const isCollapsed = collapsed.has(node.fullPath);
    const dirStatus = aggregateStatus(node);
    return (
      <div>
        <div
          className="staging-tree-row staging-tree-dir"
          style={{ paddingLeft }}
          onClick={() => onToggle(node.fullPath)}
        >
          <span className={`staging-chevron${isCollapsed ? ' staging-chevron--collapsed' : ''}`}>
            <ChevronSvg />
          </span>
          <DirStatusDot status={dirStatus} />
          <span className="staging-dir-name">{node.name}/</span>
        </div>
        {!isCollapsed && (
          <div
            className="staging-tree-children"
            style={{ '--guide-x': `${guideX}px` } as React.CSSProperties}
          >
            {node.children.map((c) => (
              <TreeNodeView
                key={c.fullPath}
                node={c}
                depth={depth + 1}
                collapsed={collapsed}
                mergedPaths={mergedPaths}
                overwritePaths={overwritePaths}
                onToggle={onToggle}
                onViewDiff={onViewDiff}
                onViewPreview={onViewPreview}
                onMerge={onMerge}
                onToggleOverwrite={onToggleOverwrite}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const file = node.file!;
  const isMerged = mergedPaths.has(file.relativePath);
  const isOverwrite = overwritePaths.has(file.relativePath);
  // Muted whenever a modified file is currently excluded from Apply — either a
  // locked file the user hasn't opted in, or a normal file they opted out of.
  const isMuted = file.status === 'unchanged' || (file.status === 'modified' && !isOverwrite);
  const showDiff = file.status === 'modified' || file.protected;
  const showPreview = file.status === 'new';
  // Merge is meaningful for any real conflict — protected files qualify too,
  // since the merge editor writes directly to disk independent of the lock.
  const showMerge = file.status === 'modified';
  // Every modified file gets an explicit accept/skip toggle: the user either
  // takes the generated content as-is (Overwrite) or reconciles it (Merge).
  // Defaults to on for normal files (today's implicit Apply-everything
  // behavior) and off for protected files (today's implicit skip).
  const showOverwrite = file.status === 'modified' && !isMerged;

  return (
    <div
      className={`staging-tree-row staging-tree-file${isMuted ? ' staging-tree-file--muted' : ''}`}
      style={{ paddingLeft }}
    >
      {file.protected ? (
        <span
          className={`staging-status-lock${isOverwrite ? ' staging-status-lock--overridden' : ''}`}
        >
          <LockSvg />
        </span>
      ) : (
        <span className={`staging-dot staging-dot--${file.status}`} />
      )}
      <span className="staging-file-name" title={file.relativePath}>
        {node.name}
      </span>
      {showDiff && (
        <button
          className="staging-btn-action staging-btn-diff"
          onClick={() => onViewDiff(file.relativePath)}
        >
          View Diff
        </button>
      )}
      {showMerge &&
        (isMerged ? (
          <span className="staging-merged-tag" title="Reconcile in the merge editor, then save">
            ✓ Merging
          </span>
        ) : (
          <button
            className="staging-btn-action staging-btn-merge"
            onClick={() => onMerge(file.relativePath)}
            title="Reconcile this file in the 3-way merge editor (excluded from Apply)"
          >
            Merge
          </button>
        ))}
      {showOverwrite && (
        <button
          className={`staging-btn-action staging-btn-overwrite${isOverwrite ? ' staging-btn-overwrite--active' : ''}`}
          onClick={() => onToggleOverwrite(file.relativePath)}
          title={
            isOverwrite
              ? 'Included in Apply — click to exclude this file instead'
              : 'Include this file in Apply, overwriting it on disk'
          }
        >
          {isOverwrite ? '✓ Overwrite' : 'Overwrite'}
        </button>
      )}
      {showPreview && (
        <button
          className="staging-btn-action staging-btn-preview"
          onClick={() => onViewPreview(file.relativePath)}
          title="Preview generated file"
        >
          <EyeSvg />
        </button>
      )}
    </div>
  );
};

export const StagingOverlay: React.FC<StagingOverlayProps> = ({
  files,
  rootLabel,
  mergedPaths,
  overwritePaths,
  onMerge,
  onToggleOverwrite,
  onConfirm,
  onCancel,
}) => {
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const stored = sessionStorage.getItem(INSPECTOR_WIDTH_KEY);
      if (stored) {
        const w = parseInt(stored, 10);
        if (w >= INSPECTOR_MIN_WIDTH && w <= INSPECTOR_MAX_WIDTH) {
          return Math.max(w, 300);
        }
      }
    } catch {
      // sessionStorage unavailable in some webview contexts
    }
    return STAGING_DEFAULT_WIDTH;
  });
  const panelWidthRef = useRef(panelWidth);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      const newWidth = Math.max(
        INSPECTOR_MIN_WIDTH,
        Math.min(INSPECTOR_MAX_WIDTH, startWidth + delta)
      );
      panelWidthRef.current = newWidth;
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        sessionStorage.setItem(INSPECTOR_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        // ignore
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const toggleDir = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleViewDiff = useCallback((relativePath: string) => {
    vscode?.postMessage({ type: 'stagingAction', action: 'viewDiff', relativePath });
  }, []);

  const handleViewPreview = useCallback((relativePath: string) => {
    vscode?.postMessage({ type: 'stagingAction', action: 'viewPreview', relativePath });
  }, []);

  const tree = useMemo(() => buildTree(files), [files]);

  const modified = files.filter((f) => f.status === 'modified' && !f.protected);
  const newFiles = files.filter((f) => f.status === 'new');
  const unchanged = files.filter((f) => f.status === 'unchanged');
  const protectedFiles = files.filter((f) => f.protected);
  // Protected files with real changes — each can individually opt into Apply
  // via its Overwrite toggle, so their presence alone makes Apply meaningful.
  const protectedModified = protectedFiles.filter((f) => f.status === 'modified');
  const hasApplicableFiles =
    modified.length > 0 || newFiles.length > 0 || protectedModified.length > 0;
  const allNewOnly = modified.length === 0 && newFiles.length > 0 && protectedModified.length === 0;

  const applyLabel = hasApplicableFiles
    ? allNewOnly
      ? '✓ Create Files'
      : '✓ Confirm & Apply'
    : 'Close';

  const summaryItems: React.ReactNode[] = [];
  if (modified.length) {
    summaryItems.push(
      <span key="mod" className="staging-summary-item">
        <span className="staging-dot staging-dot--modified" />
        {modified.length} modified
      </span>
    );
  }
  if (newFiles.length) {
    summaryItems.push(
      <span key="new" className="staging-summary-item">
        <span className="staging-dot staging-dot--new" />
        {newFiles.length} new
      </span>
    );
  }
  if (unchanged.length) {
    summaryItems.push(
      <span key="unch" className="staging-summary-item">
        <span className="staging-dot staging-dot--unchanged" />
        {unchanged.length} unchanged
      </span>
    );
  }
  if (protectedFiles.length) {
    summaryItems.push(
      <span key="prot" className="staging-summary-item">
        <span className="staging-status-lock">
          <LockSvg />
        </span>
        {protectedFiles.length} protected
      </span>
    );
  }

  const summaryWithSeps = summaryItems.reduce<React.ReactNode[]>((acc, item, i) => {
    if (i > 0) {
      acc.push(
        <span key={`sep-${i}`} className="staging-summary-sep">
          ·
        </span>
      );
    }
    acc.push(item);
    return acc;
  }, []);

  let banner: React.ReactNode = null;
  if (protectedModified.length > 0 && modified.length === 0 && newFiles.length === 0) {
    banner = (
      <div className="staging-banner">
        {protectedModified.length} file(s) are user-managed (managed: false) and locked — use
        Overwrite on a file to include it in Apply anyway.
      </div>
    );
  } else if (!hasApplicableFiles) {
    const bannerText =
      protectedFiles.length > 0
        ? '✓ All files are either unchanged or user-managed — nothing to apply.'
        : '✓ All files are up to date — nothing to apply.';
    banner = <div className="staging-banner">{bannerText}</div>;
  }

  return (
    <div className="canvas-inspector" style={{ width: panelWidth }}>
      <div className="ci-resize-handle" onMouseDown={handleResizeMouseDown} />

      {/* Header */}
      <div className="ci-header" style={{ flexDirection: 'column', gap: 6, alignItems: 'stretch' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="staging-header-title">Preview Generated Files</span>
          <button className="ci-header__close" onClick={onCancel} title="Cancel (Esc)">
            <span className="codicon codicon-close" />
          </button>
        </div>
        {summaryWithSeps.length > 0 && <div className="staging-summary">{summaryWithSeps}</div>}
      </div>

      {/* Body */}
      <div className="ci-body" style={{ padding: '8px 0' }}>
        {banner && <div style={{ padding: '0 10px 8px' }}>{banner}</div>}
        {rootLabel ? (
          <>
            {/* Root folder row — always expanded, non-collapsible */}
            <div
              className="staging-tree-row staging-tree-dir"
              style={{ paddingLeft: 6, cursor: 'default' }}
            >
              <span className="staging-chevron">
                <ChevronSvg />
              </span>
              <span className="staging-dir-name">{rootLabel}/</span>
              <span className="staging-cwd-badge">current folder</span>
            </div>
            {/* Children indented under root with a guide line */}
            <div
              className="staging-tree-children"
              style={{ '--guide-x': '13px' } as React.CSSProperties}
            >
              <TreeNodeView
                node={tree}
                depth={1}
                collapsed={collapsed}
                mergedPaths={mergedPaths}
                overwritePaths={overwritePaths}
                onToggle={toggleDir}
                onViewDiff={handleViewDiff}
                onViewPreview={handleViewPreview}
                onMerge={onMerge}
                onToggleOverwrite={onToggleOverwrite}
              />
            </div>
          </>
        ) : (
          <TreeNodeView
            node={tree}
            depth={0}
            collapsed={collapsed}
            mergedPaths={mergedPaths}
            overwritePaths={overwritePaths}
            onToggle={toggleDir}
            onViewDiff={handleViewDiff}
            onViewPreview={handleViewPreview}
            onMerge={onMerge}
            onToggleOverwrite={onToggleOverwrite}
          />
        )}
      </div>

      {/* Footer */}
      <div className="ci-footer" style={{ gap: 6, justifyContent: 'flex-start' }}>
        <button
          className="canvas-view-toggle canvas-view-toggle--active"
          style={{ fontSize: 12 }}
          onClick={hasApplicableFiles ? onConfirm : onCancel}
        >
          {applyLabel}
        </button>
        {hasApplicableFiles && (
          <button className="canvas-view-toggle" style={{ fontSize: 12 }} onClick={onCancel}>
            ✕ Cancel
          </button>
        )}
      </div>
    </div>
  );
};
