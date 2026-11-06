/**
 * Expands Platform Designer subsystems: a module whose `kind` is the base name
 * of another `.qsys` file in the workspace is replaced by that file's system,
 * grafted inline as a hierarchy level (see {@link graftSubsystem}). Nested
 * subsystems are expanded recursively; a file that instantiates itself,
 * directly or through others, is left as an opaque instance with a warning.
 */

import * as vscode from 'vscode';
import type { SystemDiagnostic, SystemGraph } from '../../domain/systemGraph';
import { readQsys } from '../../parser/system/QsysReader';
import { fileBaseName } from '../../parser/system/qsysSystem';
import { Logger } from '../../utils/Logger';
import { graftSubsystem } from './enrichment/graftSubsystem';
import { matchSubsystems, type QsysFileKey } from './enrichment/matchDefinitions';
import { WorkspaceFileIndex } from './WorkspaceFileIndex';

const QSYS_GLOB = '**/*.qsys';
const QSYS_LIMIT = 2000;

interface QsysEntry extends QsysFileKey {
  uri: vscode.Uri;
}

export class SubsystemExpander {
  private readonly logger = new Logger('SubsystemExpander');
  private readonly index = new WorkspaceFileIndex<QsysEntry>(
    QSYS_GLOB,
    QSYS_LIMIT,
    (uri) =>
      Promise.resolve({
        uri,
        file: uri.fsPath,
        displayName: vscode.workspace.asRelativePath(uri, false),
        systemName: fileBaseName(uri.fsPath),
      }),
    this.logger
  );

  /** `designFile` is the path of the design: the nearest subsystem file wins a tie. */
  async expand(graph: SystemGraph, designFile: string): Promise<SystemGraph> {
    if (graph.source.format !== 'qsys' && graph.source.format !== 'qsys-tcl') {
      return graph;
    }
    return this.expandWithin(graph, designFile, await this.index.get(), [designFile]);
  }

  dispose(): void {
    this.index.dispose();
  }

  private async expandWithin(
    graph: SystemGraph,
    designFile: string,
    files: readonly QsysEntry[],
    stack: readonly string[]
  ): Promise<SystemGraph> {
    const matches = matchSubsystems(graph, files, designFile);
    const notes: SystemDiagnostic[] = [...matches.diagnostics];
    let result = graph;
    for (const [path, entry] of matches.qsys) {
      const instance = graph.instances[path];
      if (stack.includes(entry.file)) {
        notes.push({
          severity: 'warning',
          message: `${instance.name}: ${entry.displayName} instantiates itself.`,
          lines: [instance.line],
          ...(instance.parent !== '/' && { level: instance.parent }),
        });
        continue;
      }
      try {
        const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(entry.uri));
        const read = readQsys(text, entry.displayName);
        const child = await this.expandWithin(read, entry.file, files, [...stack, entry.file]);
        result = graftSubsystem(result, path, child, {
          fileName: entry.displayName,
          uri: entry.uri.toString(),
        });
      } catch (error) {
        this.logger.warn(`Could not read subsystem ${entry.displayName}: ${String(error)}`);
        notes.push({
          severity: 'warning',
          message: `${instance.name}: Could not read subsystem ${entry.displayName}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          lines: [instance.line],
          ...(instance.parent !== '/' && { level: instance.parent }),
        });
      }
    }
    return notes.length === 0
      ? result
      : { ...result, diagnostics: [...result.diagnostics, ...notes] };
  }
}
