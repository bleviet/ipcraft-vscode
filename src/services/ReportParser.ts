import * as fs from 'fs/promises';
import * as path from 'path';

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
  } catch {
    /* not yet written */
  }

  try {
    const text = await fs.readFile(path.join(reportDir, 'utilization.rpt'), 'utf8');
    result.utilization = parseVivadoUtilization(text);
  } catch {
    /* not yet written */
  }

  try {
    const text = await fs.readFile(path.join(reportDir, 'cdc.rpt'), 'utf8');
    result.cdc = parseVivadoCdc(text);
  } catch {
    /* not yet written */
  }

  return result;
}

export async function parseQuartusReports(
  buildDir: string,
  projectName: string
): Promise<BuildReports> {
  const outputDir = path.join(buildDir, 'output_files');
  const result: BuildReports = { vendor: 'quartus', mode: 'compile', reportDir: outputDir };

  try {
    const text = await fs.readFile(path.join(outputDir, `${projectName}.sta.summary`), 'utf8');
    result.timing = parseQuartusTiming(text);
  } catch {
    /* not yet written */
  }

  try {
    const text = await fs.readFile(path.join(outputDir, `${projectName}.fit.summary`), 'utf8');
    result.utilization = parseQuartusUtilization(text);
  } catch {
    /* not yet written */
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
  const result: UtilizationResult = {};

  const parseRow = (pattern: RegExp): ResourceRow | undefined => {
    const m = content.match(pattern);
    if (!m) {
      return undefined;
    }
    return {
      used: parseInt(m[1].replace(/,/g, ''), 10),
      total: parseInt(m[2].replace(/,/g, ''), 10),
      pct: parseFloat(m[3]),
    };
  };

  result.lut = parseRow(
    /\|\s*(?:Slice LUTs?\*?|LUT as Logic)\s*\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d.]+)\s*\|/
  );
  result.ff = parseRow(
    /\|\s*(?:Slice Registers|Register as Flip Flop)\s*\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d.]+)\s*\|/
  );
  result.bram = parseRow(
    /\|\s*Block RAM Tile\s*\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d.]+)\s*\|/
  );
  result.dsp = parseRow(
    /\|\s*DSPs?\s*\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d,]+)\s*\|[^|]+\|\s*([\d.]+)\s*\|/
  );

  return result;
}

function parseVivadoCdc(content: string): CdcResult {
  const m = content.match(/(\d+)\s+(?:CDC\s+)?violation/i);
  return { violations: m ? parseInt(m[1], 10) : 0 };
}

// ---------------------------------------------------------------------------
// Quartus parsers
// ---------------------------------------------------------------------------

function parseQuartusTiming(content: string): TimingResult {
  if (/timing requirements not met/i.test(content)) {
    return { met: false };
  }

  // "; 156.25 ; 156.25 MHz ; clk ;"
  const fmaxMatch = content.match(/;\s*([\d.]+)\s*MHz\s*;/);
  if (fmaxMatch) {
    return { fmax: parseFloat(fmaxMatch[1]), met: true };
  }

  return { met: true };
}

function parseQuartusUtilization(content: string): UtilizationResult {
  const result: UtilizationResult = {};

  // ; Logic utilization (in LUTs) ; 1234 / 41910 ( 3 % ) ;
  const lutM = content.match(
    /Logic utilization.*?;\s*([\d,]+)\s*\/\s*([\d,]+)\s*\(\s*<?[\s]*([\d.]+)\s*%/i
  );
  if (lutM) {
    result.lut = {
      used: parseInt(lutM[1].replace(/,/g, ''), 10),
      total: parseInt(lutM[2].replace(/,/g, ''), 10),
      pct: parseFloat(lutM[3]) || 0,
    };
  }

  // ; Total registers ; 2891 ;
  const regM = content.match(/Total registers\s*;\s*([\d,]+)\s*;/i);
  if (regM) {
    result.ff = { used: parseInt(regM[1].replace(/,/g, ''), 10), total: 0, pct: 0 };
  }

  // ; Total block memory bits ; 16384 / 5662720 ( < 1 % ) ;
  const bramM = content.match(/Total block memory bits.*?;\s*([\d,]+)\s*\/\s*([\d,]+)/i);
  if (bramM) {
    const used = parseInt(bramM[1].replace(/,/g, ''), 10);
    const total = parseInt(bramM[2].replace(/,/g, ''), 10);
    result.bram = { used, total, pct: total > 0 ? Math.round((used / total) * 100) : 0 };
  }

  // ; Total DSP Blocks ; 0 / 112 ( 0 % ) ;
  const dspM = content.match(
    /Total DSP Blocks.*?;\s*([\d,]+)\s*\/\s*([\d,]+)\s*\(\s*<?[\s]*([\d.]+)\s*%/i
  );
  if (dspM) {
    result.dsp = {
      used: parseInt(dspM[1].replace(/,/g, ''), 10),
      total: parseInt(dspM[2].replace(/,/g, ''), 10),
      pct: parseFloat(dspM[3]) || 0,
    };
  }

  return result;
}
