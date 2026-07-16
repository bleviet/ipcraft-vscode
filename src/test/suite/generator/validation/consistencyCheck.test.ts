import {
  crossCheckIpCoreAgainstHdl,
  crossCheckIpCoreAgainstTopLevelHdl,
  crossCheckIpCoreAgainstVendor,
} from '../../../../generator/validation/hdlCrossCheck';
import type { IpCoreData } from '../../../../generator/types';

function baseIpCore(overrides: Partial<IpCoreData> = {}): IpCoreData {
  return {
    vlnv: { vendor: 'test', library: 'lib', name: 'led_blink', version: '1.0.0' },
    ...overrides,
  } as IpCoreData;
}

function makeReader(content: string): (absPath: string) => Promise<string> {
  return async () => content;
}

describe('crossCheckIpCoreAgainstHdl — implementation-only drift (issue #84)', () => {
  it('reports an HDL port not declared in the .ip.yml as extra-port, amber, with an inferred shape', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: false }],
        },
      ],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const hdl = [
      'module led_blink(',
      '  output logic led,',
      '  output logic [3:0] status',
      ');',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    const extra = findings.find((f) => f.kind === 'extra-port');
    expect(extra).toBeDefined();
    expect(extra?.severity).toBe('amber');
    expect(extra?.source).toBe('hdl');
    expect(extra?.ipYmlPath).toEqual(['ports']);
    expect(extra?.inferred).toEqual({ name: 'status', direction: 'out', width: 4 });
  });

  it('reports an HDL generic not declared in the .ip.yml as extra-parameter, amber', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: false }],
        },
      ],
    });
    const hdl = [
      'module led_blink #(',
      '  parameter integer DEPTH = 16',
      ') ();',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    const extra = findings.find((f) => f.kind === 'extra-parameter');
    expect(extra).toBeDefined();
    expect(extra?.severity).toBe('amber');
    expect(extra?.inferred).toEqual({ name: 'DEPTH', value: '16' });
  });

  it('marks missing-port and direction-mismatch as red, width-mismatch as amber', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [{ path: 'rtl/led_blink.sv', type: 'systemverilog', managed: false }],
        },
      ],
      clocks: [{ name: 'clk' }],
      ports: [
        { name: 'led', direction: 'out', width: 1 },
        { name: 'enable', direction: 'in', width: 1 },
      ],
    });
    // clk is entirely absent; enable's direction is flipped; led's width is widened.
    const hdl = [
      'module led_blink(',
      '  output logic enable,',
      '  output logic [7:0] led',
      ');',
      'endmodule',
    ].join('\n');

    const findings = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));

    expect(findings.find((f) => f.kind === 'missing-port')?.severity).toBe('red');
    expect(findings.find((f) => f.kind === 'direction-mismatch')?.severity).toBe('red');
    expect(findings.find((f) => f.kind === 'width-mismatch')?.severity).toBe('amber');
    expect(findings.every((f) => f.source === 'hdl')).toBe(true);
  });
});

describe('crossCheckIpCoreAgainstTopLevelHdl — checks the top level regardless of managed flag', () => {
  // Reproduces a real false negative: comprehensive_avalon.ip.yml's RTL fileSet entries have no
  // `managed` field (schema default: true, i.e. generator-owned), so a hand-edited top-level
  // .vhd that has drifted from the .ip.yml was silently reported as consistent.
  it('catches drift in a top-level HDL file that has no managed:false flag', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          // No `managed` key at all — the exact shape of the real fixture that triggered this.
          files: [{ path: 'rtl/led_blink.vhd', type: 'vhdl' }],
        },
      ],
      clocks: [{ name: 'clk' }],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const hdl = [
      'entity led_blink is',
      '  port (',
      '    clk : in std_logic;',
      '    led : out std_logic_vector(7 downto 0);',
      '    status : out std_logic',
      '  );',
      'end entity led_blink;',
    ].join('\n');

    const broad = await crossCheckIpCoreAgainstTopLevelHdl(ipCore, '/proj', makeReader(hdl));
    expect(broad.find((f) => f.kind === 'width-mismatch')).toBeDefined();
    expect(broad.find((f) => f.kind === 'extra-port')?.inferred).toEqual({
      name: 'status',
      direction: 'out',
      width: 1,
    });

    // The managed:false-only check (issue #74's checkHdlConsistency) must keep ignoring this
    // file — its whole point is scoping to files the generator promises never to touch.
    const narrow = await crossCheckIpCoreAgainstHdl(ipCore, '/proj', makeReader(hdl));
    expect(narrow).toEqual([]);
  });

  it('still identifies the correct top level by entity name when several HDL files have no managed flag', async () => {
    const ipCore = baseIpCore({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/led_blink.vhd', type: 'vhdl' },
            { path: 'rtl/led_blink_pkg.vhd', type: 'vhdl' },
          ],
        },
      ],
      ports: [{ name: 'led', direction: 'out', width: 1 }],
    });
    const reader = async (absPath: string) => {
      if (absPath.endsWith('led_blink.vhd')) {
        return [
          'entity led_blink is',
          '  port (led : out std_logic_vector(3 downto 0));',
          'end entity led_blink;',
        ].join('\n');
      }
      return 'package led_blink_pkg is end package;';
    };

    const findings = await crossCheckIpCoreAgainstTopLevelHdl(ipCore, '/proj', reader);
    expect(findings).toHaveLength(1);
    expect(findings[0].kind).toBe('width-mismatch');
    expect(findings[0].hdlFile).toBe('rtl/led_blink.vhd');
  });
});

