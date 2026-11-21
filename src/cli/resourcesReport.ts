/** The Markdown report of `ipcraft resources`: the usage per block and level. Pure; the output is stable for golden tests. */

import type { ResourceMetric, ResourceReport } from '../domain/resourceUsage';
import type { SystemGraph } from '../domain/systemGraph';
import {
  NO_VALUE,
  SUMMED_NOTE,
  formatPercent,
  notInReportNote,
  primaryMetrics,
  stageLabel,
} from '../webview/systemDiagram/resources/resourceView';
import {
  resourceRows,
  sortRows,
  type ResourceRow,
} from '../webview/systemDiagram/resources/resourceRows';

/** A figure in full (a report is read by tools and in reviews): whole numbers, a fraction (Quartus ALMs, BRAM halves) with one decimal. */
const figure = (value: number): string => String(Number(value.toFixed(1)));

const cell = (text: string): string => text.replace(/\|/g, '\\|');

/** `841 LUTs (1.6 % of the device) · 1203 FFs`: the four primary metrics of `values`. */
function metricsLine(
  metrics: ResourceMetric[],
  values: number[],
  summed: boolean,
  withDevice: boolean
): string {
  return metrics
    .map((metric, i) => {
      const share =
        withDevice && !summed && metric.capacity
          ? ` (${formatPercent(values[i] / metric.capacity)} of the device)`
          : '';
      return `${summed ? 'Σ ' : ''}${figure(values[i])} ${metric.label}${share}`;
    })
    .join(' · ');
}

function table(label: string, metrics: ResourceMetric[], rows: ResourceRow[]): string[] {
  return [
    `| ${[label, ...metrics.map((m) => m.label), '% of design'].join(' | ')} |`,
    `| --- | ${[...metrics.map(() => '---:'), '---:'].join(' | ')} |`,
    ...sortRows(rows, 0, 'desc').map(
      (row) =>
        `| \`${cell(row.name)}\` | ${[...row.values.map(figure), row.share === undefined ? NO_VALUE : formatPercent(row.share)].join(' | ')} |`
    ),
    '',
  ];
}

export function resourcesToMarkdown(report: ResourceReport, graph: SystemGraph): string {
  const metrics = primaryMetrics(report);
  const rows = resourceRows(report, graph);
  const design = rows.find((row) => row.kind === 'design');
  // A design the report does not hold has no figures, which is not the same as zeros.
  const designMissing = report.stage !== 'ooc' && report.root === undefined;
  const { source } = report;
  const lines = [
    `# Resource usage of ${graph.name}: ${stageLabel(report.stage)}${source.date ? `, ${source.date}` : ''}`,
    '',
    [
      `Report \`${source.fileName}\``,
      ...(source.toolVersion ? [source.toolVersion] : []),
      ...(source.device ? [`device ${source.device}`] : []),
    ].join(' · '),
    '',
    design && !designMissing
      ? `**Design:** ${metricsLine(metrics, design.values, design.summed, true)}`
      : '**Design:** no figures',
    '',
  ];
  if (design?.summed) {
    lines.push(`${SUMMED_NOTE}.`, '');
  }
  for (const level of Object.keys(graph.levels)) {
    const blocks = rows.filter((row) => row.kind === 'block' && row.level === level);
    const others = rows.filter((row) => row.kind === 'other' && row.level === level);
    if (blocks.length === 0 && others.length === 0) {
      continue;
    }
    lines.push(`### Level ${level}`, '');
    if (blocks.length > 0) {
      lines.push(...table('Block', metrics, blocks));
    }
    if (others.length > 0) {
      lines.push('Not a block of the diagram', '', ...table('Row', metrics, others));
    }
  }
  const outside = rows.find((row) => row.kind === 'outside');
  if (outside) {
    lines.push(
      '### Outside the design',
      '',
      metricsLine(metrics, outside.values, false, false),
      ''
    );
  }
  if (report.notInReport.length > 0) {
    const ooc = report.stage === 'ooc';
    lines.push(
      ooc ? '### No block report' : '### Not in the report',
      '',
      ...(ooc ? [`${notInReportNote(report)}`, ''] : []),
      ...report.notInReport.map((path) => `- \`${path}\``),
      ''
    );
  }
  if (report.diagnostics.length > 0) {
    lines.push(
      '### Notes',
      '',
      ...report.diagnostics.map((d) => `- ${d.severity}: ${d.message}`),
      ''
    );
  }
  return `${lines.join('\n').trimEnd()}\n`;
}
