/**
 * VS Code adapter of the system diagram enrichment (see {@link enrichSystemGraph}):
 * the workspace file indexes, file reads through `vscode.workspace.fs`, and the
 * untrusted-workspace guard.
 *
 * This keeps its own small indexes instead of reusing `SubcoreResolver`: that
 * index is not instantiated by the extension and keys only exact VLNVs, while
 * the system viewer also needs case-insensitive VLNVs, Platform Designer
 * component names and HDL entity/module names. Both indexes are built lazily
 * and kept current per file by watchers (see {@link WorkspaceFileIndex}).
 */

import * as vscode from 'vscode';
import type { SystemGraph } from '../../domain/systemGraph';
import { Logger } from '../../utils/Logger';
import type { EnrichmentIo, EnrichmentLog } from './enrichment/enrichmentIo';
import { enrichSystemGraph, hasOnlyHierarchies } from './enrichment/enrichSystemGraph';
import {
  HDL_MAX_BYTES,
  hdlEntryFromText,
  ipEntryFromText,
  type HdlEntry,
  type IpEntry,
} from './enrichment/fileEntries';
import { revisionIo, type ReadAt } from './enrichment/revisionIo';
import { SubsystemExpander } from './SubsystemExpander';
import { WorkspaceFileIndex } from './WorkspaceFileIndex';

const IP_GLOB = '**/*.ip.yml';
const HDL_GLOB = '**/*.{vhd,vhdl,v,sv}';
const IP_LIMIT = 2000;
const HDL_LIMIT = 5000;
const UNTRUSTED_MESSAGE = 'IP definitions are not read in untrusted workspaces.';

async function readText(uri: vscode.Uri): Promise<string> {
  return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
}

const locationOf = (uri: vscode.Uri) => ({
  file: uri.fsPath,
  displayName: vscode.workspace.asRelativePath(uri, false),
  uri: uri.toString(),
  ref: uri,
});

export class SystemDesignEnricher {
  private readonly logger = new Logger('SystemDesignEnricher');
  private readonly ipIndex = new WorkspaceFileIndex<IpEntry<vscode.Uri>>(
    IP_GLOB,
    IP_LIMIT,
    async (uri) => ipEntryFromText(await readText(uri), locationOf(uri)),
    this.logger
  );
  private readonly subsystems = new SubsystemExpander();
  private readonly hdlIndex = new WorkspaceFileIndex<HdlEntry<vscode.Uri>>(
    HDL_GLOB,
    HDL_LIMIT,
    async (uri) => {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.size > HDL_MAX_BYTES
        ? undefined
        : hdlEntryFromText(await readText(uri), locationOf(uri));
    },
    this.logger
  );
  private readonly log: EnrichmentLog = {
    warn: (message) => this.subsystems.logger.warn(message),
    error: (message, error) => this.logger.error(message, error),
  };
  private readonly io: EnrichmentIo<vscode.Uri> = {
    listIpFiles: () => this.ipIndex.get(),
    listHdlFiles: () => this.hdlIndex.get(),
    listQsysFiles: () => this.subsystems.files(),
    readText,
  };

  /**
   * Changes whenever what `enrich` reads may have changed: the definition files (the HDL and
   * `.qsys` files it reads are the files of their indexes, so the indexes cover their content
   * too) and whether the workspace is trusted. An enrichment is current while this is unchanged.
   * The HDL and `.qsys` contents are read from disk when `enrich` runs, but this changes only
   * when the file watcher reports the save: an enrichment between the two can read the new
   * content under the old revision, until the next change of the revision.
   */
  get revision(): string {
    return [
      this.ipIndex.revision,
      this.hdlIndex.revision,
      this.subsystems.revision,
      vscode.workspace.isTrusted,
    ].join('.');
  }

  /**
   * `designFile` is the path of the design: the nearest definition wins a tie. With `readAt`
   * the definitions are read as they were at a revision (see {@link revisionIo}), not from disk.
   */
  async enrich(
    read: SystemGraph,
    designFile: string,
    readAt?: ReadAt<vscode.Uri>
  ): Promise<SystemGraph> {
    if (hasOnlyHierarchies(read)) {
      return read;
    }
    if (!vscode.workspace.isTrusted) {
      return {
        ...read,
        diagnostics: [...read.diagnostics, { severity: 'info', message: UNTRUSTED_MESSAGE }],
      };
    }
    return enrichSystemGraph(
      read,
      designFile,
      readAt ? revisionIo(this.io, readAt) : this.io,
      this.log
    );
  }

  dispose(): void {
    this.ipIndex.dispose();
    this.hdlIndex.dispose();
    this.subsystems.dispose();
  }
}
