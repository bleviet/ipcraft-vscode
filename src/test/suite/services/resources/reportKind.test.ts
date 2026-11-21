import { recognizeReport } from '../../../../services/resources/reportKind';
import { quartusFixture, vivadoFixture } from './fixtures';

describe('recognizeReport', () => {
  it.each([
    ['synth_hier.rpt', 'vivado-hierarchical', 'synth'],
    ['routed_hier.rpt', 'vivado-hierarchical', 'routed'],
    ['synth_flat.rpt', 'vivado-flat', 'synth'],
    ['routed_flat.rpt', 'vivado-flat', 'routed'],
    ['sys_wrapper_utilization_placed.rpt', 'vivado-flat', 'placed'],
  ])('recognizes %s as %s at stage %s', (file, kind, stage) => {
    expect(recognizeReport(vivadoFixture(file))).toMatchObject({
      recognized: true,
      kind,
      vendor: 'vivado',
      stage,
      design: 'sys_wrapper',
      device: 'xc7a100tfgg676-1',
      toolVersion: expect.stringContaining('Vivado v.2024.2'),
    });
  });

  it('returns the date as written and never the host or the command', () => {
    const result = recognizeReport(vivadoFixture('routed_hier.rpt'));
    expect(result).toMatchObject({ date: 'Sat Nov 21 03:51:54 2026' });
    const json = JSON.stringify(result);
    expect(json).not.toContain('build-host');
    expect(json).not.toContain('impl_hier.rpt');
  });

  it('recognizes an out-of-context IP report as a synthesized flat report of that IP', () => {
    expect(
      recognizeReport(vivadoFixture('ooc/sys_axi_gpio_0_0_utilization_synth.rpt'))
    ).toMatchObject({
      recognized: true,
      kind: 'vivado-flat',
      stage: 'synth',
      design: 'sys_axi_gpio_0_0',
    });
  });

  it.each([
    ['spike.fit.rpt', 'fit'],
    ['spike.map.rpt', 'synth'],
  ])('recognizes the Quartus entity report %s at stage %s', (file, stage) => {
    expect(recognizeReport(quartusFixture(file))).toMatchObject({
      recognized: true,
      kind: 'quartus-entity',
      vendor: 'quartus',
      stage,
      revision: 'spike',
      date: 'Sat Nov 21 03:4' + (stage === 'fit' ? '7:19' : '6:44') + ' 2026',
      toolVersion: '25.1std.0 Build 1129 10/21/2025 SC Lite Edition',
    });
  });

  it('refuses a Vivado timing report and names the command', () => {
    const result = recognizeReport(vivadoFixture('sys_wrapper_timing_summary_routed.rpt'));
    expect(result).toMatchObject({ recognized: false, reason: 'not-utilization' });
    expect((result as { message: string }).message).toContain('report_timing_summary');
  });

  it('refuses a Quartus Timing Analyzer report', () => {
    expect(
      recognizeReport(quartusFixture('led_controller_avmm.sta.rpt', 'led_controller_avmm'))
    ).toMatchObject({ recognized: false, reason: 'not-utilization' });
  });

  it('refuses a .fit.summary and points to the .fit.rpt', () => {
    const result = recognizeReport(quartusFixture('spike.fit.summary'));
    expect(result).toMatchObject({ recognized: false, reason: 'summary-only' });
    expect((result as { message: string }).message).toContain('.fit.rpt');
  });

  it.each([
    ['Fitter', 'Fitter report for spike\nSat Nov 21 03:47:19 2026\n'],
    ['Analysis & Synthesis', 'Analysis & Synthesis report for spike\nSat Nov 21 03:46:44 2026\n'],
  ])('refuses a %s report without its entity table', (_name, text) => {
    expect(recognizeReport(text)).toMatchObject({ recognized: false, reason: 'no-entity-table' });
  });

  it("refuses a fitter report that only has the other stage's table", () => {
    const text = quartusFixture('spike.map.rpt').replace(
      /^Analysis & Synthesis report/,
      'Fitter report'
    );
    expect(recognizeReport(text)).toMatchObject({ recognized: false, reason: 'no-entity-table' });
  });

  it.each(['', 'hello world', '<?xml version="1.0"?>\n<root/>', 'module top; endmodule'])(
    'refuses unknown text %j',
    (text) => {
      expect(recognizeReport(text)).toMatchObject({ recognized: false, reason: 'unknown' });
    }
  );

  it('gives the same result for the same text, whatever the file is called', () => {
    // The function takes no name: two reads of the same text are equal.
    const text = vivadoFixture('routed_hier.rpt');
    expect(recognizeReport(text)).toEqual(recognizeReport(`${text}`));
  });

  it('every refusal carries a one-sentence message', () => {
    const texts = [
      vivadoFixture('sys_wrapper_timing_summary_routed.rpt'),
      quartusFixture('spike.fit.summary'),
      'random',
    ];
    for (const text of texts) {
      const result = recognizeReport(text);
      expect(result.recognized).toBe(false);
      expect((result as { message: string }).message.length).toBeGreaterThan(10);
    }
  });
});
