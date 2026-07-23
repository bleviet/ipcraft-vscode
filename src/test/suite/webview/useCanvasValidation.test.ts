import { useCanvasValidation } from '../../../webview/ipcore/hooks/useCanvasValidation';
import { IpCore } from '../../../webview/types/ipCore';

describe('useCanvasValidation', () => {
  it('should return no annotations for a valid IP core', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst' }],
      busInterfaces: [
        {
          name: 'axi_bus',
          type: 'axi4',
          mode: 'master',
          physicalPrefix: 'axi_',
          associatedClock: 'clk',
          associatedReset: 'rst',
        },
      ],
      ports: [{ name: 'data_in', direction: 'in', width: 32 }],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(Object.keys(annotations).length).toBe(0);
  });

  it('should detect duplicate port names', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      ports: [
        { name: 'duplicate', direction: 'in', width: 32 },
        { name: 'duplicate', direction: 'out', width: 32 },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['port:1']).toBeDefined();
    expect(annotations['port:1'][0].severity).toBe('error');
    expect(annotations['port:1'][0].message).toContain('Duplicate port name');
  });

  it('warns when big endianness is set on an inout port', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      ports: [{ name: 'data_io', direction: 'inout', width: 32, endianness: 'big' }],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['port:0']).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Endianness "big" has no effect on an inout port',
      }),
    ]);
  });

  it('warns when big endianness is set on a non-byte-multiple width', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      ports: [{ name: 'odd', direction: 'in', width: 12, endianness: 'big' }],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['port:0']).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Endianness "big" has no effect: width must be a multiple of 8 bits',
      }),
    ]);
  });

  it('does not warn for a big-endian parameterized-width port', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      ports: [{ name: 'stream', direction: 'in', width: 'DATA_WIDTH', endianness: 'big' }],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['port:0']).toBeUndefined();
  });

  it('warns when a big-endian bus data width is not a byte multiple', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      busInterfaces: [
        {
          name: 's_axi',
          type: 'ipcraft:busif:axi4_lite:1.0',
          mode: 'slave',
          physicalPrefix: 's_axi_',
          endianness: 'big',
          portWidthOverrides: { WDATA: 12 },
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Endianness "big" has no effect on WDATA: width must be a multiple of 8 bits',
      }),
    ]);
  });

  it('warns when a big-endian built-in interface has no enabled data port', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      busInterfaces: [
        {
          name: 'avalon',
          type: 'ipcraft:busif:avalon_mm:1.0',
          mode: 'slave',
          physicalPrefix: 'avs_',
          endianness: 'big',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message: 'Endianness "big" has no effect: interface has no enabled data port',
      }),
    ]);
  });

  it('should detect duplicate bus interface names', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      busInterfaces: [
        { name: 'dup_bus', type: 'axi4', mode: 'master', physicalPrefix: 'dup1_' },
        { name: 'dup_bus', type: 'axi4', mode: 'slave', physicalPrefix: 'dup2_' },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:1']).toBeDefined();
    expect(annotations['bus:1'][0].severity).toBe('error');
    expect(annotations['bus:1'][0].message).toContain('Duplicate bus interface name');
  });

  it('should not flag a master/slave bus interface for missing clock or reset — both are optional', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      busInterfaces: [
        {
          name: 'bus1',
          type: 'axi4',
          mode: 'master',
          physicalPrefix: 'bus1_',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toBeUndefined();
  });

  it('should flag invalid clock and reset references as errors', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst' }],
      busInterfaces: [
        {
          name: 'bus1',
          type: 'axi4',
          mode: 'master',
          physicalPrefix: 'bus1_',
          associatedClock: 'wrong_clk',
          associatedReset: 'wrong_rst',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toBeDefined();
    expect(annotations['bus:0'].length).toBe(2);
    expect(annotations['bus:0'][0].severity).toBe('error');
    expect(annotations['bus:0'][0].message).toContain("clock 'wrong_clk' does not exist");
    expect(annotations['bus:0'][1].severity).toBe('error');
    expect(annotations['bus:0'][1].message).toContain("reset 'wrong_rst' does not exist");
  });

  it('should flag duplicate physicalPrefix on both affected bus interfaces', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'bus_a',
          type: 'axis',
          mode: 'source',
          physicalPrefix: 's_axis_',
          associatedClock: 'clk',
        },
        {
          name: 'bus_b',
          type: 'axis',
          mode: 'sink',
          physicalPrefix: 's_axis_',
          associatedClock: 'clk',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    const bus0Msgs = annotations['bus:0']?.map((a) => a.message) ?? [];
    const bus1Msgs = annotations['bus:1']?.map((a) => a.message) ?? [];
    // Both interfaces reconstruct to identical physical port names (same prefix, no
    // portNameOverrides to disambiguate them) — a genuine collision, still flagged.
    expect(bus0Msgs.some((m) => m.includes('collides with another bus interface'))).toBe(true);
    expect(bus1Msgs.some((m) => m.includes('collides with another bus interface'))).toBe(true);
    expect(
      annotations['bus:0'].find((a) => a.message.includes('collides with another bus interface'))
        ?.severity
    ).toBe('warning');
  });

  it('should not flag two same-protocol interfaces sharing a physicalPrefix when disjoint portNameOverrides disambiguate them', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'sink_0',
          type: 'avalon_st',
          mode: 'sink',
          physicalPrefix: 'asi_',
          associatedClock: 'clk',
          portNameOverrides: { data: 'data_0_i', valid: 'valid_0_i' },
        },
        {
          name: 'sink_1',
          type: 'avalon_st',
          mode: 'sink',
          physicalPrefix: 'asi_',
          associatedClock: 'clk',
          portNameOverrides: { data: 'data_1_i', valid: 'valid_1_i' },
        },
      ] as any,
    };

    const annotations = useCanvasValidation(ipCore);
    const bus0Msgs = annotations['bus:0']?.map((a) => a.message) ?? [];
    const bus1Msgs = annotations['bus:1']?.map((a) => a.message) ?? [];
    expect(bus0Msgs.some((m) => m.includes('collides with another bus interface'))).toBe(false);
    expect(bus1Msgs.some((m) => m.includes('collides with another bus interface'))).toBe(false);
  });

  it('should flag two same-protocol interfaces sharing a physicalPrefix when overrides are identical (or absent)', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'sink_0',
          type: 'avalon_st',
          mode: 'sink',
          physicalPrefix: 'asi_',
          associatedClock: 'clk',
        },
        {
          name: 'sink_1',
          type: 'avalon_st',
          mode: 'sink',
          physicalPrefix: 'asi_',
          associatedClock: 'clk',
        },
      ] as any,
    };

    const annotations = useCanvasValidation(ipCore);
    const bus0Msgs = annotations['bus:0']?.map((a) => a.message) ?? [];
    const bus1Msgs = annotations['bus:1']?.map((a) => a.message) ?? [];
    expect(bus0Msgs.some((m) => m.includes('collides with another bus interface'))).toBe(true);
    expect(bus1Msgs.some((m) => m.includes('collides with another bus interface'))).toBe(true);
  });

  it('should detect duplicate conduit port names within the same bus interface', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      busInterfaces: [
        {
          name: 'custom_if',
          type: 'conduit',
          mode: 'master',
          conduitPorts: [
            { name: 'port_0', direction: 'in', width: 1 },
            { name: 'port_0', direction: 'out', width: 1 },
          ],
        } as any,
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    // Annotation key uses the array index (cp:1 = second occurrence) to match
    // the index-based sub-port ID produced by canvasLayout for React key stability.
    expect(annotations['bus:0:cp:1']).toBeDefined();
    expect(annotations['bus:0:cp:1'][0].severity).toBe('error');
    expect(annotations['bus:0:cp:1'][0].message).toContain('Duplicate port name');
  });

  it('should not flag unique conduit port names', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'custom_if',
          type: 'conduit',
          mode: 'master',
          associatedClock: 'clk',
          conduitPorts: [
            { name: 'port_0', direction: 'in', width: 1 },
            { name: 'port_1', direction: 'out', width: 1 },
          ],
        } as any,
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0:port_0']).toBeUndefined();
    expect(annotations['bus:0:port_1']).toBeUndefined();
  });

  it('should detect duplicate portNameOverrides suffixes within the same standard bus interface', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'axi_bus',
          type: 'axi4',
          mode: 'slave',
          physicalPrefix: 's_axi_',
          associatedClock: 'clk',
          portNameOverrides: {
            ARADDR: 'addr',
            AWADDR: 'addr',
          },
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0:ARADDR']).toBeDefined();
    expect(annotations['bus:0:ARADDR'][0].severity).toBe('error');
    expect(annotations['bus:0:ARADDR'][0].message).toContain('Duplicate port name');
    expect(annotations['bus:0:AWADDR']).toBeDefined();
    expect(annotations['bus:0:AWADDR'][0].severity).toBe('error');
    expect(annotations['bus:0:AWADDR'][0].message).toContain('Duplicate port name');
  });

  it('should not flag unique portNameOverrides suffixes', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'axi_bus',
          type: 'axi4',
          mode: 'slave',
          physicalPrefix: 's_axi_',
          associatedClock: 'clk',
          portNameOverrides: {
            ARADDR: 'read_addr',
            AWADDR: 'write_addr',
          },
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0:ARADDR']).toBeUndefined();
    expect(annotations['bus:0:AWADDR']).toBeUndefined();
  });

  it('should not flag unique physicalPrefix values', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'bus_a',
          type: 'axis',
          mode: 'source',
          physicalPrefix: 'a_axis_',
          associatedClock: 'clk',
        },
        {
          name: 'bus_b',
          type: 'axis',
          mode: 'sink',
          physicalPrefix: 'b_axis_',
          associatedClock: 'clk',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    const bus0Msgs = annotations['bus:0']?.map((a) => a.message) ?? [];
    const bus1Msgs = annotations['bus:1']?.map((a) => a.message) ?? [];
    expect(bus0Msgs.some((m) => m.includes('Duplicate physicalPrefix'))).toBe(false);
    expect(bus1Msgs.some((m) => m.includes('Duplicate physicalPrefix'))).toBe(false);
  });

  it('should flag a conduit interface with an associated clock or reset as an error', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst' }],
      busInterfaces: [
        {
          name: 'custom_if',
          type: 'user:busif:custom:1.0',
          mode: 'conduit',
          physicalPrefix: 'custom_if_',
          associatedClock: 'clk',
          associatedReset: 'rst',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toBeDefined();
    expect(annotations['bus:0']).toHaveLength(2);
    expect(annotations['bus:0'][0].severity).toBe('error');
    expect(annotations['bus:0'][0].message).toContain('must not have an associated clock');
    expect(annotations['bus:0'][1].severity).toBe('error');
    expect(annotations['bus:0'][1].message).toContain('must not have an associated reset');
  });

  it('should not warn about a missing associated clock for a conduit interface', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      busInterfaces: [
        {
          name: 'custom_if',
          type: 'user:busif:custom:1.0',
          mode: 'conduit',
          physicalPrefix: 'custom_if_',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toBeUndefined();
  });

  it('should treat a bus interface with no mode as conduit for the clock/reset rule', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'custom_if',
          type: 'user:busif:custom:1.0',
          associatedClock: 'clk',
        } as any,
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    expect(annotations['bus:0']).toBeDefined();
    expect(annotations['bus:0'][0].message).toContain('must not have an associated clock');
  });

  it('should not flag duplicate empty or null physicalPrefix values', () => {
    const ipCore: IpCore = {
      vlnv: { vendor: 'test', library: 'lib', name: 'TestCore', version: '1.0' },
      clocks: [{ name: 'clk' }],
      busInterfaces: [
        {
          name: 'bus_a',
          type: 'axis',
          mode: 'source',
          physicalPrefix: '',
          associatedClock: 'clk',
        },
        {
          name: 'bus_b',
          type: 'axis',
          mode: 'sink',
          physicalPrefix: null as any,
          associatedClock: 'clk',
        },
      ],
    };

    const annotations = useCanvasValidation(ipCore);
    const bus0Msgs = annotations['bus:0']?.map((a) => a.message) ?? [];
    const bus1Msgs = annotations['bus:1']?.map((a) => a.message) ?? [];
    expect(bus0Msgs.some((m) => m.includes('Duplicate physicalPrefix'))).toBe(false);
    expect(bus1Msgs.some((m) => m.includes('Duplicate physicalPrefix'))).toBe(false);
  });
});
