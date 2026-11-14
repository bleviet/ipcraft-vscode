/** The I/O and logging the enrichment pipeline is given, so it runs in VS Code and on the CLI. */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { HdlEntry, IpEntry, QsysEntry } from './fileEntries';

export interface EnrichmentIo<R> {
  /**
   * `graph` is the graph the pipeline is about to match (subsystems already grafted) and
   * `designFile` the design: an io may read only the files that can match them.
   */
  listIpFiles(graph: SystemGraph, designFile: string): Promise<IpEntry<R>[]>;
  /** Called only when the graph has module instances. */
  listHdlFiles(): Promise<HdlEntry<R>[]>;
  /** Called only for Platform Designer designs. */
  listQsysFiles(): Promise<QsysEntry<R>[]>;
  readText(ref: R): Promise<string>;
}

export interface EnrichmentLog {
  warn(message: string): void;
  error(message: string, error: Error): void;
}

/** Thrown by `readText` for a file that is not there: the pipeline skips that file without an error line. */
export class FileAbsentError extends Error {
  constructor(message = 'The file is not at the base revision.') {
    super(message);
    this.name = 'FileAbsentError';
  }
}

/** Thrown by `readText` when the source fails as a whole, not for one file: the pipeline stops and the caller decides. */
export class SourceFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceFailedError';
  }
}
