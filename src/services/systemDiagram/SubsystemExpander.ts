/**
 * VS Code adapter of the subsystem index: the `.qsys` files of the workspace,
 * kept current by watchers (see {@link WorkspaceFileIndex}). The expansion
 * itself is {@link expandSubsystems}.
 */

import * as vscode from 'vscode';
import { Logger } from '../../utils/Logger';
import { qsysEntry, type QsysEntry } from './enrichment/fileEntries';
import { WorkspaceFileIndex } from './WorkspaceFileIndex';

const QSYS_GLOB = '**/*.qsys';
const QSYS_LIMIT = 2000;

export class SubsystemExpander {
  /** Tags the warnings about unreadable subsystem files. */
  readonly logger = new Logger('SubsystemExpander');
  private readonly index = new WorkspaceFileIndex<QsysEntry<vscode.Uri>>(
    QSYS_GLOB,
    QSYS_LIMIT,
    (uri) =>
      Promise.resolve(
        qsysEntry({
          file: uri.fsPath,
          displayName: vscode.workspace.asRelativePath(uri, false),
          uri: uri.toString(),
          ref: uri,
        })
      ),
    this.logger
  );

  /** Changes whenever the files or their content may have changed. */
  get revision(): number {
    return this.index.revision;
  }

  files(): Promise<QsysEntry<vscode.Uri>[]> {
    return this.index.get();
  }

  dispose(): void {
    this.index.dispose();
  }
}
