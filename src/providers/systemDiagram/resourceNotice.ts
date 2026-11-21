import * as fs from 'fs/promises';
import type { ResourceReport } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import { rootMissingMessage } from '../../services/resources/blockBuild';
import type { LoadedSource } from '../../services/resources/loadResourceSource';
import type { SourceEntry } from '../../services/resources/resourceSources';
import type { DiagramResources } from '../../shared/messages/systemDiagram';

/** The line above the numbers of the chosen source: what to know before trusting them, if anything. */
export async function sourceNotice(
  entry: SourceEntry,
  loaded: LoadedSource,
  report: ResourceReport,
  graph: SystemGraph,
  designFile: string
): Promise<DiagramResources['notice']> {
  if (loaded.kind === 'hierarchy' && report.root === undefined) {
    const { root } = loaded.input.table;
    return {
      kind: 'rootMissing',
      message: `${rootMissingMessage(graph.name, root.name)}.`,
    };
  }
  if (entry.copy && report.source.date !== undefined) {
    return { kind: 'reportDate', message: `Report from ${report.source.date}` };
  }
  if (entry.linked) {
    const design = await fs.stat(designFile).catch(() => undefined);
    if (design && loaded.modified < design.mtimeMs) {
      return { kind: 'olderThanDesign', message: 'The report is older than the design file' };
    }
  }
  return undefined;
}
