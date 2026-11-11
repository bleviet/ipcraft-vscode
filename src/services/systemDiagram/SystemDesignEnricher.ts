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
import {
  BD_LINKS_FILE,
  linksForDesign,
  parseBdLinks,
  type DesignLinks,
} from './enrichment/bdLinks';
import { vivadoProjectDesigns, type CmakeEntry } from './enrichment/cmakeProjects';
import type { EnrichmentIo, EnrichmentLog } from './enrichment/enrichmentIo';
import { bdTclCandidates } from './enrichment/expandContainers';
import { enrichSystemGraph, hasOnlyHierarchies } from './enrichment/enrichSystemGraph';
import {
  HDL_MAX_BYTES,
  TCL_MAX_BYTES,
  bdTclEntryFromText,
  hdlEntryFromText,
  ipEntryFromText,
  type BdTclEntry,
  type HdlEntry,
  type IpEntry,
} from './enrichment/fileEntries';
import { revisionIo, type ReadAt } from './enrichment/revisionIo';
import type { RankedBdTcl } from './enrichment/rankBdTcl';
import { SubsystemExpander } from './SubsystemExpander';
import { WorkspaceFileIndex } from './WorkspaceFileIndex';

const IP_GLOB = '**/*.ip.yml';
const HDL_GLOB = '**/*.{vhd,vhdl,v,sv}';
const TCL_GLOB = '**/*.tcl';
const CMAKE_GLOB = '**/CMakeLists.txt';
const IP_LIMIT = 2000;
const HDL_LIMIT = 5000;
const TCL_LIMIT = 5000;
const CMAKE_LIMIT = 5000;
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
  private readonly tclIndex = new WorkspaceFileIndex<BdTclEntry<vscode.Uri>>(
    TCL_GLOB,
    TCL_LIMIT,
    async (uri) => {
      const stat = await vscode.workspace.fs.stat(uri);
      return stat.size > TCL_MAX_BYTES
        ? undefined
        : bdTclEntryFromText(await readText(uri), locationOf(uri));
    },
    this.logger
  );
  private readonly cmakeIndex = new WorkspaceFileIndex<CmakeEntry>(
    CMAKE_GLOB,
    CMAKE_LIMIT,
    async (uri) => {
      const projects = vivadoProjectDesigns(await readText(uri), uri.fsPath);
      return projects.length === 0 ? undefined : { file: uri.fsPath, projects };
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
    listBdTclFiles: () => this.tclIndex.get(),
    listCmakeFiles: () => this.cmakeIndex.get(),
    locate: (file) => locationOf(vscode.Uri.file(file)),
    readBdLinks: (designFile) => this.readBdLinks(designFile),
    readText,
  };

  /** The links file of the design's workspace folder; a missing or invalid one gives no links. */
  private async readBdLinks(designFile: string): Promise<DesignLinks> {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(designFile));
    if (!folder) {
      return { links: {}, rejected: {} };
    }
    let text;
    try {
      text = await readText(vscode.Uri.joinPath(folder.uri, BD_LINKS_FILE));
    } catch {
      return { links: {}, rejected: {} };
    }
    try {
      return linksForDesign(parseBdLinks(text), folder.uri.fsPath, designFile);
    } catch (error) {
      this.logger.warn(`Ignoring ${BD_LINKS_FILE}: ${String(error)}`);
      return { links: {}, rejected: {} };
    }
  }

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
      this.tclIndex.revision,
      this.cmakeIndex.revision,
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

  /** The Tcl files that may generate block design `bd` of a container in `designFile`, best first. */
  bdTclCandidates(designFile: string, bd: string): Promise<RankedBdTcl<vscode.Uri>[]> {
    return bdTclCandidates(bd, designFile, this.io, this.log);
  }

  dispose(): void {
    this.ipIndex.dispose();
    this.hdlIndex.dispose();
    this.tclIndex.dispose();
    this.cmakeIndex.dispose();
    this.subsystems.dispose();
  }
}
