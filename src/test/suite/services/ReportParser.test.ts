import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { parseVivadoReports, parseQuartusReports } from '../../../services/ReportParser';

describe('ReportParser', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-report-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('parseVivadoReports', () => {
    it('parses timing report with WNS/WHS and failing endpoints', async () => {
      const timingRpt = `
Design Timing Summary
=====================
| WNS(ns) | TNS(ns) | TNS Failing Endpoints | WHS(ns) | THS(ns) | THS Failing Endpoints |
|---------|---------|-----------------------|---------|---------|-----------------------|
|   1.234 |   0.000 |                     0 |   0.456 |   0.000 |                     0 |
`;
      await fs.writeFile(path.join(tempDir, 'timing.rpt'), timingRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.vendor).toBe('vivado');
      expect(result.mode).toBe('ooc');
      expect(result.timing).toBeDefined();
      expect(result.timing!.wns).toBe(1.234);
      expect(result.timing!.whs).toBe(0.456);
      expect(result.timing!.tnsFailingEndpoints).toBe(0);
      expect(result.timing!.thsFailingEndpoints).toBe(0);
      expect(result.timing!.met).toBe(true);
    });

    it('reports timing not met when WNS is negative', async () => {
      const timingRpt = `
| WNS(ns) | TNS(ns) | TNS Failing Endpoints | WHS(ns) | THS(ns) | THS Failing Endpoints |
|---------|---------|-----------------------|---------|---------|-----------------------|
|  -0.500 |  -1.200 |                     3 |   0.100 |   0.000 |                     0 |
`;
      await fs.writeFile(path.join(tempDir, 'timing.rpt'), timingRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.timing!.wns).toBe(-0.5);
      expect(result.timing!.tnsFailingEndpoints).toBe(3);
      expect(result.timing!.met).toBe(false);
    });

    it('reports timing not met when there are THS failing endpoints', async () => {
      const timingRpt = `
| WNS(ns) | TNS(ns) | TNS Failing Endpoints | WHS(ns) | THS(ns) | THS Failing Endpoints |
|---------|---------|-----------------------|---------|---------|-----------------------|
|   0.500 |   0.000 |                     0 |  -0.100 |  -0.300 |                     2 |
`;
      await fs.writeFile(path.join(tempDir, 'timing.rpt'), timingRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'xpr');

      expect(result.timing!.whs).toBe(-0.1);
      expect(result.timing!.thsFailingEndpoints).toBe(2);
      expect(result.timing!.met).toBe(false);
    });

    it('returns met=true when timing report is absent', async () => {
      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.timing).toBeUndefined();
      expect(result.mode).toBe('ooc');
    });

    it('parses utilization report with LUT, FF, BRAM, DSP', async () => {
      const utilRpt = `
| Site Type        | Used | Fixed | Available | Proh | Util% |
|------------------|------|-------|-----------|------|-------|
| Slice LUTs*      |  456 |     0 |    53200  |    0 |  0.86 |
| Slice Registers  |  289 |     0 |   106400  |    0 |  0.27 |
| Block RAM Tile   |    2 |     0 |      140  |    0 |  1.43 |
| DSPs             |    4 |     0 |      220  |    0 |  1.82 |
`;
      await fs.writeFile(path.join(tempDir, 'utilization.rpt'), utilRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.utilization).toBeDefined();
      expect(result.utilization!.lut).toMatchObject({ used: 456, total: 53200, pct: 0.86 });
      expect(result.utilization!.ff).toMatchObject({ used: 289, total: 106400, pct: 0.27 });
      expect(result.utilization!.bram).toMatchObject({ used: 2, total: 140, pct: 1.43 });
      expect(result.utilization!.dsp).toMatchObject({ used: 4, total: 220, pct: 1.82 });
    });

    it('parses utilization with comma-separated large numbers', async () => {
      const utilRpt = `
| Site Type       | Used   | Fixed | Available | Proh | Util% |
|-----------------|--------|-------|-----------|------|-------|
| Slice LUTs*     | 12,345 |     0 |   234,560 |    0 |  5.26 |
| Slice Registers |  8,901 |     0 |   469,120 |    0 |  1.90 |
`;
      await fs.writeFile(path.join(tempDir, 'utilization.rpt'), utilRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.utilization!.lut).toMatchObject({ used: 12345, total: 234560, pct: 5.26 });
      expect(result.utilization!.ff).toMatchObject({ used: 8901, total: 469120, pct: 1.9 });
    });

    it('returns undefined for missing utilization categories', async () => {
      const utilRpt = `
| Site Type       | Used | Fixed | Proh | Available | Fixed | Util% |
|-----------------|------|-------|------|-----------|-------|-------|
| Slice LUTs*     |  100 |     0 |    0 |    53200  |     0 |  0.19 |
`;
      await fs.writeFile(path.join(tempDir, 'utilization.rpt'), utilRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.utilization!.lut).toBeDefined();
      expect(result.utilization!.ff).toBeUndefined();
      expect(result.utilization!.bram).toBeUndefined();
      expect(result.utilization!.dsp).toBeUndefined();
    });

    it('parses CDC report with violations', async () => {
      const cdcRpt = `
CDC Report Summary
==================
  5 CDC violations found
`;
      await fs.writeFile(path.join(tempDir, 'cdc.rpt'), cdcRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.cdc).toBeDefined();
      expect(result.cdc!.violations).toBe(5);
    });

    it('parses CDC report with zero violations', async () => {
      const cdcRpt = `
CDC Report Summary
==================
  0 CDC violations found
`;
      await fs.writeFile(path.join(tempDir, 'cdc.rpt'), cdcRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.cdc!.violations).toBe(0);
    });

    it('returns 0 violations when CDC report has no match', async () => {
      await fs.writeFile(path.join(tempDir, 'cdc.rpt'), 'no data here', 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.cdc!.violations).toBe(0);
    });

    it('parses all three reports together', async () => {
      await fs.writeFile(
        path.join(tempDir, 'timing.rpt'),
        `| WNS(ns) | TNS(ns) | TNS Failing Endpoints | WHS(ns) | THS(ns) | THS Failing Endpoints |
|   2.000 |   0.000 |                     0 |   0.500 |   0.000 |                     0 |`,
        'utf8'
      );
      await fs.writeFile(
        path.join(tempDir, 'utilization.rpt'),
        `| Slice LUTs* | 100 | 0 | 0 | 53200 | 0 | 0.19 |`,
        'utf8'
      );
      await fs.writeFile(path.join(tempDir, 'cdc.rpt'), '3 CDC violations found', 'utf8');

      const result = await parseVivadoReports(tempDir, 'xpr');

      expect(result.timing!.met).toBe(true);
      expect(result.utilization!.lut!.used).toBe(100);
      expect(result.cdc!.violations).toBe(3);
      expect(result.reportDir).toBe(tempDir);
    });
  });

  describe('parseQuartusReports', () => {
    const projectName = 'my_design';
    let outputDir: string;

    beforeEach(async () => {
      outputDir = path.join(tempDir, 'output_files');
      await fs.mkdir(outputDir, { recursive: true });
    });

    it('parses timing summary with fmax', async () => {
      const staSummary = `
; Fitter Resource Usage Summary
; Layer    ; 156.25 ; 156.25 MHz ; clk ;
; Total    ; 156.25 ; 156.25 MHz ; clk ;
`;
      await fs.writeFile(path.join(outputDir, `${projectName}.sta.summary`), staSummary, 'utf8');

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.vendor).toBe('quartus');
      expect(result.mode).toBe('compile');
      expect(result.timing).toBeDefined();
      expect(result.timing!.fmax).toBe(156.25);
      expect(result.timing!.met).toBe(true);
    });

    it('reports timing not met when requirements fail', async () => {
      const staSummary = `
Timing requirements not met
; some other data ;
`;
      await fs.writeFile(path.join(outputDir, `${projectName}.sta.summary`), staSummary, 'utf8');

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing!.met).toBe(false);
    });

    it('parses utilization from fit summary', async () => {
      const fitSummary = `
; Fitter Resource Usage Summary
; Logic utilization (in LUTs) ; 1,234 / 41,910 ( 3 % ) ;
; Total registers ; 2,891 ;
; Total block memory bits ; 16,384 / 5,662,720 ( < 1 % ) ;
; Total DSP Blocks ; 4 / 112 ( 4 % ) ;
`;
      await fs.writeFile(path.join(outputDir, `${projectName}.fit.summary`), fitSummary, 'utf8');

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.utilization).toBeDefined();
      expect(result.utilization!.lut).toMatchObject({ used: 1234, total: 41910, pct: 3 });
      expect(result.utilization!.ff).toMatchObject({ used: 2891 });
      expect(result.utilization!.bram).toMatchObject({ used: 16384, total: 5662720 });
      expect(result.utilization!.dsp).toMatchObject({ used: 4, total: 112, pct: 4 });
    });

    it('handles missing report files gracefully', async () => {
      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing).toBeUndefined();
      expect(result.utilization).toBeUndefined();
      expect(result.vendor).toBe('quartus');
    });

    it('handles partial reports (only timing, no utilization)', async () => {
      await fs.writeFile(
        path.join(outputDir, `${projectName}.sta.summary`),
        '; 200.00 ; 200.00 MHz ; sys_clk ;',
        'utf8'
      );

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing!.fmax).toBe(200);
      expect(result.timing!.met).toBe(true);
      expect(result.utilization).toBeUndefined();
    });
  });
});
