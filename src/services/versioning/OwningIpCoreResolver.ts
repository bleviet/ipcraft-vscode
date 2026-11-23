import * as path from 'path';
import * as yaml from 'js-yaml';
import { resolveMemoryMapImportPath } from '../imports/resolveMemoryMapImports';
import type { VersionContext } from '../../shared/versioning/versionContext';
import { parseVersionScheme } from '../../shared/versioning/versionScheme';

export type { VersionContext } from '../../shared/versioning/versionContext';

export interface IpCoreCandidate {
  fsPath: string;
  /** Workspace-relative path, reported to the webview. */
  relPath: string;
  text: string;
}

type Raw = Record<string, unknown>;

function parseObject(text: string): Raw | null {
  try {
    const data = yaml.load(text);
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Raw) : null;
  } catch {
    return null;
  }
}

/**
 * The `import` strings of an IP core's `memoryMaps`: the `{ import }` shortcut object, or the
 * `import` of an array entry (inline map entries without one are not imports).
 */
function memoryMapImports(memoryMaps: unknown): string[] {
  const entries = Array.isArray(memoryMaps) ? memoryMaps : [memoryMaps];
  return entries.flatMap((entry) => {
    const field = entry !== null && typeof entry === 'object' ? (entry as Raw).import : undefined;
    return typeof field === 'string' ? [field] : [];
  });
}

/** Decides which IP core owns `mmFsPath` from already-read `.ip.yml` candidates. */
export function resolveVersionContext(
  mmFsPath: string,
  ipCores: IpCoreCandidate[]
): VersionContext {
  const target = path.resolve(mmFsPath);
  const owners: Array<{ core: IpCoreCandidate; data: Raw }> = [];
  for (const core of ipCores) {
    const data = parseObject(core.text);
    if (!data) {
      continue;
    }
    const baseDir = path.dirname(core.fsPath);
    if (
      memoryMapImports(data.memoryMaps).some(
        (field) => resolveMemoryMapImportPath(baseDir, field) === target
      )
    ) {
      owners.push({ core, data });
    }
  }

  if (owners.length === 0) {
    return { status: 'none' };
  }
  if (owners.length > 1) {
    return {
      status: 'ambiguous',
      candidates: owners.map(({ core }) => core.relPath).sort(),
    };
  }
  const [{ core, data }] = owners;
  const vlnv = (data.vlnv ?? {}) as Raw;
  return {
    status: 'resolved',
    versionScheme: parseVersionScheme(vlnv.versionScheme),
    version: String(vlnv.version ?? ''),
    ipCorePath: core.relPath,
  };
}
