import React from 'react';
import type { InterfaceDrift, StagingAction } from '../../../../shared/staging';

export interface StagedFileView {
  relativePath: string;
  status: 'new' | 'modified' | 'unchanged';
  protected: boolean;
  /**
   * Set when this file came from IPCraft's default framework testbench generation (tb/*,
   * .vscode/settings.json) rather than the active scaffold pack's own file rules (issue #156).
   */
  origin?: 'framework-testbench';
  handEdited?: boolean;
  interfaceDrift?: InterfaceDrift;
  actions: StagingAction[];
  defaultAction?: StagingAction;
}

export interface TreeNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  children: TreeNode[];
  file?: StagedFileView;
}

export function buildTree(files: StagedFileView[]): TreeNode {
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

export function aggregateStatus(node: TreeNode): AggStatus | null {
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

export const DirStatusDot: React.FC<{ status: AggStatus | null }> = ({ status }) => {
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

export const ChevronSvg: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M1.5 3.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
  </svg>
);

export const EyeSvg: React.FC = () => (
  <svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
    <path d="M8 0C4.5 0 1.5 2.2 0 6c1.5 3.8 4.5 6 8 6s6.5-2.2 8-6C14.5 2.2 11.5 0 8 0zm0 10a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-1.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" />
  </svg>
);

export const LockSvg: React.FC = () => (
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
