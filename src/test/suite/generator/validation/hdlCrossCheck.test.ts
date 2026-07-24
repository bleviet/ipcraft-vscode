import {
  crossCheckIpCoreAgainstHdl,
  crossCheckIpCoreAgainstTopLevelHdl,
} from '../../../../generator/validation/hdlCrossCheck';
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

/** Keyed by the file's basename so callers don't need to know the ipCoreDir prefix. */
function makeMultiReader(byBasename: Record<string, string>): (absPath: string) => Promise<string> {
  return async (absPath: string) => {
    const basename = absPath.split(/[/\\]/).pop() ?? '';
    const content = byBasename[basename];
    if (content === undefined) {
      throw new Error(`ENOENT: no fixture for ${absPath}`);
    }
    return content;
  };
}

describe('HDL top-level selection', () => {
  it('only checks the implementation when packages and a colliding black-box stub are present', async () => {
    const ipCore = baseIpCore({
      vlnv: { vendor: 'acme', library: 'lib', name: 'led_ctrl', version: '1.0.0' },
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'led_ctrl_pkg.vhd', type: 'vhdl' },
            { path: 'led_ctrl_bb.vhd', type: 'vhdl' },
            { path: 'led_ctrl.vhd', type: 'vhdl' },
          ],
        },
      ],
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst' }],
      ports: [{ name: 'o_led', direction: 'out', width: 1 }],
      parameters: [{ name: 'WIDTH', value: 8, dataType: 'integer' }],
    });
    const reader = makeMultiReader({
      'led_ctrl_pkg.vhd': [
        'package led_ctrl_pkg is',
        '  constant C_FOO : integer := 1;',
        'end package led_ctrl_pkg;',
      ].join('\n'),
      'led_ctrl_bb.vhd': [
        'entity led_ctrl is',
        '  port (dummy : in std_logic);',
        'end entity led_ctrl;',
        'architecture bb of led_ctrl is begin end architecture bb;',
      ].join('\n'),
      'led_ctrl.vhd': [
        'entity led_ctrl is',
        '  generic (WIDTH : integer := 8);',
        '  port (',
        '    clk : in std_logic;',
        '    rst : in std_logic;',
        '    o_led : out std_logic',
        '  );',
        'end entity led_ctrl;',
        'architecture rtl of led_ctrl is begin end architecture rtl;',
      ].join('\n'),
    });

    const findings = await crossCheckIpCoreAgainstTopLevelHdl(ipCore, '/proj', reader);

    expect(findings).toEqual([]);
  });

  it('does not select a conventionally named testbench over the sole implementation', async () => {
    const ipCore = baseIpCore({
      vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0.0' },
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/implementation.sv', type: 'systemverilog' },
            { path: 'tb/core_tb.sv', type: 'systemverilog' },
          ],
        },
      ],
      ports: [{ name: 'data', direction: 'out', width: 1 }],
    });
    const reader = makeMultiReader({
      'implementation.sv': ['module implementation(output logic data);', 'endmodule'].join('\n'),
      'core_tb.sv': ['module core();', 'endmodule'].join('\n'),
    });

    const findings = await crossCheckIpCoreAgainstTopLevelHdl(ipCore, '/proj', reader);

    expect(findings).toEqual([]);
  });

  it('reports one ambiguity instead of diffing an entity-less package', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink_pkg.vhd', type: 'vhdl', managed: false }],
        },
      ],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });

    const findings = await crossCheckIpCoreAgainstHdl(
      ipCore,
      '/proj',
      makeReader('package led_blink_pkg is end package led_blink_pkg;')
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('top-level-ambiguity');
    expect(findings[0].message).toContain('no eligible entity/module');
    expect(findings.some((finding) => finding.kind === 'missing-port')).toBe(false);
  });
});

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

  it('does not duplicate findings when the same managed:false file is listed in multiple fileSets', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: false }],
        },
        {
          name: 'Simulation_Resources',
          files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: false }],
        },
      ],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const hdl = ['module led_blink(', '  output logic [7:0] led', ');', 'endmodule'].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    expect(findings.filter((f) => f.kind === 'width-mismatch')).toHaveLength(1);
  });

  it('only cross-checks the file matching the IP core name when multiple managed:false HDL files exist, leaving other files unchecked', async () => {
    const ipCore = baseIpCore({
      vlnv: { vendor: 'test', library: 'lib', name: 'top', version: '1.0.0' },
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/top.sv', type: 'systemverilog', managed: false },
            { path: 'rtl/submodule.sv', type: 'systemverilog', managed: false },
          ],
        },
      ],
      clocks: [{ name: 'clk' }],
      ports: [{ name: 'data', direction: 'out', width: 1 }],
    });
    const reader = makeMultiReader({
      'top.sv': [
        'module top(',
        '  input logic clk,',
        '  output logic data',
        ');',
        'endmodule',
      ].join('\n'),
      // A submodule that legitimately doesn't expose clk/data under those names — it must
      // not be flagged as missing them just because it's also managed:false.
      'submodule.sv': ['module submodule(', '  input logic enable', ');', 'endmodule'].join('\n'),
    });

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', reader);

    expect(findings).toEqual([]);
    expect(findings.some((f) => f.hdlFile === 'rtl/submodule.sv')).toBe(false);
  });

  it('reports one ambiguity when no managed:false entity matches the IP core name', async () => {
    const ipCore = baseIpCore({
      vlnv: { vendor: 'test', library: 'lib', name: 'ambiguous_top', version: '1.0.0' },
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/alpha.sv', type: 'systemverilog', managed: false },
            { path: 'rtl/beta.sv', type: 'systemverilog', managed: false },
          ],
        },
      ],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const reader = makeMultiReader({
      'alpha.sv': ['module alpha();', 'endmodule'].join('\n'),
      'beta.sv': ['module beta();', 'endmodule'].join('\n'),
    });

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', reader);

    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('top-level-ambiguity');
    expect(findings[0].severity).toBe('amber');
    expect(findings[0].message).toContain('rtl/alpha.sv');
    expect(findings[0].message).toContain('rtl/beta.sv');
  });

  it('does not silently skip the real top when the IP core name is undefined and another managed:false file fails to parse a name', async () => {
    // Without a guard, `undefined === undefined` (missing vlnv.name vs. an unparseable
    // module) reads as a "match", so the unparseable file would be selected as "the top" and
    // the real, correctly-named top would be dropped from the check entirely.
    const ipCore = baseIpCore({
      vlnv: { vendor: 'test', library: 'lib', version: '1.0.0' } as unknown as IpCoreData['vlnv'],
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/top.sv', type: 'systemverilog', managed: false },
            { path: 'rtl/blank.sv', type: 'systemverilog', managed: false },
          ],
        },
      ],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const reader = makeMultiReader({
      // Real top, deliberately width-mismatched so a bug that drops it from the check is
      // observable (an unchecked file naturally contributes zero findings either way).
      'top.sv': ['module top(', '  output logic [7:0] led', ');', 'endmodule'].join('\n'),
      // Fails to parse a module name -- entityName is null, not merely absent.
      'blank.sv': '',
    });

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', reader);

    expect(findings.some((f) => f.hdlFile === 'rtl/top.sv' && f.kind === 'width-mismatch')).toBe(
      true
    );
  });
});
