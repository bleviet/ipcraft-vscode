/**
 * Node `fs` directory walk shared by the VS Code command and the CLI. Classifies the files the
 * vhdl_ls.toml generator reads and applies one exclusion rule set, which `isExcluded` exposes
 * for paths that manifests point at. No `vscode` import.
 */

import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { isIgnoredWorkspacePath } from '../systemDiagram/enrichment/workspaceFilter';

export interface WorkspaceFiles {
  vhdl: string[];
  xpr: string[];
  qsf: string[];
  qip: string[];
  componentXml: string[];
  hwTcl: string[];
  ipYml: string[];
  /** True for paths the walk skips: ignored directories, `.ipcraft`, generated Platform Designer output. */
  isExcluded: (absPath: string) => boolean;
}

type FileKind = Exclude<keyof WorkspaceFiles, 'isExcluded'>;

function classify(name: string): FileKind | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith('.vhd') || lower.endsWith('.vhdl')) {
    return 'vhdl';
  }
  if (lower.endsWith('.xpr')) {
    return 'xpr';
  }
  if (lower.endsWith('.qsf')) {
    return 'qsf';
  }
  if (lower.endsWith('.qip')) {
    return 'qip';
  }
  if (lower === 'component.xml') {
    return 'componentXml';
  }
  if (lower.endsWith('_hw.tcl')) {
    return 'hwTcl';
  }
  if (lower.endsWith('.ip.yml') || lower.endsWith('.ip.yaml')) {
    return 'ipYml';
  }
  return undefined;
}

function makeIsExcluded(root: string): (absPath: string) => boolean {
  const qsysCache = new Map<string, boolean>();
  const hasQsys = (qsysPath: string): boolean => {
    let found = qsysCache.get(qsysPath);
    if (found === undefined) {
      found = fs.existsSync(qsysPath);
      qsysCache.set(qsysPath, found);
    }
    return found;
  };
  return (absPath) => {
    const segments = path.relative(root, absPath).split(path.sep);
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      if (isIgnoredWorkspacePath(segment) || segment === '.ipcraft') {
        return true;
      }
      if (i > 0 && (segment === 'synthesis' || segment === 'simulation')) {
        const name = segments[i - 1];
        const parent = path.join(root, ...segments.slice(0, i - 1));
        if (hasQsys(path.join(parent, `${name}.qsys`))) {
          return true;
        }
      }
    }
    return false;
  };
}

export async function walkWorkspace(root: string): Promise<WorkspaceFiles> {
  const absRoot = path.resolve(root);
  const isExcluded = makeIsExcluded(absRoot);
  const found: WorkspaceFiles = {
    vhdl: [],
    xpr: [],
    qsf: [],
    qip: [],
    componentXml: [],
    hwTcl: [],
    ipYml: [],
    isExcluded,
  };

  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isExcluded(full)) {
          await visit(full);
        }
      } else if (entry.isFile()) {
        const kind = classify(entry.name);
        if (kind) {
          found[kind].push(full);
        }
      }
    }
  };

  await visit(absRoot);
  for (const kind of ['vhdl', 'xpr', 'qsf', 'qip', 'componentXml', 'hwTcl', 'ipYml'] as const) {
    found[kind].sort();
  }
  return found;
}
