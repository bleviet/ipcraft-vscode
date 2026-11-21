/**
 * The numbers of per-block build reports: the flat Vivado report of an out-of-context IP, or the
 * top row of the entity table of a Quartus `.fit.rpt`. Pure: report text in, metrics and one
 * usage vector per report out.
 */

import type { ResourceMetric, ResourceVendor } from '../../domain/resourceUsage';
import { parseQuartusEntities } from './quartusEntityTable';
import { recognizeReport } from './reportKind';
import {
  buildMetricLayout,
  readQuartusCapacity,
  readVivadoFlat,
  vivadoFlatMetrics,
} from './resourceMetrics';

/** One build report of one block (or, without `instance`, of the IP an `xciName` names). */
export interface BuildReportInput {
  /** Instance path the report belongs to; without it the block is found by `xciName` = `design`. */
  instance?: string;
  /** The Design of a Vivado report; matched with the `xciName` of a block. */
  design: string;
  text: string;
  /** Quartus: the `.fit.summary` that holds the device capacity. */
  capacityText?: string;
}

export interface BuildUsages {
  vendor: ResourceVendor;
  metrics: ResourceMetric[];
  /** Aligned with the input reports and with `metrics`. */
  used: number[][];
}

/** The device of a Quartus build, from its `.fit.summary`. */
export function readQuartusDevice(summary: string): string | undefined {
  return /^Device\s*:\s*(.+?)\s*$/m.exec(summary)?.[1];
}

/**
 * The device the builds share. `ok` is false when two of them name different devices: their
 * capacities do not describe one device, so none is shown. A build that names none is ignored.
 */
export function commonDevice(devices: Array<string | undefined>): {
  ok: boolean;
  device?: string;
} {
  const known = [...new Set(devices.filter((device): device is string => device !== undefined))];
  return known.length > 1 ? { ok: false } : { ok: true, ...(known[0] && { device: known[0] }) };
}

/** A source never mixes vendors: the first report decides. */
function isQuartus(reports: BuildReportInput[]): boolean {
  const first = reports[0] && recognizeReport(reports[0].text);
  return first?.recognized === true && first.kind === 'quartus-entity';
}

function readQuartusBuilds(reports: BuildReportInput[]): BuildUsages {
  // The first report decides the stage, as it decides the vendor.
  const recognized = recognizeReport(reports[0].text);
  const stage = recognized.recognized ? recognized.stage : 'fit';
  const layouts = reports.map(({ text }) => {
    const table = parseQuartusEntities(text);
    const layout = buildMetricLayout('quartus', stage, table.columns);
    return { columns: table.columns, layout, usage: layout.project(table.root.total) };
  });
  const summaries = reports.flatMap(({ capacityText }) => (capacityText ? [capacityText] : []));
  const same = commonDevice(summaries.map(readQuartusDevice)).ok;
  const capacity = same && summaries[0] ? readQuartusCapacity(summaries[0]) : {};
  const metrics = buildMetricLayout('quartus', stage, layouts[0].columns, capacity).metrics;
  const used = layouts.map(({ layout, usage }) => {
    const byKey = new Map(layout.metrics.map((metric, i) => [metric.key, usage[i]]));
    return metrics.map((metric) => byKey.get(metric.key) ?? 0);
  });
  return { vendor: 'quartus', metrics, used };
}

export function readBuildUsages(reports: BuildReportInput[]): BuildUsages {
  if (isQuartus(reports)) {
    return readQuartusBuilds(reports);
  }
  const parsed = reports.map(({ text }) => readVivadoFlat(text));
  const devices = reports.map(({ text }) => {
    const recognition = recognizeReport(text);
    return recognition.recognized ? recognition.device : undefined;
  });
  return {
    vendor: 'vivado',
    metrics: vivadoFlatMetrics(commonDevice(devices).ok ? parsed[0]?.capacity : undefined),
    used: parsed.map(({ used }) => used),
  };
}