describe('crossCheckIpCoreAgainstVendor — _hw.tcl (Intel Platform Designer)', () => {
  const HW_TCL = [
    'set_module_property NAME led_blink',
    'add_interface leds conduit start',
    'add_interface_port leds led EXPORT Output 8',
    'add_interface_port leds unexpected_signal EXPORT Output 1',
    'add_parameter DEPTH INTEGER 16',
  ].join('\n');

  it('diffs against the conventional altera/<name>_hw.tcl path', async () => {
    const ipCore = baseIpCore({
      ports: [{ name: 'led', direction: 'out', width: 1 }],
      parameters: [{ name: 'WIDTH', dataType: 'integer', value: 8 }],
    });
    const reader = jest.fn(makeReader(HW_TCL));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'hwTcl', reader);

    expect(reader).toHaveBeenCalledWith(expect.stringContaining('altera'));
    expect(reader.mock.calls[0][0]).toContain('led_blink_hw.tcl');

    expect(findings.every((f) => f.source === 'hwTcl')).toBe(true);

    const width = findings.find((f) => f.kind === 'width-mismatch');
    expect(width).toBeDefined();
    expect(width?.severity).toBe('amber');

    const missingParam = findings.find((f) => f.kind === 'missing-parameter');
    expect(missingParam?.message).toContain('WIDTH');
    expect(missingParam?.severity).toBe('red');

    const extraPort = findings.find((f) => f.kind === 'extra-port');
    expect(extraPort?.inferred).toEqual({
      name: 'unexpected_signal',
      direction: 'out',
      width: 1,
    });

    const extraParam = findings.find((f) => f.kind === 'extra-parameter');
    expect(extraParam?.inferred).toEqual({ name: 'DEPTH', value: '16' });
  });

  it('returns no findings when the .ip.yml has no vlnv.name to derive the vendor path from', async () => {
    const ipCore = baseIpCore({ vlnv: undefined });
    const reader = jest.fn();

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'hwTcl', reader);

    expect(findings).toEqual([]);
    expect(reader).not.toHaveBeenCalled();
  });

  it('returns no findings when the _hw.tcl has not been scaffolded yet', async () => {
    const ipCore = baseIpCore();
    const reader = jest.fn().mockRejectedValue(new Error('ENOENT'));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'hwTcl', reader);

    expect(findings).toEqual([]);
  });
});

describe('crossCheckIpCoreAgainstVendor — component.xml (Xilinx/Vivado)', () => {
  const COMPONENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<spirit:component xmlns:spirit="http://www.spiritconsortium.org/XMLSchema/SPIRIT/1685-2009">
  <spirit:vendor>acme.com</spirit:vendor>
  <spirit:library>ip</spirit:library>
  <spirit:name>led_blink</spirit:name>
  <spirit:version>1.0</spirit:version>
  <spirit:model>
    <spirit:ports>
      <spirit:port>
        <spirit:name>led</spirit:name>
        <spirit:wire>
          <spirit:direction>out</spirit:direction>
          <spirit:vector><spirit:left>7</spirit:left><spirit:right>0</spirit:right></spirit:vector>
        </spirit:wire>
      </spirit:port>
      <spirit:port>
        <spirit:name>unexpected_signal</spirit:name>
        <spirit:wire><spirit:direction>out</spirit:direction></spirit:wire>
      </spirit:port>
    </spirit:ports>
  </spirit:model>
  <spirit:parameters>
    <spirit:parameter>
      <spirit:name>DEPTH</spirit:name>
      <spirit:value spirit:format="long">16</spirit:value>
    </spirit:parameter>
  </spirit:parameters>
</spirit:component>`;

  it('diffs against the conventional xilinx/component.xml path', async () => {
    const ipCore = baseIpCore({
      ports: [{ name: 'led', direction: 'out', width: 1 }],
      parameters: [{ name: 'WIDTH', dataType: 'integer', value: 8 }],
    });
    const reader = jest.fn(makeReader(COMPONENT_XML));

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(reader.mock.calls[0][0]).toContain('xilinx');
    expect(reader.mock.calls[0][0]).toContain('component.xml');
    expect(findings.every((f) => f.source === 'componentXml')).toBe(true);

    expect(findings.find((f) => f.kind === 'width-mismatch')).toBeDefined();
    expect(findings.find((f) => f.kind === 'missing-parameter')?.message).toContain('WIDTH');

    const extraPort = findings.find((f) => f.kind === 'extra-port');
    expect(extraPort?.inferred).toEqual({ name: 'unexpected_signal', direction: 'out', width: 1 });

    const extraParam = findings.find((f) => f.kind === 'extra-parameter');
    expect(extraParam?.inferred).toEqual({ name: 'DEPTH', value: '16' });
  });

  it('returns no findings for unparsable vendor content instead of throwing', async () => {
    const ipCore = baseIpCore({ ports: [{ name: 'led', direction: 'out', width: 1 }] });
    const reader = makeReader('not valid xml at all <<<');

    const findings = await crossCheckIpCoreAgainstVendor(ipCore, '/proj', 'componentXml', reader);

    expect(findings).toEqual([]);
  });
});
