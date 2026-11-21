/**
 * The report files a user attached to a design, kept per design file in workspace state. A file
 * inside the workspace is linked (and can be watched); a file outside it is copied into the
 * extension's storage, so it survives a cleanup of the folder it came from. Extension side, no
 * `vscode`: the state and the workspace test come in through narrow typed parameters.
 */

import { randomBytes } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/** The part of `vscode.Memento` that is used. */
export interface AttachedStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

export interface AttachedRecord {
  id: string;
  /** File name of the report as the user attached it. */
  originalName: string;
  /** The linked workspace files, or the copies. */
  storedFiles: string[];
  /** ISO date. */
  attachedAt: string;
}

const COPIES_DIR = 'resource-reports';

/** A copy lives in `<storage>/resource-reports/<id>/`; a linked file is the user's own. */
function isCopiedFile(record: AttachedRecord, file: string): boolean {
  const dir = path.dirname(file);
  return path.basename(dir) === record.id && path.basename(path.dirname(dir)) === COPIES_DIR;
}

/** True when every file of the record is a copy; the modification time of a copy means nothing. */
export const isCopy = (record: AttachedRecord): boolean =>
  record.storedFiles.every((file) => isCopiedFile(record, file));

export class AttachedReports {
  private readonly key: string;

  constructor(
    private readonly store: AttachedStore,
    designUri: string,
    private readonly inWorkspace: (file: string) => boolean
  ) {
    this.key = `ipcraft.resources.attached:${designUri}`;
  }

  list(): AttachedRecord[] {
    return this.store.get<AttachedRecord[]>(this.key) ?? [];
  }

  /** Attaches the files of one report: links those in the workspace, copies the others. */
  async attachFiles(files: string[], storageDir: string | undefined): Promise<AttachedRecord> {
    const id = randomBytes(8).toString('hex');
    const storedFiles: string[] = [];
    for (const file of files) {
      if (this.inWorkspace(file)) {
        storedFiles.push(file);
        continue;
      }
      if (storageDir === undefined) {
        throw new Error('There is no extension storage to keep a copy of the report in.');
      }
      const dir = path.join(storageDir, COPIES_DIR, id);
      await fs.mkdir(dir, { recursive: true });
      const copy = path.join(dir, path.basename(file));
      await fs.copyFile(file, copy);
      storedFiles.push(copy);
    }
    const record: AttachedRecord = {
      id,
      originalName: path.basename(files[0]),
      storedFiles,
      attachedAt: new Date().toISOString(),
    };
    await this.store.update(this.key, [...this.list(), record]);
    return record;
  }

  /** Forgets the record and deletes the copies it made, never a linked workspace file. */
  async remove(id: string): Promise<void> {
    const record = this.list().find((r) => r.id === id);
    if (!record) {
      return;
    }
    for (const file of record.storedFiles.filter((f) => isCopiedFile(record, f))) {
      await fs.rm(path.dirname(file), { recursive: true, force: true });
    }
    const rest = this.list().filter((r) => r.id !== id);
    await this.store.update(this.key, rest.length > 0 ? rest : undefined);
  }
}
