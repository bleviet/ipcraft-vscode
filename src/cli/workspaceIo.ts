/**
 * File access of `ipcraft render` for the system diagram enrichment: the same
 * discovery as the viewer (globs, limits, size cap, ignored folders) over a
 * directory walk with Node `fs`. Paths are visited in sorted order, so the
 * entries, and therefore every tie-break, are deterministic.
 */

import { readdir, readFile, realpath, stat } from 'fs/promises';
import * as path from 'path';
import { pathToFileURL } from 'url';
import type { EnrichmentIo } from '../services/systemDiagram/enrichment/enrichmentIo';
import {
  HDL_MAX_BYTES,
  hdlEntryFromText,
  ipEntryFromText,
  qsysEntry,
  type FileLocation,
} from '../services/systemDiagram/enrichment/fileEntries';
import { isIgnoredWorkspacePath } from '../services/systemDiagram/enrichment/workspaceFilter';

const IP_PATTERN = /\.ip\.yml$/;
const HDL_PATTERN = /\.(?:vhd|vhdl|v|sv)$/;
const QSYS_PATTERN = /\.qsys$/;
/** The same limits as the viewer's `findFiles` calls. */
export const IP_LIMIT = 2000;
export const HDL_LIMIT = 5000;
export const QSYS_LIMIT = 2000;

export type Warn = (message: string) => void;

interface FoundFiles {
  ip: string[];
  hdl: string[];
  qsys: string[];
}

/**
 * Every matching file under `root`, as sorted POSIX paths relative to it, at most the kind's limit
 * each (the first by path, so the cut-off is the same on every OS). Ignored folders are not
 * entered; symbolic links are followed unless they close a loop; a broken link is skipped.
 */
async function scanWorkspace(root: string, warn: Warn): Promise<FoundFiles> {
  const found: FoundFiles = { ip: [], hdl: [], qsys: [] };
  const walk = async (relativeDir: string, ancestors: ReadonlySet<string>): Promise<void> => {
    const dir = path.join(root, relativeDir);
    let entries;
    let real;
    try {
      real = await realpath(dir);
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      warn(`Skipping unreadable folder ${dir}: ${String(error)}`);
      return;
    }
    const chain = new Set(ancestors).add(real);
    for (const entry of entries) {
      const relative = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;
      if (isIgnoredWorkspacePath(relative)) {
        continue;
      }
      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(path.join(root, relative));
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          continue;
        }
      }
      if (isDirectory) {
        const target = await realpath(path.join(root, relative)).catch(() => undefined);
        if (target !== undefined && !chain.has(target)) {
          await walk(relative, chain);
        }
      } else if (isFile) {
        if (IP_PATTERN.test(entry.name)) {
          found.ip.push(relative);
        } else if (HDL_PATTERN.test(entry.name)) {
          found.hdl.push(relative);
        } else if (QSYS_PATTERN.test(entry.name)) {
          found.qsys.push(relative);
        }
      }
    }
  };
  await walk('', new Set());
  const first = (list: string[], limit: number) => list.sort().slice(0, limit);
  return {
    ip: first(found.ip, IP_LIMIT),
    hdl: first(found.hdl, HDL_LIMIT),
    qsys: first(found.qsys, QSYS_LIMIT),
  };
}

/** Maps `read` over `items` with a small pool; an item that is unreadable (undefined or a throw) is dropped, a throw is reported. */
async function readAll<T, U>(
  items: T[],
  read: (item: T) => Promise<U | undefined>,
  onError: (item: T, error: unknown) => void
): Promise<U[]> {
  const results = new Array<U | undefined>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await read(items[index]);
      } catch (error) {
        onError(items[index], error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, items.length) }, worker));
  return results.filter((result): result is Awaited<U> => result !== undefined);
}

/** UTF-8 text without a byte order mark, as the extension decodes files. */
const readText = async (file: string) =>
  (await readFile(file)).toString('utf8').replace(/^\uFEFF/, '');

/** File discovery and reads for the workspace directory `root`; each list is built once, on first use. */
export function createWorkspaceIo(
  root: string,
  warn: Warn = () => undefined
): EnrichmentIo<string> {
  const base = path.resolve(root);
  const locate = (relative: string): FileLocation<string> => {
    const file = path.join(base, relative);
    return { file, displayName: relative, uri: pathToFileURL(file).toString(), ref: file };
  };
  const once = <T>(build: () => Promise<T>): (() => Promise<T>) => {
    let cached: Promise<T> | undefined;
    return () => (cached ??= build());
  };
  const files = once(() => scanWorkspace(base, warn));
  const skipped = (relative: string, error: unknown) =>
    warn(
      `Skipping unreadable file ${relative}: ${error instanceof Error ? error.message : String(error)}`
    );
  return {
    listIpFiles: once(async () =>
      readAll(
        (await files()).ip,
        async (relative) => {
          const location = locate(relative);
          return ipEntryFromText(await readText(location.file), location);
        },
        skipped
      )
    ),
    listHdlFiles: once(async () =>
      readAll(
        (await files()).hdl,
        async (relative) => {
          const location = locate(relative);
          if ((await stat(location.file)).size > HDL_MAX_BYTES) {
            return undefined;
          }
          return hdlEntryFromText(await readText(location.file), location);
        },
        skipped
      )
    ),
    listQsysFiles: once(async () =>
      (await files()).qsys.map((relative) => qsysEntry(locate(relative)))
    ),
    readText,
  };
}

/** One {@link createWorkspaceIo} per directory, so a batch scans each workspace once. */
export class WorkspaceIoPool {
  private readonly ios = new Map<string, EnrichmentIo<string>>();

  constructor(private readonly warn: Warn = () => undefined) {}

  get(root: string): EnrichmentIo<string> {
    const key = path.resolve(root);
    let io = this.ios.get(key);
    if (!io) {
      io = createWorkspaceIo(key, this.warn);
      this.ios.set(key, io);
    }
    return io;
  }
}
