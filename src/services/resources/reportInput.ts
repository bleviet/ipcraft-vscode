/**
 * What turns the text of a recognized report into the input of the mapping, shared by the system
 * viewer (which reads the files itself) and the command line. Pure: text in, input out.
 */

import type { ResourceReport } from '../../domain/resourceUsage';
import type { HierarchyReportInput } from './mapReportToGraph';
import { parseQuartusEntities } from './quartusEntityTable';
import { recognizeReport, type RecognizedReport } from './reportKind';
import { readQuartusCapacity, readVivadoFlat } from './resourceMetrics';
import { parseVivadoHierarchy } from './vivadoHierarchyTable';

/** Why a flat report cannot be the source of the usage of every block. */
export const FLAT_REASON =
  'This report has only the design total, not one figure per block. Run report_utilization with the -hierarchical option to write a report that has them.';

/**
 * `fileName` is what the report shows as its source. The OOC group's first member names one IP,
 * not the design, so only a hierarchical report (`hierarchy`) names the design.
 */
export function reportSource(
  recognition: RecognizedReport,
  fileName: string,
  hierarchy: boolean
): ResourceReport['source'] {
  const design = recognition.design ?? recognition.revision;
  return {
    fileName,
    ...(recognition.date !== undefined && { date: recognition.date }),
    ...(recognition.toolVersion !== undefined && { toolVersion: recognition.toolVersion }),
    ...(recognition.device !== undefined && { device: recognition.device }),
    ...(hierarchy && design !== undefined && { design }),
  };
}

/** The Design of a flat per-IP report, or an empty string when it has none. */
export function designOf(text: string): string {
  const recognition = recognizeReport(text);
  return recognition.recognized ? (recognition.design ?? '') : '';
}

/** The mapping input of a hierarchical report; `capacityText` is a flat Vivado report or a Quartus `.fit.summary`. */
export function hierarchyInput(
  recognition: RecognizedReport,
  text: string,
  source: ResourceReport['source'],
  capacityText?: string
): HierarchyReportInput {
  if (recognition.vendor === 'quartus') {
    return {
      table: parseQuartusEntities(text),
      vendor: 'quartus',
      stage: recognition.stage,
      source,
      ...(capacityText !== undefined && { capacity: readQuartusCapacity(capacityText) }),
    };
  }
  return {
    table: parseVivadoHierarchy(text),
    vendor: 'vivado',
    stage: recognition.stage,
    source,
    ...(capacityText !== undefined && { capacity: readVivadoFlat(capacityText).capacity }),
  };
}
