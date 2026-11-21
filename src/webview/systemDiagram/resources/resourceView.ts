/**
 * Pure view logic of the resource usage in the system viewer: the texts and shares that the
 * block headers, the Details section, the Resources tab and the toolbar chip show from a
 * {@link ResourceReport} (see docs/concepts/brainstorm/system-resource-usage.md). The rows of the
 * Resources tab are in `resourceRows.ts`. No React.
 */

import type {
  ResourceMetric,
  ResourceReport,
  ResourceStage,
  ResourceUsage,
} from '../../../domain/resourceUsage';
import type { DiagramResources } from '../../../shared/messages/systemDiagram';

/** Shown where a figure does not exist. */
export const NO_VALUE = '—';

const STAGE_LABELS: Record<ResourceStage, string> = {
  ooc: 'Per block',
  synth: 'Post-synthesis',
  placed: 'Post-placement',
  routed: 'Post-route',
  fit: 'Fitter',
};

export const stageLabel = (stage: ResourceStage): string => STAGE_LABELS[stage];

const NOT_IN_REPORT_NOTE =
  'Not in the report: no logic left after optimization, or the report is for another revision of the design.';
const NOT_IN_BLOCK_NOTE = 'No report of this block on its own: it has no build of its own.';
/** Vivado adds its own reasons: the out-of-context run of an IP, and the IP cache. */
const NOT_IN_VIVADO_BLOCK_NOTE =
  'No report of this block on its own: it has no build of its own, it was not synthesized out of context, or its run was an IP cache hit.';

/** Why a block has no row: the per-block stage has its own reasons, and Vivado some more. */
export const notInReportNote = (report: Pick<ResourceReport, 'stage' | 'vendor'>): string =>
  report.stage !== 'ooc'
    ? NOT_IN_REPORT_NOTE
    : report.vendor === 'vivado'
      ? NOT_IN_VIVADO_BLOCK_NOTE
      : NOT_IN_BLOCK_NOTE;

/** The label of a metric on the strip above a block, from its key (a memory block's name is the column's). */
const SHORT_LABELS: Record<string, string> = {
  lut: 'LUT',
  ff: 'FF',
  bram: 'BRAM',
  dsp: 'DSP',
  alm: 'ALM',
  alut: 'ALUT',
  reg: 'Reg',
  memBits: 'Mem bits',
};

function shortLabel(metric: ResourceMetric): string {
  return (
    SHORT_LABELS[metric.key] ??
    (metric.key === 'ram' ? /^M\d+K/.exec(metric.label)?.[0] : undefined) ??
    metric.label
  );
}

export const SUMMED_NOTE = 'Sum of the blocks inside, each built on its own';

/** Integers as they are up to 9999, then `12.3k` and `1.2M`; a fraction (Quartus ALMs) with one decimal. */
export function formatCount(n: number): string {
  const trim = (value: number): string => String(Number(value.toFixed(1)));
  const abs = Math.abs(n);
  if (abs < 10000) {
    return trim(n);
  }
  return abs < 999950 ? `${trim(n / 1000)}k` : `${trim(n / 1e6)}M`;
}

/** `18.3 %`; a figure that rounds to zero but is not zero reads `< 0.1 %`. */
export function formatPercent(fraction: number): string {
  const percent = fraction * 100;
  if (percent === 0) {
    return '0 %';
  }
  return percent < 0.05 ? '< 0.1 %' : `${percent.toFixed(1)} %`;
}

/** The indexes in `report.metrics` of the metrics shown on every block. */
export const indexesOfPrimary = (report: ResourceReport): number[] =>
  report.metrics.flatMap((metric, index) => (metric.primary ? [index] : []));

/** The metrics shown on every block, in report order. */
export function primaryMetrics(report: ResourceReport): ResourceMetric[] {
  return indexesOfPrimary(report).map((index) => report.metrics[index]);
}

export const primaryValues = (report: ResourceReport, values: readonly number[]): number[] =>
  indexesOfPrimary(report).map((index) => values[index] ?? 0);

export const fractionOf = (value: number, whole: number): number | undefined =>
  whole > 0 ? Math.min(1, Math.max(0, value / whole)) : undefined;

/**
 * The share of the device a usage takes in the metric at `index`, in [0, 1]. Undefined when the
 * metric has no capacity, or the usage is a sum of out-of-context runs (not placed on the device).
 */
export function deviceShare(
  report: ResourceReport,
  usage: ResourceUsage,
  index: number
): number | undefined {
  const capacity = report.metrics[index]?.capacity;
  return capacity === undefined || usage.summed
    ? undefined
    : fractionOf(usage.total[index], capacity);
}

/** A share as text: `1.1 %`, or an em dash when unknown. */
export const formatShare = (share: number | undefined): string =>
  share === undefined ? NO_VALUE : formatPercent(share);

/** The share of the design a usage takes in the metric at `index`; undefined for no usage or an empty design. */
const designShare = (
  report: ResourceReport,
  usage: ResourceUsage,
  index: number
): number | undefined =>
  usage.total[index] > 0
    ? fractionOf(usage.total[index], report.design.total[index] ?? 0)
    : undefined;

/** What a block header shows of the report. */
export interface NodeResources {
  /** The first line of the strip above the block: `154 LUT · 168 FF · 0 BRAM · 0 DSP`, `Σ ` before a summed total, or the missing-row note. */
  strip: string;
  /** The second line: `18.3 % design · 1.1 % device` (the shares of the first primary metric); absent when neither exists. */
  shares?: string;
  /** The block's share of its level (first primary metric), in [0, 1]. */
  share?: number;
  notInReport: boolean;
  /** The full tooltip of the header. */
  title: string;
}

