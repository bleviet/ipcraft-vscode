import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { readVivadoFlatRow } from './resources/vivadoFlatTable';
import { quartusOutputFilesDir } from './toolchains/buildPaths';

const logger = new Logger('ReportParser');

export interface TimingResult {
  wns?: number;
  whs?: number;
  tnsFailingEndpoints?: number;
  thsFailingEndpoints?: number;
  fmax?: number;
  met: boolean;
}

export interface ResourceRow {
  used: number;
  total: number;
  pct: number;
}

export interface UtilizationResult {
  lut?: ResourceRow;
  ff?: ResourceRow;
  bram?: ResourceRow;
  dsp?: ResourceRow;
}

export interface CdcResult {
  violations: number;
}

export interface BuildReports {
  vendor: 'vivado' | 'quartus';
  mode: 'ooc' | 'xpr' | 'compile';
  timing?: TimingResult;
  utilization?: UtilizationResult;
  cdc?: CdcResult;
  reportDir: string;
}

export async function parseVivadoReports(
  reportDir: string,
  mode: 'ooc' | 'xpr'
): Promise<BuildReports> {
  const result: BuildReports = { vendor: 'vivado', mode, reportDir };

  try {
    const text = await fs.readFile(path.join(reportDir, 'timing.rpt'), 'utf8');
    result.timing = parseVivadoTiming(text);
  } catch (err) {
    logger.debug(
      `timing.rpt not found or unreadable in ${reportDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const text = await fs.readFile(path.join(reportDir, 'utilization.rpt'), 'utf8');
    result.utilization = parseVivadoUtilization(text);
  } catch (err) {
    logger.debug(
      `utilization.rpt not found or unreadable in ${reportDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const text = await fs.readFile(path.join(reportDir, 'cdc.rpt'), 'utf8');
    result.cdc = parseVivadoCdc(text);
  } catch (err) {
    logger.debug(
      `cdc.rpt not found or unreadable in ${reportDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

export async function parseQuartusReports(
  buildDir: string,
  projectName: string
): Promise<BuildReports> {
  const outputDir = quartusOutputFilesDir(buildDir);
  const result: BuildReports = { vendor: 'quartus', mode: 'compile', reportDir: outputDir };

  try {
    const text = await fs.readFile(path.join(outputDir, `${projectName}.sta.summary`), 'utf8');
    let staRpt: string | undefined;
    try {
      staRpt = await fs.readFile(path.join(outputDir, `${projectName}.sta.rpt`), 'utf8');
    } catch (err) {
      logger.debug(
        `${projectName}.sta.rpt not found or unreadable in ${outputDir}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    result.timing = parseQuartusTiming(text, staRpt);
  } catch (err) {
    logger.debug(
      `${projectName}.sta.summary not found or unreadable in ${outputDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  try {
    const text = await fs.readFile(path.join(outputDir, `${projectName}.fit.summary`), 'utf8');
    result.utilization = parseQuartusUtilization(text);
  } catch (err) {
    logger.debug(
      `${projectName}.fit.summary not found or unreadable in ${outputDir}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Vivado parsers
// ---------------------------------------------------------------------------

function parseVivadoTiming(content: string): TimingResult {
  // Timing summary table data row:
  // | WNS(ns) | TNS(ns) | TNS Failing Endpoints | WHS(ns) | THS(ns) | THS Failing Endpoints |
  // |   1.234 |   0.000 |                     0 |   0.456 |   0.000 |                     0 |
  const row = content.match(
    /\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(\d+)\s*\|\s*(-?[\d.]+)\s*\|\s*(-?[\d.]+)\s*\|\s*(\d+)\s*\|/
  );
  if (row) {
    const wns = parseFloat(row[1]);
    const tnsFailingEndpoints = parseInt(row[3], 10);
    const whs = parseFloat(row[4]);
    const thsFailingEndpoints = parseInt(row[6], 10);
    return {
      wns,
      whs,
      tnsFailingEndpoints,
      thsFailingEndpoints,
      met: wns >= 0 && tnsFailingEndpoints === 0 && whs >= 0 && thsFailingEndpoints === 0,
    };
  }
  return { met: true };
}

function parseVivadoUtilization(content: string): UtilizationResult {
  const parseRow = (labels: string[]): ResourceRow | undefined => {
    const row = readVivadoFlatRow(content, labels);
    if (!row) {
      return undefined;
    }
    const total = row.available ?? 0;
    return {
      used: row.used,
      total,
      pct: row.utilPct ?? (total > 0 ? (row.used / total) * 100 : 0),
    };
  };

  return {
    lut: parseRow(['Slice LUTs', 'Slice LUT', 'LUT as Logic']),
    ff: parseRow(['Slice Registers', 'Register as Flip Flop']),
    bram: parseRow(['Block RAM Tile']),
    dsp: parseRow(['DSPs', 'DSP']),
  };
}

function parseVivadoCdc(content: string): CdcResult {
  const m = content.match(/(\d+)\s+(?:CDC\s+)?violation/i);
  return { violations: m ? parseInt(m[1], 10) : 0 };
}

// ---------------------------------------------------------------------------
// Quartus parsers
// ---------------------------------------------------------------------------

function parseQuartusTiming(summary: string, staRpt?: string): TimingResult {
  // Blocks in <name>.sta.summary:
  //   Type  : Slow 1100mV 100C Model Setup 'clk'
  //   Slack : 17.263
  //   TNS   : 0.000
  // Every Slack line counts toward `met`; the Type line only sorts Setup and Hold slacks.
  let hasSlack = false;
  let met = true;
  for (const m of summary.matchAll(/^Slack\s*:\s*(-?[\d.]+)/gm)) {
    hasSlack = true;
    if (parseFloat(m[1]) < 0) {
      met = false;
    }
  }

  if (!hasSlack) {
    return { met: true };
  }

  const blockRe = /^Type\s*:\s*.*?Model\s+(.+?)\s+'[^']*'\s*\r?\nSlack\s*:\s*(-?[\d.]+)/gm;
  let wns: number | undefined;
  let whs: number | undefined;
  for (const m of summary.matchAll(blockRe)) {
    const slack = parseFloat(m[2]);
    if (m[1] === 'Setup') {
      wns = wns === undefined ? slack : Math.min(wns, slack);
    } else if (m[1] === 'Hold') {
      whs = whs === undefined ? slack : Math.min(whs, slack);
    }
  }

  const result: TimingResult = { met };
  if (wns !== undefined) {
    result.wns = wns;
  }
  if (whs !== undefined) {
    result.whs = whs;
  }

  const fmax = staRpt === undefined ? undefined : parseQuartusFmax(staRpt);
  if (fmax !== undefined) {
    result.fmax = fmax;
  }
  return result;
}

/** Minimum Restricted Fmax over every row of every "Fmax Summary" panel in <name>.sta.rpt. */
function parseQuartusFmax(staRpt: string): number | undefined {
  // ; 365.36 MHz ; 365.36 MHz      ; clk        ;      ;
  const rowRe = /^;\s*[\d.]+ MHz\s*;\s*([\d.]+) MHz\s*;/gm;
  let fmax: number | undefined;
  for (const panel of staRpt.split(/^(?=\+-+\+\r?\n; .*Fmax Summary)/m)) {
    if (!/^; .*Fmax Summary/m.test(panel)) {
      continue;
    }
    for (const m of panel.matchAll(rowRe)) {
      const v = parseFloat(m[1]);
      fmax = fmax === undefined ? v : Math.min(fmax, v);
    }
  }
  return fmax;
}

function parseQuartusUtilization(content: string): UtilizationResult {
  const result: UtilizationResult = {};

  const toInt = (s: string): number => parseInt(s.replace(/,/g, ''), 10);
  const parseRatio = (key: string): ResourceRow | undefined => {
    // Logic utilization (in ALMs) : 61 / 41,910 ( < 1 % )
    const m = content.match(new RegExp(`^${key}\\s*:\\s*([\\d,]+)\\s*/\\s*([\\d,]+)`, 'm'));
    if (!m) {
      return undefined;
    }
    const used = toInt(m[1]);
    const total = toInt(m[2]);
    return { used, total, pct: total > 0 ? (used / total) * 100 : 0 };
  };

  result.lut = parseRatio('Logic utilization \\(in ALMs\\)');

  const regM = content.match(/^Total registers\s*:\s*([\d,]+)/m);
  if (regM) {
    result.ff = { used: toInt(regM[1]), total: 0, pct: 0 };
  }

  result.bram = parseRatio('Total block memory bits');
  result.dsp = parseRatio('Total DSP Blocks');

  return result;
}
