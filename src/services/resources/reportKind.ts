/**
 * Recognizes a resource report from its text alone (a downloaded file may have
 * any name): vendor, stage, whether it is hierarchical, and the header data worth
 * showing. Anything unusable comes back as a refusal with a one-sentence message
 * for the user. The Host and Command header lines hold private paths and are
 * never returned.
 */

import type { ResourceStage, ResourceVendor } from '../../domain/resourceUsage';

export type ReportKind = 'vivado-hierarchical' | 'vivado-flat' | 'quartus-entity';

export interface RecognizedReport {
  recognized: true;
  kind: ReportKind;
  vendor: ResourceVendor;
  stage: ResourceStage;
  toolVersion?: string;
  /** As written in the report. */
  date?: string;
  design?: string;
  device?: string;
  /** Quartus: the revision name. */
  revision?: string;
}

export type RefusalReason = 'not-utilization' | 'no-entity-table' | 'summary-only' | 'unknown';

export interface RefusedReport {
  recognized: false;
  reason: RefusalReason;
  message: string;
}

const refuse = (reason: RefusalReason, message: string): RefusedReport => ({
  recognized: false,
  reason,
  message,
});

/** `| Key : value` lines of the header block, which ends at the first blank line. */
function readVivadoHeader(lines: string[]): Map<string, string> | undefined {
  const header = new Map<string, string>();
  for (const line of lines) {
    if (line.trim() === '') {
      if (header.size > 0) {
        break;
      }
      continue;
    }
    const m = /^\|\s*([A-Za-z][A-Za-z ]*?)\s*:\s*(.*?)\s*$/.exec(line);
    if (m) {
      header.set(m[1], m[2]);
    }
  }
  return header.has('Tool Version') && header.has('Command') ? header : undefined;
}

function recognizeVivado(header: Map<string, string>): RecognizedReport | RefusedReport {
  const command = header.get('Command') ?? '';
  const commandName = command.split(/\s+/)[0];
  if (commandName !== 'report_utilization') {
    return refuse(
      'not-utilization',
      `This is the output of ${commandName || 'another command'}, not a utilization report.`
    );
  }
  const state = header.get('Design State') ?? '';
  const stage: ResourceStage | undefined = /Synthesized/.test(state)
    ? 'synth'
    : /Placed/.test(state)
      ? 'placed'
      : /Routed/.test(state)
        ? 'routed'
        : undefined;
  if (!stage) {
    return refuse(
      'unknown',
      `The design state "${state}" of this utilization report is not one of Synthesized, Placed or Routed.`
    );
  }
  return {
    recognized: true,
    kind: /\s-hierarchical\b/.test(command) ? 'vivado-hierarchical' : 'vivado-flat',
    vendor: 'vivado',
    stage,
    toolVersion: header.get('Tool Version'),
    date: header.get('Date'),
    design: header.get('Design'),
    device: header.get('Device'),
  };
}

function recognizeQuartus(lines: string[], firstLine: string): RecognizedReport | RefusedReport {
  const m = /^(Fitter|Analysis & Synthesis|Timing Analyzer) report for (.+?)\s*$/.exec(firstLine);
  if (!m) {
    return refuse('unknown', 'This file is not a Vivado or Quartus utilization report.');
  }
  if (m[1] === 'Timing Analyzer') {
    return refuse('not-utilization', 'This is a Timing Analyzer report, not a utilization report.');
  }
  const fitter = m[1] === 'Fitter';
  const tableTitle = fitter
    ? 'Fitter Resource Utilization by Entity'
    : 'Analysis & Synthesis Resource Utilization by Entity';
  if (!lines.some((line) => line.startsWith(';') && line.includes(tableTitle))) {
    return refuse(
      'no-entity-table',
      `This ${m[1]} report has no "${tableTitle}" table, so it has no per-block numbers.`
    );
  }
  const nonEmpty = lines.filter((line) => line.trim() !== '');
  const version = nonEmpty
    .slice(0, 6)
    .map((line) => /^Quartus Prime Version (.+?)\s*$/.exec(line)?.[1])
    .find((value) => value !== undefined);
  return {
    recognized: true,
    kind: 'quartus-entity',
    vendor: 'quartus',
    stage: fitter ? 'fit' : 'synth',
    toolVersion: version,
    date: nonEmpty[1]?.trim() || undefined,
    revision: m[2],
  };
}

export function recognizeReport(text: string): RecognizedReport | RefusedReport {
  const lines = text.split(/\r?\n/);
  const firstLine = lines.find((line) => line.trim() !== '') ?? '';
  if (/^Fitter Status\s*:/.test(firstLine)) {
    return refuse(
      'summary-only',
      'This is the Fitter summary, which has no per-block numbers. Open the .fit.rpt file of the same compilation instead.'
    );
  }
  const vivado = readVivadoHeader(lines.slice(0, 40));
  if (vivado) {
    return recognizeVivado(vivado);
  }
  return recognizeQuartus(lines, firstLine.trim());
}
