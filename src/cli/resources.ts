import * as fs from 'fs/promises';
import * as path from 'path';
import { mapReportFiles, type ReportText } from '../services/resources/mapReportFiles';
import { readRequired } from '../services/render/renderResources';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import { resourcesToMarkdown } from './resourcesReport';

export interface CliResourcesArgs {
  /** A `.bd`, `write_bd_tcl` `.tcl`, `.qsys` or qsys-script `.tcl` file. */
  design: string;
  /** One hierarchical Vivado report, one Quartus `.map.rpt` / `.fit.rpt`, or several flat per-IP Vivado reports. */
  reports: string[];
  /** A flat Vivado report or a Quartus `.fit.summary` for the device percentages. */
  capacity?: string;
  /** The design instance in the report when it appears more than once. */
  root?: string;
  format: 'markdown' | 'json';
  /** Report file; default: standard output. */
  out?: string;
}

export interface CliResourcesResult {
  /** 0: ok; 1: the design is not in the report (the report is still produced); 2: a usage error or an unusable input. */
  exitCode: 0 | 1 | 2;
  error?: string;
  /** For stderr: the choice among several design roots, an unused option. */
  notes: string[];
  /** The report, when it is not written to `out`. */
  report?: string;
  outputPath?: string;
}

/** A report or capacity file read as text, under its base name (what the messages and the report's source call it); for `resources` and `render --resources`. */
export async function readReportText(file: string, what: string): Promise<ReportText> {
  const resolved = path.resolve(file);
  return {
    name: path.basename(resolved),
    text: (await readRequired(resolved, what)).toString('utf8'),
  };
}

/** Core logic behind `ipcraft resources`: maps report files onto a design and writes the usage per block as Markdown or JSON. */
export async function runCliResources(args: CliResourcesArgs): Promise<CliResourcesResult> {
  const result: CliResourcesResult = { exitCode: 2, notes: [] };
  try {
    const designPath = path.resolve(args.design);
    const designText = (await readRequired(designPath, 'Design file')).toString('utf8');
    const graph = readSystemDesign(designPath, path.basename(designPath), designText);
    if (!graph) {
      throw new Error(`'${args.design}' is not a recognized system design`);
    }
    const files = await Promise.all(
      args.reports.map((file) => readReportText(file, 'Report file'))
    );
    const capacity =
      args.capacity === undefined
        ? undefined
        : await readReportText(args.capacity, 'Capacity file');
    const { report, notes } = mapReportFiles(graph, files, { capacity, root: args.root });
    result.notes = notes;
    const text =
      args.format === 'json'
        ? `${JSON.stringify(report, null, 2)}\n`
        : resourcesToMarkdown(report, graph);
    if (args.out === undefined) {
      result.report = text;
    } else {
      result.outputPath = path.resolve(args.out);
      await fs.mkdir(path.dirname(result.outputPath), { recursive: true });
      await fs.writeFile(result.outputPath, text);
    }
    result.exitCode = report.stage !== 'ooc' && report.root === undefined ? 1 : 0;
    if (result.exitCode === 1) {
      result.error = `The design ${graph.name} is not in the report`;
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
