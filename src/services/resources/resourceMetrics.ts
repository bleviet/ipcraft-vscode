/**
 * Resource vocabulary: turns the numeric columns of a parsed report table into
 * {@link ResourceMetric}s (the four primary metrics of the vendor first, then
 * every other column as written) and projects a row's values onto them. Columns
 * are found by header text, never by position. Also reads device capacity.
 */

import type { ResourceMetric, ResourceStage, ResourceVendor } from '../../domain/resourceUsage';
import { readVivadoFlatRow } from './vivadoFlatTable';
import { VIVADO_ROW_LABELS, type VivadoPrimaryKey } from './vivadoRowLabels';

/** Units available on the device, keyed by {@link ResourceMetric.key}. */
export type CapacityTable = Partial<Record<string, number>>;

export interface MetricLayout {
  metrics: ResourceMetric[];
  /** Maps the values of one table row (aligned with the columns) to the metric vector. */
  project: (values: number[]) => number[];
  /** Like `project` for self figures: a metric is `null` when any column it adds up is `null`. */
  projectSelf: (values: Array<number | null>) => Array<number | null>;
}

interface PrimarySpec {
  key: string;
  label: string;
  /** Header text and weight of each column that adds up to the metric. */
  columns: Array<[name: string, weight: number]>;
}

/** The Vivado primaries; `key` also names the figure's row labels in a flat report. */
const VIVADO_PRIMARY: Array<PrimarySpec & { key: VivadoPrimaryKey }> = [
  { key: 'lut', label: 'LUTs', columns: [['Total LUTs', 1]] },
  { key: 'ff', label: 'FFs', columns: [['FFs', 1]] },
  {
    key: 'bram',
    label: 'BRAM',
    columns: [
      ['RAMB36', 1],
      ['RAMB18', 0.5],
    ],
  },
  { key: 'dsp', label: 'DSPs', columns: [['DSP Blocks', 1]] },
];

function quartusPrimary(stage: ResourceStage, columns: string[]): PrimarySpec[] {
  const registers: PrimarySpec = {
    key: 'reg',
    label: 'Registers',
    columns: [['Dedicated Logic Registers', 1]],
  };
  const dsp: PrimarySpec = { key: 'dsp', label: 'DSP Blocks', columns: [['DSP Blocks', 1]] };
  if (stage === 'fit') {
    const ram = columns.find((name) => /^M\d+Ks$/.test(name));
    return [
      { key: 'alm', label: 'ALMs', columns: [['ALMs needed [=A-B+C]', 1]] },
      registers,
      ...(ram ? [{ key: 'ram', label: ram, columns: [[ram, 1]] as PrimarySpec['columns'] }] : []),
      dsp,
    ];
  }
  return [
    { key: 'alut', label: 'ALUTs', columns: [['Combinational ALUTs', 1]] },
    registers,
    { key: 'memBits', label: 'Block Memory Bits', columns: [['Block Memory Bits', 1]] },
    dsp,
  ];
}

/** Metrics of the four flat Vivado rows (an out-of-context IP report). */
export function vivadoFlatMetrics(capacity?: CapacityTable): ResourceMetric[] {
  return VIVADO_PRIMARY.map(({ key, label }) => ({
    key,
    label,
    primary: true,
    ...(capacity?.[key] !== undefined && { capacity: capacity[key] }),
  }));
}

/** Used units, aligned with {@link vivadoFlatMetrics}, and the capacity of a flat Vivado report. */
export function readVivadoFlat(text: string): { used: number[]; capacity: CapacityTable } {
  const capacity: CapacityTable = {};
  const used = VIVADO_PRIMARY.map(({ key }) => {
    const found = readVivadoFlatRow(text, VIVADO_ROW_LABELS[key]);
    if (found?.available !== undefined) {
      capacity[key] = found.available;
    }
    return found?.used ?? 0;
  });
  return { used, capacity };
}

/** Capacity from a Quartus `.fit.summary`; registers have none. */
export function readQuartusCapacity(summary: string): CapacityTable {
  const capacity: CapacityTable = {};
  for (const [key, label] of [
    ['alm', 'Logic utilization \\(in ALMs\\)'],
    ['ram', 'Total RAM Blocks'],
    ['dsp', 'Total DSP Blocks'],
  ]) {
    const m = new RegExp(`^${label}\\s*:\\s*[\\d,]+\\s*/\\s*([\\d,]+)`, 'm').exec(summary);
    if (m) {
      capacity[key] = Number(m[1].replace(/,/g, ''));
    }
  }
  return capacity;
}

export function buildMetricLayout(
  vendor: ResourceVendor,
  stage: ResourceStage,
  columns: string[],
  capacity?: CapacityTable
): MetricLayout {
  const specs: PrimarySpec[] =
    vendor === 'vivado' ? VIVADO_PRIMARY : quartusPrimary(stage, columns);
  const metrics: ResourceMetric[] = [];
  const sources: Array<Array<{ index: number; weight: number }>> = [];
  const used = new Set<number>();
  for (const spec of specs) {
    const parts = spec.columns
      .map(([name, weight]) => ({ index: columns.indexOf(name), weight }))
      .filter(({ index }) => index >= 0);
    if (parts.length === 0) {
      continue;
    }
    parts.forEach(({ index }) => used.add(index));
    sources.push(parts);
    metrics.push({
      key: spec.key,
      label: spec.label,
      primary: true,
      ...(capacity?.[spec.key] !== undefined && { capacity: capacity[spec.key] }),
    });
  }
  columns.forEach((name, index) => {
    if (!used.has(index)) {
      sources.push([{ index, weight: 1 }]);
      metrics.push({ key: name, label: name, primary: false });
    }
  });
  return {
    metrics,
    project: (values) =>
      sources.map((parts) =>
        parts.reduce((sum, { index, weight }) => sum + (values[index] ?? 0) * weight, 0)
      ),
    projectSelf: (values) =>
      sources.map((parts) =>
        parts.some(({ index }) => values[index] === null || values[index] === undefined)
          ? null
          : parts.reduce((sum, { index, weight }) => sum + (values[index] as number) * weight, 0)
      ),
  };
}
