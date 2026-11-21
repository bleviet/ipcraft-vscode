/** @jest-environment node */
// Runs `ipcraft resources` end to end on the report fixtures of the spike.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { main } from '../../../cli/index';
import { runCliResources, type CliResourcesArgs } from '../../../cli/resources';
import type { ResourceReport } from '../../../domain/resourceUsage';

const reports = path.resolve(__dirname, '../../fixtures/reports');
const VIVADO = path.join(reports, 'vivado/spike');
const QUARTUS = path.join(reports, 'quartus/platform_designer_system');
const golden = (name: string) => fs.readFileSync(path.join(reports, 'golden', name), 'utf8');
const ZYNQ = path.resolve(__dirname, '../../fixtures/system-design/zynq_dma_system.tcl');
const OOC = fs
  .readdirSync(path.join(VIVADO, 'ooc'))
  .sort()
  .map((file) => path.join(VIVADO, 'ooc', file));

const run = (extra: Partial<CliResourcesArgs> & Pick<CliResourcesArgs, 'design' | 'reports'>) =>
  runCliResources({ format: 'markdown', ...extra });

describe('runCliResources', () => {
  it('writes the Markdown of a hierarchical Vivado report with its capacity', async () => {
    const result = await run({
      design: path.join(VIVADO, 'sys.bd'),
      reports: [path.join(VIVADO, 'routed_hier.rpt')],
      capacity: path.join(VIVADO, 'routed_flat.rpt'),
    });
    expect(result).toMatchObject({ exitCode: 0, notes: [] });
    expect(result.report).toBe(golden('vivado-routed.md'));
  });

  it('writes the Markdown of a Quartus fitter report with its summary', async () => {
    const result = await run({
      design: path.join(QUARTUS, 'sys.qsys'),
      reports: [path.join(QUARTUS, 'spike.fit.rpt')],
      capacity: path.join(QUARTUS, 'spike.fit.summary'),
    });
    expect(result.exitCode).toBe(0);
    expect(result.report).toBe(golden('quartus-fit.md'));
  });

  it('writes the Markdown of the flat per-IP reports', async () => {
    const result = await run({ design: path.join(VIVADO, 'sys.bd'), reports: OOC });
    expect(result.exitCode).toBe(0);
    expect(result.report).toBe(golden('vivado-ooc.md'));
  });

  it('writes the ResourceReport as JSON', async () => {
    const result = await run({
      design: path.join(VIVADO, 'sys.bd'),
      reports: [path.join(VIVADO, 'routed_hier.rpt')],
      capacity: path.join(VIVADO, 'routed_flat.rpt'),
      format: 'json',
    });
    const report = JSON.parse(result.report as string) as ResourceReport;
    expect(result.report).toBe(`${JSON.stringify(report, null, 2)}\n`);
    expect(report).toMatchObject({
      vendor: 'vivado',
      stage: 'routed',
      root: 'sys_wrapper/sys_i',
      rootCandidates: ['sys_wrapper/sys_i'],
      source: { fileName: 'routed_hier.rpt', design: 'sys_wrapper' },
    });
    expect(report.metrics.map((m) => m.key).slice(0, 4)).toEqual(['lut', 'ff', 'bram', 'dsp']);
    expect(report.instances['/smartconnect_0'].total.slice(0, 4)).toEqual([422, 449, 0, 0]);
  });

  describe('files', () => {
    let tmp: string;
    beforeAll(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resources-'));
    });
    afterAll(() => {
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('writes --out instead of returning the report', async () => {
      const out = path.join(tmp, 'nested', 'usage.md');
      const result = await run({
        design: path.join(VIVADO, 'sys.bd'),
        reports: [path.join(VIVADO, 'routed_hier.rpt')],
        capacity: path.join(VIVADO, 'routed_flat.rpt'),
        out,
      });
      expect(result).toMatchObject({ exitCode: 0, outputPath: out });
      expect(result.report).toBeUndefined();
      expect(fs.readFileSync(out, 'utf8')).toBe(golden('vivado-routed.md'));
    });

    it('recognizes a report by its content, not by its name', async () => {
      const renamed = path.join(tmp, 'download (1).txt');
      fs.copyFileSync(path.join(VIVADO, 'routed_hier.rpt'), renamed);
      const result = await run({ design: path.join(VIVADO, 'sys.bd'), reports: [renamed] });
      expect(result.exitCode).toBe(0);
      expect(result.report).toContain('| `smartconnect_0` | 422 |');
    });
  });

  describe('exit codes', () => {
    const design = path.join(VIVADO, 'sys.bd');

    it('refuses a timing report with 2', async () => {
      const result = await run({
        design,
        reports: [path.join(VIVADO, 'sys_wrapper_timing_summary_routed.rpt')],
      });
      expect(result.exitCode).toBe(2);
      expect(result.error).toBe(
        'sys_wrapper_timing_summary_routed.rpt: This is the output of report_timing_summary, not a utilization report.'
      );
      expect(result.report).toBeUndefined();
    });

    it('refuses a flat report that is no IP of the design with 2', async () => {
      const result = await run({ design, reports: [path.join(VIVADO, 'routed_flat.rpt')] });
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('routed_flat.rpt: This report has only the design total');
    });

    it('refuses a hierarchical report mixed with per-IP reports with 2', async () => {
      const result = await run({
        design,
        reports: [path.join(VIVADO, 'routed_hier.rpt'), ...OOC],
      });
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('Cannot mix the hierarchical report routed_hier.rpt');
    });

    it('refuses two hierarchical reports with 2', async () => {
      const result = await run({
        design,
        reports: [path.join(VIVADO, 'routed_hier.rpt'), path.join(VIVADO, 'synth_hier.rpt')],
      });
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('Give one hierarchical report');
    });

    it('refuses a capacity file without capacity with 2', async () => {
      const result = await run({
        design,
        reports: [path.join(VIVADO, 'routed_hier.rpt')],
        capacity: path.join(VIVADO, 'sys_wrapper_timing_summary_routed.rpt'),
      });
      expect(result.exitCode).toBe(2);
      expect(result.error).toContain('no device capacity found');
    });

    it('refuses a missing file and a file that is no design with 2', async () => {
      const missing = await run({ design, reports: [path.join(VIVADO, 'gone.rpt')] });
      expect(missing).toMatchObject({ exitCode: 2 });
      expect(missing.error).toContain('Report file not found');
      const notDesign = await run({
        design: path.join(VIVADO, 'routed_hier.rpt'),
        reports: [path.join(VIVADO, 'routed_hier.rpt')],
      });
      expect(notDesign.exitCode).toBe(2);
      expect(notDesign.error).toContain('is not a recognized system design');
    });

    it('returns 1, with the report, for a report of another design', async () => {
      const result = await run({ design: ZYNQ, reports: [path.join(VIVADO, 'routed_hier.rpt')] });
      expect(result.exitCode).toBe(1);
      expect(result.error).toBe('The design zynq_dma_system is not in the report');
      expect(result.report).toContain('**Design:** no figures');
      expect(result.report).not.toContain('0 LUTs');
      expect(result.report).toContain(
        'This report is a build of sys_wrapper, not of the design zynq_dma_system'
      );
    });
  });
});

describe('the design root', () => {
  let tmp: string;
  let twice: string;

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-resources-root-'));
    // The design twice in the report: a copy of the sys_i row, without its children, after it.
    const lines = fs.readFileSync(path.join(VIVADO, 'routed_hier.rpt'), 'utf8').split('\n');
    const row = lines.findIndex((line) => /^\|\s+sys_i\s+\|/.test(line));
    const end = lines.findIndex((line, i) => i > row && line.startsWith('+--'));
    lines.splice(end, 0, lines[row].replace('sys_i', 'sys_j'));
    twice = path.join(tmp, 'twice.rpt');
    fs.writeFileSync(twice, lines.join('\n'));
  });
  afterAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const design = path.join(VIVADO, 'sys.bd');

  it('uses the first candidate and names the others in a note', async () => {
    const result = await run({ design, reports: [twice] });
    expect(result.exitCode).toBe(0);
    expect(result.notes).toEqual([
      'The design sys appears 2 times in the report; using sys_wrapper/sys_i. Other candidates: sys_wrapper/sys_j. Pass --root to choose.',
    ]);
    expect(result.report).toContain('| `smartconnect_0` | 422 |');
  });

  it('uses the --root that is a candidate, without a note', async () => {
    const result = await run({ design, reports: [twice], root: 'sys_wrapper/sys_j' });
    expect(result.notes).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.report).not.toContain('| `smartconnect_0` |');
    expect(result.report).toContain('### Not in the report');
  });

  it('refuses a --root that is not a candidate with 2, listing the candidates', async () => {
    const result = await run({ design, reports: [twice], root: 'sys_wrapper/nowhere' });
    expect(result.exitCode).toBe(2);
    expect(result.error).toBe(
      "--root 'sys_wrapper/nowhere' is not a candidate. Candidates: sys_wrapper/sys_i, sys_wrapper/sys_j"
    );
  });

  it('refuses a --root for a design that is not in the report with 2', async () => {
    const result = await run({ design: ZYNQ, reports: [twice], root: 'a' });
    expect(result.exitCode).toBe(2);
    expect(result.error).toContain('Candidates: none');
  });
});

