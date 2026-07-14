import { crossCheckIpCoreAgainstHdl } from '../../../../generator/validation/hdlCrossCheck';
import type { IpCoreData } from '../../../../generator/types';

function baseIpCore(overrides: Partial<IpCoreData> = {}): IpCoreData {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'led_blink', version: '1.0.0' },
    fileSets: [
      {
        name: 'RTL_Sources',
        files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: false }],
      },
    ],
    ...overrides,
  } as IpCoreData;
}

function makeReader(content: string): (absPath: string) => Promise<string> {
  return async () => content;
}

describe('crossCheckIpCoreAgainstHdl', () => {
  it('reports a width mismatch citing both the .ip.yml and the HDL location (issue #74 AC1)', async () => {
    const ipCore = baseIpCore({
      clocks: [{ name: 'clk' }],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const hdl = [
      'module led_blink(',
      '  input logic clk,',
      '  output logic [7:0] led',
      ');',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    const widthFinding = findings.find((f) => f.kind === 'width-mismatch');
    expect(widthFinding).toBeDefined();
    expect(widthFinding?.message).toContain('led');
    expect(widthFinding?.message).toContain('width 1');
    expect(widthFinding?.message).toContain('width 8');
    expect(widthFinding?.hdlFile).toBe('rtl/led_blink.sv');
    expect(widthFinding?.ipYmlPath).toEqual(['ports', 0]);
  });

  it('reports a clock/reset/port declared in .ip.yml but absent from the HDL top as missing (issue #74 AC2)', async () => {
    const ipCore = baseIpCore({
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst_n', polarity: 'activeLow' }],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    // HDL only implements clk + led -- rst_n is missing entirely.
    const hdl = [
      'module led_blink(',
      '  input logic clk,',
      '  output logic led',
      ');',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    const missing = findings.filter((f) => f.kind === 'missing-port');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('rst_n');
    expect(missing[0].ipYmlPath).toEqual(['resets', 0]);
  });

  it('produces no findings for a fully consistent pair (issue #74 AC3)', async () => {
    const ipCore = baseIpCore({
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst_n', polarity: 'activeLow' }],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
      parameters: [{ name: 'BLINK_DIVISOR', dataType: 'integer', value: 50000000 }],
    });
    const hdl = [
      'module led_blink #(',
      '  parameter integer BLINK_DIVISOR = 50000000',
      ') (',
      '  input logic clk,',
      '  input logic rst_n,',
      '  output logic led',
      ');',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    expect(findings).toEqual([]);
  });

  it('reports a direction mismatch', async () => {
    const ipCore = baseIpCore({
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const hdl = ['module led_blink(', '  input logic led', ');', 'endmodule'].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));
    expect(findings.some((f) => f.kind === 'direction-mismatch')).toBe(true);
  });

  it('reports a missing parameter and a default-value mismatch', async () => {
    const ipCore = baseIpCore({
      parameters: [
        { name: 'BLINK_DIVISOR', dataType: 'integer', value: 50000000 },
        { name: 'UNUSED_PARAM', dataType: 'integer', value: 1 },
      ],
    });
    const hdl = [
      'module led_blink #(',
      '  parameter integer BLINK_DIVISOR = 12345',
      ') ();',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));
    expect(findings.some((f) => f.kind === 'parameter-default-mismatch')).toBe(true);
    expect(
      findings.some((f) => f.kind === 'missing-parameter' && f.message.includes('UNUSED_PARAM'))
    ).toBe(true);
  });

  it('skips a fileSets entry whose file is not managed:false', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: true }],
        },
      ],
      ports: [{ name: 'nonexistent_port', direction: 'out', width: 1 }],
    });
    const findings = await crossCheckIpCoreAgainstHdl(
      ipCore,
      '/proj',
      makeReader('module x(); endmodule')
    );
    expect(findings).toEqual([]);
  });

  it('returns no findings and never reads the filesystem when there are no managed:false HDL files', async () => {
    const ipCore = baseIpCore({ fileSets: [] });
    const reader = jest.fn();
    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', reader);
    expect(findings).toEqual([]);
    expect(reader).not.toHaveBeenCalled();
  });

  it('silently skips a managed:false file that does not exist on disk yet', async () => {
    const ipCore = baseIpCore({
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const reader = jest.fn().mockRejectedValue(new Error('ENOENT'));
    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', reader);
    expect(findings).toEqual([]);
  });

  it('cross-checks a VHDL managed:false file', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink.vhd', type: 'vhdl', managed: false }],
        },
      ],
      clocks: [{ name: 'clk' }],
      ports: [{ name: 'led', direction: 'out', width: 8 }],
    });
    const hdl = [
      'entity led_blink is',
      '  port (',
      '    clk : in std_logic;',
      '    led : out std_logic',
      '  );',
      'end entity led_blink;',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));
    const widthFinding = findings.find((f) => f.kind === 'width-mismatch');
    expect(widthFinding).toBeDefined();
    expect(widthFinding?.hdlEntity).toBe('led_blink');
  });
});
