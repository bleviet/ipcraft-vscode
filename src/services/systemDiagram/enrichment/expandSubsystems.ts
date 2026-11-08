/**
 * Expands Platform Designer subsystems: a module whose `kind` is the base name
 * of another `.qsys` file in the workspace is replaced by that file's system,
 * grafted inline as a hierarchy level (see {@link graftSubsystem}). Nested
 * subsystems are expanded recursively; a file that instantiates itself,
 * directly or through others, is left as an opaque instance with a warning.
 */

import type { SystemDiagnostic, SystemGraph } from '../../../domain/systemGraph';
import { readQsys } from '../../../parser/system/QsysReader';
import type { EnrichmentIo, EnrichmentLog } from './enrichmentIo';
import type { QsysEntry } from './fileEntries';
import { graftSubsystem } from './graftSubsystem';
import { matchSubsystems } from './matchDefinitions';

/** `designFile` is the path of the design: the nearest subsystem file wins a tie. */
export async function expandSubsystems<R>(
  graph: SystemGraph,
  designFile: string,
  io: EnrichmentIo<R>,
  log?: EnrichmentLog
): Promise<SystemGraph> {
  if (graph.source.format !== 'qsys' && graph.source.format !== 'qsys-tcl') {
    return graph;
  }
  return expandWithin(graph, designFile, await io.listQsysFiles(), [designFile], io, log);
}

async function expandWithin<R>(
  graph: SystemGraph,
  designFile: string,
  files: readonly QsysEntry<R>[],
  stack: readonly string[],
  io: EnrichmentIo<R>,
  log?: EnrichmentLog
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
      const read = readQsys(await io.readText(entry.ref), entry.displayName);
      const child = await expandWithin(read, entry.file, files, [...stack, entry.file], io, log);
      result = graftSubsystem(result, path, child, {
        fileName: entry.displayName,
        uri: entry.uri,
      });
    } catch (error) {
      log?.warn(`Could not read subsystem ${entry.displayName}: ${String(error)}`);
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
