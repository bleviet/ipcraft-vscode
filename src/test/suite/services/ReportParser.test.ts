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

    it('reads the device totals of a real Vivado utilization report', async () => {
      await fs.copyFile(
        path.join(__dirname, '../../fixtures/reports/vivado/spike/routed_flat.rpt'),
        path.join(tempDir, 'utilization.rpt')
      );

      const result = await parseVivadoReports(tempDir, 'xpr');

      expect(result.utilization!.lut).toEqual({ used: 841, total: 63400, pct: 1.33 });
      expect(result.utilization!.ff).toMatchObject({ used: 1386, total: 126800 });
      expect(result.utilization!.bram).toMatchObject({ used: 2, total: 135 });
      expect(result.utilization!.dsp).toMatchObject({ used: 0, total: 240 });
    });

    it.each([
      ['zynqup_flat.rpt', 70560, 141120],
      ['kintexus_flat.rpt', 145440, 290880],
    ])(
      'reads the CLB LUTs and CLB Registers rows of UltraScale report %s',
      async (name, lut, ff) => {
        await fs.copyFile(
          path.join(__dirname, '../../fixtures/reports/vivado/ultrascale', name),
          path.join(tempDir, 'utilization.rpt')
        );

        const result = await parseVivadoReports(tempDir, 'xpr');

        expect(result.utilization!.lut).toMatchObject({ used: 8, total: lut });
        expect(result.utilization!.ff).toMatchObject({ used: 45, total: ff });
        expect(result.utilization!.bram).toMatchObject({ used: 0 });
      }
    );

    it('counts the total CLB LUTs and registers of UltraScale, not the sub-rows', async () => {
      const utilRpt = `
| Site Type               | Used | Fixed | Prohibited | Available | Util% |
|-------------------------|------|-------|------------|-----------|-------|
| CLB LUTs*               |   20 |     0 |          0 |     70560 |  0.03 |
|   LUT as Logic          |    8 |     0 |          0 |     70560 |  0.01 |
|   LUT as Memory         |   12 |     0 |          0 |     28800 |  0.04 |
| CLB Registers           |   50 |     0 |          0 |    141120 |  0.04 |
|   Register as Flip Flop |   45 |     0 |          0 |    141120 |  0.03 |
|   Register as Latch     |    5 |     0 |          0 |    141120 |  0.00 |
`;
      await fs.writeFile(path.join(tempDir, 'utilization.rpt'), utilRpt, 'utf8');

      const result = await parseVivadoReports(tempDir, 'ooc');

      expect(result.utilization!.lut).toMatchObject({ used: 20, total: 70560 });
      expect(result.utilization!.ff).toMatchObject({ used: 50, total: 141120 });
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

    const fixtureRoot = path.join(__dirname, '../../fixtures/reports/quartus');

    // Copies a real-tool fixture into output_files/, renaming <fixtureName>.* to <projectName>.*.
    async function installFixture(
      fixtureDir: string,
      fixtureName: string,
      extensions: string[]
    ): Promise<void> {
      for (const ext of extensions) {
        await fs.copyFile(
          path.join(fixtureRoot, fixtureDir, `${fixtureName}.${ext}`),
          path.join(outputDir, `${projectName}.${ext}`)
        );
      }
    }

    it('parses real timing and utilization reports of a design that meets timing', async () => {
      await installFixture('led_controller_avmm', 'led_controller_avmm', [
        'sta.summary',
        'sta.rpt',
        'fit.summary',
      ]);

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.vendor).toBe('quartus');
      expect(result.mode).toBe('compile');
      expect(result.reportDir).toBe(outputDir);
      expect(result.timing).toEqual({ met: true, wns: 16.997, whs: 0.121, fmax: 333.0 });

      const util = result.utilization!;
      expect(util.lut).toMatchObject({ used: 61, total: 41910 });
      expect(util.lut!.pct).toBeCloseTo(0.1455, 4);
      expect(util.ff).toEqual({ used: 45, total: 0, pct: 0 });
      expect(util.bram).toEqual({ used: 0, total: 5662720, pct: 0 });
      expect(util.dsp).toEqual({ used: 0, total: 112, pct: 0 });
    });

    it('reports timing not met for a real unconstrained design', async () => {
      await installFixture('unconstrained_system', 'spike', [
        'sta.summary',
        'sta.rpt',
        'fit.summary',
      ]);

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing).toEqual({ met: false, wns: -3.453, whs: 0.103, fmax: 224.57 });

      const util = result.utilization!;
      expect(util.lut).toMatchObject({ used: 121, total: 32070 });
      expect(util.ff).toEqual({ used: 246, total: 0, pct: 0 });
      expect(util.bram).toMatchObject({ used: 65536, total: 4065280 });
      expect(util.bram!.pct).toBeCloseTo(1.612, 3);
      expect(util.dsp).toEqual({ used: 0, total: 87, pct: 0 });
    });

    it('reports wns, whs and met but no fmax when sta.rpt is absent', async () => {
      await installFixture('unconstrained_system', 'spike', ['sta.summary']);

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing).toEqual({ met: false, wns: -3.453, whs: 0.103 });
      expect(result.timing!.fmax).toBeUndefined();
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
        [
          "Type  : Slow 1100mV 85C Model Setup 'sys_clk'",
          'Slack : 2.500',
          'TNS   : 0.000',
          '',
          "Type  : Slow 1100mV 85C Model Hold 'sys_clk'",
          'Slack : 0.300',
          'TNS   : 0.000',
          '',
        ].join('\n'),
        'utf8'
      );

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing).toEqual({ met: true, wns: 2.5, whs: 0.3 });
      expect(result.utilization).toBeUndefined();
    });

    it('reports timing not met when only a minimum pulse width slack is negative', async () => {
      await fs.writeFile(
        path.join(outputDir, `${projectName}.sta.summary`),
        [
          "Type  : Slow 1100mV 85C Model Setup 'sys_clk'",
          'Slack : 2.500',
          'TNS   : 0.000',
          '',
          "Type  : Slow 1100mV 85C Model Hold 'sys_clk'",
          'Slack : 0.300',
          'TNS   : 0.000',
          '',
          "Type  : Slow 1100mV 85C Model Minimum Pulse Width 'sys_clk'",
          'Slack : -0.100',
          'TNS   : -0.100',
          '',
        ].join('\n'),
        'utf8'
      );

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing).toEqual({ met: false, wns: 2.5, whs: 0.3 });
    });

    it('counts a negative Slack line whose Type line has no Model', async () => {
      await fs.writeFile(
        path.join(outputDir, `${projectName}.sta.summary`),
        ["Type  : Something Else 'sys_clk'", 'Slack : -0.500', 'TNS   : -0.500', ''].join('\n'),
        'utf8'
      );

      const result = await parseQuartusReports(tempDir, projectName);

      expect(result.timing).toEqual({ met: false });
    });
  });
});