describe('main resources', () => {
  let out: jest.SpyInstance;
  let err: jest.SpyInstance;
  let log: jest.SpyInstance;

  beforeEach(() => {
    out = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    out.mockRestore();
    log.mockRestore();
    // The global setup fails a test that leaves a console.error behind; each test asserts its own.
    err.mockClear();
  });

  it('prints the report on standard output and returns 0', async () => {
    const code = await main([
      'resources',
      path.join(VIVADO, 'sys.bd'),
      path.join(VIVADO, 'routed_hier.rpt'),
      '--capacity',
      path.join(VIVADO, 'routed_flat.rpt'),
    ]);
    expect(code).toBe(0);
    expect(out).toHaveBeenCalledWith(golden('vivado-routed.md'));
    expect(err).not.toHaveBeenCalled();
  });

  it('returns 2 with the message for an unusable report and for a usage error', async () => {
    expect(
      await main([
        'resources',
        path.join(VIVADO, 'sys.bd'),
        path.join(VIVADO, 'sys_wrapper_timing_summary_routed.rpt'),
      ])
    ).toBe(2);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('not a utilization report'));
    expect(await main(['resources', 'sys.bd'])).toBe(2);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ipcraft resources'));
  });

  it('returns 1 for a report of another design, after printing the report', async () => {
    expect(await main(['resources', ZYNQ, path.join(VIVADO, 'routed_hier.rpt')])).toBe(1);
    expect(out).toHaveBeenCalled();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('is not in the report'));
  });
});