const parentPath = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
};

/** The tooltip of a header: the stage, every primary metric with its share of the design and of the device. */
export function headerTitle(report: ResourceReport, path: string): string {
  const usage = report.instances[path];
  if (!usage) {
    return report.notInReport.includes(path) ? notInReportNote(report) : '';
  }
  const figures = indexesOfPrimary(report).map((index) => {
    const share = designShare(report, usage, index);
    const device = deviceShare(report, usage, index);
    const parts = [
      ...(share === undefined ? [] : [`${formatPercent(share)} of design`]),
      ...(device === undefined ? [] : [`${formatPercent(device)} of device`]),
    ];
    const total = formatCount(usage.total[index]);
    return `${report.metrics[index].label} ${total}${parts.length === 0 ? '' : ` (${parts.join(', ')})`}`;
  });
  const note = usage.summed ? `. ${SUMMED_NOTE}` : '';
  return `${stageLabel(report.stage)}: ${figures.join(', ')}${note}`;
}

/** The header data of a block, or undefined when the report says nothing about `path`. */
export function nodeResources(report: ResourceReport, path: string): NodeResources | undefined {
  const usage = report.instances[path];
  if (!usage) {
    return report.notInReport.includes(path)
      ? {
          strip: report.stage === 'ooc' ? 'no block report' : 'not in report',
          notInReport: true,
          title: headerTitle(report, path),
        }
      : undefined;
  }
  const first = indexesOfPrimary(report)[0];
  const parent = parentPath(path);
  const level = parent === '/' ? report.design : report.instances[parent];
  const share =
    first === undefined || !level ? undefined : fractionOf(usage.total[first], level.total[first]);
  const line = indexesOfPrimary(report)
    .map((index) => `${formatCount(usage.total[index])} ${shortLabel(report.metrics[index])}`)
    .join(' · ');
  const ofDesign = first === undefined ? undefined : designShare(report, usage, first);
  const ofDevice = first === undefined ? undefined : deviceShare(report, usage, first);
  const shares = [
    ...(ofDesign === undefined ? [] : [`${formatPercent(ofDesign)} design`]),
    ...(ofDevice === undefined ? [] : [`${formatPercent(ofDevice)} device`]),
  ].join(' · ');
  return {
    strip: `${usage.summed ? 'Σ ' : ''}${line}`,
    ...(shares !== '' && { shares }),
    ...(share !== undefined && { share }),
    notInReport: false,
    title: headerTitle(report, path),
  };
}

export interface DetailRow {
  key: string;
  label: string;
  total: string;
  /** An em dash when the report gives no self figure. */
  self: string;
  ofDesign: string;
  /** An em dash when the device capacity is unknown. */
  ofDevice: string;
  /** The total in the compared report; present only with one. An em dash when it has none for the block. */
  compared?: string;
  /** Selected minus compared, with a sign; present only with a compared report. */
  change?: string;
}

/** `+12`, `-3`, `0`: a difference that rounds to zero has no sign. */
export function formatChange(difference: number): string {
  const text = formatCount(difference);
  return difference > 0 && text !== '0' ? `+${text}` : text;
}

/** The index in the compared report of the metric with this key, or undefined when it has none. */
export function comparedIndex(compare: ResourceReport, key: string): number | undefined {
  const index = compare.metrics.findIndex((metric) => metric.key === key);
  return index < 0 ? undefined : index;
}

/** The compared report's total of a metric for a usage, matched by the metric's key. */
export function comparedTotal(
  compare: ResourceReport,
  usage: ResourceUsage | undefined,
  key: string
): number | undefined {
  const index = comparedIndex(compare, key);
  return index === undefined ? undefined : usage?.total[index];
}

/**
 * Every metric of the report for one block, as texts. Empty when the block has no usage. With a
 * compared report each row also has the compared total and the change.
 */
export function detailRows(
  report: ResourceReport,
  path: string,
  compare?: ResourceReport
): DetailRow[] {
  const usage = report.instances[path];
  if (!usage) {
    return [];
  }
  return report.metrics.map((metric, index) => {
    const self = usage.self?.[index];
    const other = compare && comparedTotal(compare, compare.instances[path], metric.key);
    return {
      key: metric.key,
      label: metric.label,
      total: formatCount(usage.total[index]),
      self: self === null || self === undefined ? NO_VALUE : formatCount(self),
      ofDesign: formatShare(fractionOf(usage.total[index], report.design.total[index])),
      ofDevice: formatShare(deviceShare(report, usage, index)),
      ...(compare && {
        compared: other === undefined ? NO_VALUE : formatCount(other),
        change: other === undefined ? NO_VALUE : formatChange(usage.total[index] - other),
      }),
    };
  });
}

/** `Post-route · 841 LUTs · 1.3 %`: the stage, the design total of the first primary metric, its share of the device. */
export function toolbarChip(resources: DiagramResources | undefined): string {
  const report = resources?.report;
  const first = report && indexesOfPrimary(report)[0];
  if (!report || first === undefined) {
    return 'No report';
  }
  const total = report.design.total[first];
  const metric = report.metrics[first];
  const device = deviceShare(report, report.design, first);
  return [
    stageLabel(report.stage),
    `${report.design.summed ? 'Σ ' : ''}${formatCount(total)} ${metric.label}`,
    ...(device === undefined ? [] : [formatPercent(device)]),
  ].join(' · ');
}
