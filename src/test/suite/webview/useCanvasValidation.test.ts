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

  it('should flag missing associated clock in bus interfaces as a warning', () => {
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
    expect(annotations['bus:0']).toBeDefined();
    expect(annotations['bus:0'][0].severity).toBe('warning');
    expect(annotations['bus:0'][0].message).toContain('missing an associated clock');
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
});
