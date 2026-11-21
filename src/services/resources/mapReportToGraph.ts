/**
 * Maps report numbers onto the blocks of a {@link SystemGraph} (the identity
 * rules of docs/concepts/brainstorm/system-resource-usage.md). Pure: parsed
 * tables and report text in, a JSON-serializable {@link ResourceReport} out.
 */

import type {
  ResourceReport,
  ResourceStage,
  ResourceUsage,
  ResourceVendor,
} from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import { rootMissingMessage } from './blockBuild';
import { findCandidates } from './designRows';
import type { ParsedTable, ReportNode } from './reportTree';
import { readBuildUsages, type BuildReportInput } from './ipBuildUsage';
import { buildMetricLayout, type CapacityTable, type MetricLayout } from './resourceMetrics';

export interface HierarchyReportInput {
  table: ParsedTable;
  vendor: ResourceVendor;
  stage: ResourceStage;
  source: ResourceReport['source'];
  capacity?: CapacityTable;
}

const joinPath = (level: string, name: string): string =>
  level === '/' ? `/${name}` : `${level}/${name}`;

const round = (value: number): number => Math.round(value * 1e6) / 1e6;

export function mapHierarchyReport(
  input: HierarchyReportInput,
  graph: SystemGraph,
  chosenRoot?: string
): ResourceReport {
  const { table, vendor, stage, source } = input;
  const layout: MetricLayout = buildMetricLayout(vendor, stage, table.columns, input.capacity);
  const usageOf = (node: ReportNode): ResourceUsage => ({
    total: layout.project(node.total),
    ...(node.self && { self: layout.projectSelf(node.self) }),
  });

  const candidates = findCandidates(table, vendor, graph.name);
  const report: ResourceReport = {
    vendor,
    stage,
    source,
    metrics: layout.metrics,
    design: { total: layout.metrics.map(() => 0) },
    instances: {},
    others: [],
    notInReport: [],
    rootCandidates: candidates.map((c) => c.path),
    diagnostics: [],
  };
  const root = candidates.find((c) => c.path === chosenRoot) ?? candidates[0];
  if (!root) {
    report.diagnostics.push({
      severity: 'warning',
      message: rootMissingMessage(graph.name, table.root.name),
    });
    return report;
  }
  report.root = root.path;
  report.design = usageOf(root.node);

  const walk = (node: ReportNode, level: string): void => {
    for (const child of node.children) {
      const path = joinPath(level, child.name);
      const instance = graph.instances[path];
      if (!instance) {
        report.others.push({
          level,
          name: child.name,
          ...(child.module !== undefined && { module: child.module }),
          usage: usageOf(child),
        });
        continue;
      }
      report.instances[path] = usageOf(child);
      if (instance.xciName !== undefined && child.module !== instance.xciName) {
        report.diagnostics.push({
          severity: 'warning',
          message: `${path}: the design file names this IP ${instance.xciName}, but the report lists module ${child.module ?? '(none)'}`,
        });
      }
      if (graph.levels[path]) {
        walk(child, path);
      }
    }
  };
  walk(root.node, '/');

  report.notInReport = Object.keys(graph.instances).filter((path) => !report.instances[path]);
  if (root.node !== table.root) {
    const outside = layout
      .project(table.root.total)
      .map((total, i) => round(total - report.design.total[i]));
    if (outside.some((value) => value !== 0)) {
      report.outside = outside;
    }
  }
  return report;
}

/**
 * Sum of per-block build reports: the out-of-context report of each IP (found by `xciName`) or
 * the report of a given instance; hierarchy totals are sums, not measured figures.
 */
export function mapOocReports(
  reports: BuildReportInput[],
  graph: SystemGraph,
  source: ResourceReport['source']
): ResourceReport {
  const { vendor, metrics, used } = readBuildUsages(reports);
  const zero = (): number[] => metrics.map(() => 0);
  const sum = (usages: ResourceUsage[]): number[] =>
    usages.reduce((acc, { total }) => acc.map((value, i) => value + total[i]), zero());

  const instances: Record<string, ResourceUsage> = {};
  reports.forEach(({ instance }, i) => {
    if (instance !== undefined && graph.instances[instance]) {
      instances[instance] = { total: used[i] };
    }
  });
  for (const instance of Object.values(graph.instances)) {
    const found = reports.findIndex(
      (report) => report.instance === undefined && report.design === instance.xciName
    );
    if (found >= 0 && !instances[instance.path]) {
      instances[instance.path] = { total: used[found] };
    }
  }
  const ips = Object.keys(instances);
  for (const level of Object.keys(graph.levels).filter((path) => path !== '/')) {
    const inside = ips.filter((path) => path.startsWith(`${level}/`));
    if (inside.length > 0) {
      instances[level] = { total: sum(inside.map((path) => instances[path])), summed: true };
    }
  }

  return {
    vendor,
    stage: 'ooc',
    source,
    metrics,
    design: { total: sum(ips.map((path) => instances[path])), summed: true },
    instances,
    others: [],
    notInReport: Object.keys(graph.instances).filter((path) => !instances[path]),
    rootCandidates: [],
    diagnostics: [],
  };
}
