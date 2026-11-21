/** `ipcraft render --resources`: the report files mapped onto the drawn design, for the strips of the image. */

import type { SystemGraph } from '../domain/systemGraph';
import { mapReportFiles } from '../services/resources/mapReportFiles';
import type { ResourceRender } from '../shared/render/resourceSvg';
import { readReportText } from './resources';

export interface CliResourcesOption {
  /** One hierarchical report, or several flat per-IP reports (see `mapReportFiles`). */
  reports: string[];
  /** A flat Vivado report or a Quartus `.fit.summary` for the device percentages. */
  capacity?: string;
}

/** The usage to draw on `graph`; the notes of the mapping (and a design missing from the report) go to stderr. */
export async function loadResourceRender(
  graph: SystemGraph,
  option: CliResourcesOption
): Promise<ResourceRender> {
  const files = await Promise.all(
    option.reports.map((file) => readReportText(file, 'Report file'))
  );
  const capacity =
    option.capacity === undefined
      ? undefined
      : await readReportText(option.capacity, 'Capacity file');
  const { report, notes } = mapReportFiles(graph, files, { capacity });
  if (report.stage !== 'ooc' && report.root === undefined) {
    notes.push(`The design ${graph.name} is not in the report; no block has figures`);
  }
  for (const note of notes) {
    process.stderr.write(`Warning: ${note}\n`);
  }
  return { report };
}
