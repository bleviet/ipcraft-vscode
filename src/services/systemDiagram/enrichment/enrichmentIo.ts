/** The I/O and logging the enrichment pipeline is given, so it runs in VS Code and on the CLI. */

import type { HdlEntry, IpEntry, QsysEntry } from './fileEntries';

export interface EnrichmentIo<R> {
  listIpFiles(): Promise<IpEntry<R>[]>;
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
