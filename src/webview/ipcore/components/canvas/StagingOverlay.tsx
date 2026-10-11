import React, { useState, useRef, useCallback, useMemo } from 'react';
import { vscode } from '../../../vscode';
import { allKeptBanner, type StagingAction } from '../../../../shared/staging';
import { StagingFileActions, StagingFileBadges } from './StagingFileActions';
import {
  buildTree,
  aggregateStatus,
  ChevronSvg,
  DirStatusDot,
  EyeSvg,
  LockSvg,
  type StagedFileView,
  type TreeNode,
} from './stagingTree';

export type { StagedFileView };

interface StagingOverlayProps {
  files: StagedFileView[];
  rootLabel?: string;
  /** Non-fatal generation warnings to surface before the user applies (issue #156). */
  warnings?: string[];
  /** Files already opened in the merge editor — shown as "merging", skipped by Apply. */
  mergedPaths: Set<string>;
  /** Chosen action per modified file — seeded from each file's default action. */
  stagingActions: Record<string, StagingAction>;
  onMerge: (relativePath: string) => void;
  onSelectAction: (relativePath: string, action: StagingAction) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

const INSPECTOR_WIDTH_KEY = 'ipcraft.inspectorWidth';
const INSPECTOR_MIN_WIDTH = 240;
const INSPECTOR_MAX_WIDTH = 640;
const STAGING_DEFAULT_WIDTH = 320;

const TreeNodeView: React.FC<{
  node: TreeNode;
  depth: number;
  collapsed: Set<string>;
  mergedPaths: Set<string>;
  stagingActions: Record<string, StagingAction>;
  onToggle: (path: string) => void;
  onViewDiff: (path: string) => void;
  onViewPreview: (path: string) => void;
  onMerge: (path: string) => void;
  onSelectAction: (path: string, action: StagingAction) => void;
}> = ({
  node,
  depth,
  collapsed,
  mergedPaths,
  stagingActions,
  onToggle,
  onViewDiff,
  onViewPreview,
  onMerge,
  onSelectAction,
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
            stagingActions={stagingActions}
            onToggle={onToggle}
            onViewDiff={onViewDiff}
            onViewPreview={onViewPreview}
            onMerge={onMerge}
            onSelectAction={onSelectAction}
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
                stagingActions={stagingActions}
                onToggle={onToggle}
                onViewDiff={onViewDiff}
                onViewPreview={onViewPreview}
                onMerge={onMerge}
                onSelectAction={onSelectAction}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const file = node.file!;
  const isMerged = mergedPaths.has(file.relativePath);
  const chosen = stagingActions[file.relativePath] ?? 'keep';
  // Muted whenever a modified file's chosen action is Keep (it stays as-is on disk).
  const isMuted = file.status === 'unchanged' || (file.status === 'modified' && chosen === 'keep');
  const showDiff = file.status === 'modified' || file.protected;
  const showPreview = file.status === 'new';
  // Merge is meaningful for any real conflict — protected files qualify too,
  // since the merge editor writes directly to disk independent of the lock.
  const showMerge = file.status === 'modified';
  // Every modified file gets an explicit action choice, seeded from its
  // default action (Keep for locked files) and offered from `file.actions`.
  const showActions = file.status === 'modified' && !isMerged;

  return (
    <div
      className={`staging-tree-row staging-tree-file${isMuted ? ' staging-tree-file--muted' : ''}`}
      style={{ paddingLeft }}
    >
      {file.protected ? (
        <span
          className={`staging-status-lock${chosen !== 'keep' ? ' staging-status-lock--overridden' : ''}`}
        >
          <LockSvg />
        </span>
      ) : (
        <span className={`staging-dot staging-dot--${file.status}`} />
      )}
      <span className="staging-file-name" title={file.relativePath}>
        {node.name}
      </span>
      {file.origin === 'framework-testbench' && (
        <span
          className="staging-badge-framework"
          title="Generated by IPCraft's default framework testbench (tb/*, .vscode/settings.json) — not part of the active scaffold pack's own output"
        >
          framework
        </span>
      )}
      <StagingFileBadges handEdited={file.handEdited} interfaceDrift={file.interfaceDrift} />
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
      {showActions && (
        <StagingFileActions
          actions={file.actions}
          chosen={chosen}
          onSelect={(action) => onSelectAction(file.relativePath, action)}
        />
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
  warnings,
  mergedPaths,
  stagingActions,
  onMerge,
  onSelectAction,
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
  // via its action choice, so their presence alone makes Apply meaningful.
  const protectedModified = protectedFiles.filter((f) => f.status === 'modified');
  const hasApplicableFiles =
    modified.length > 0 || newFiles.length > 0 || protectedModified.length > 0;
  const allNewOnly = modified.length === 0 && newFiles.length > 0 && protectedModified.length === 0;

  // Modified files (locked or not) the user has set to Keep — they stay as-is on disk.
  const keptModified = files.filter(
    (f) =>
      f.status === 'modified' &&
      !mergedPaths.has(f.relativePath) &&
      (stagingActions[f.relativePath] ?? 'keep') === 'keep'
  );

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
  if (keptModified.length) {
    summaryItems.push(
      <span key="kept" className="staging-summary-item">
        <span className="staging-dot staging-dot--unchanged" />
        {keptModified.length} kept
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
  const keptText = allKeptBanner(files, (f) =>
    mergedPaths.has(f.relativePath) ? undefined : (stagingActions[f.relativePath] ?? 'keep')
  );
  if (keptText) {
    banner = <div className="staging-banner">{keptText}</div>;
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
        {warnings?.map((w, i) => (
          <div key={i} style={{ padding: '0 10px 8px' }}>
            <div className="staging-banner staging-banner--warning">{w}</div>
          </div>
        ))}
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
                stagingActions={stagingActions}
                onToggle={toggleDir}
                onViewDiff={handleViewDiff}
                onViewPreview={handleViewPreview}
                onMerge={onMerge}
                onSelectAction={onSelectAction}
              />
            </div>
          </>
        ) : (
          <TreeNodeView
            node={tree}
            depth={0}
            collapsed={collapsed}
            mergedPaths={mergedPaths}
            stagingActions={stagingActions}
            onToggle={toggleDir}
            onViewDiff={handleViewDiff}
            onViewPreview={handleViewPreview}
            onMerge={onMerge}
            onSelectAction={onSelectAction}
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
