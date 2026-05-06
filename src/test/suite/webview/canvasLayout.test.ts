import {
  computeLayout,
  PORT_PITCH,
  EDGE_PADDING,
  MIN_BLOCK_HEIGHT,
  BLOCK_WIDTH,
} from '../../../webview/ipcore/components/canvas/canvasLayout';
import type { IpCore } from '../../../webview/types/ipCore';

function makeIpCore(overrides: Partial<IpCore> = {}): IpCore {
  return {
    vlnv: {
      vendor: 'test',
      library: 'ip',
      name: 'my_core',
      version: '1.0.0',
    },
    ...overrides,
  };
}

describe('computeLayout', () => {
  it('produces a valid layout for an empty core (no ports)', () => {
    const ip = makeIpCore();
    const layout = computeLayout(ip);

    expect(layout.coreName).toBe('my_core');
    expect(layout.vlnvLabel).toBe('test:ip:my_core:1.0.0');
    expect(layout.ports).toHaveLength(0);
    expect(layout.blockRect.width).toBe(BLOCK_WIDTH);
    expect(layout.blockRect.height).toBe(MIN_BLOCK_HEIGHT);
    expect(layout.viewBox.width).toBeGreaterThan(0);
    expect(layout.viewBox.height).toBeGreaterThan(0);
  });

  it('places clocks on the left edge', () => {
    const ip = makeIpCore({
      clocks: [{ name: 'clk' }, { name: 'clk_fast', frequency: '200MHz' }],
    });
    const layout = computeLayout(ip);

    const clockPorts = layout.ports.filter((p) => p.kind === 'clock');
    expect(clockPorts).toHaveLength(2);
    expect(clockPorts[0].side).toBe('left');
    expect(clockPorts[1].side).toBe('left');
    expect(clockPorts[0].label).toBe('clk');
    expect(clockPorts[1].label).toBe('clk_fast');
  });

  it('places resets on the left edge below clocks', () => {
    const ip = makeIpCore({
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst_n', polarity: 'activeLow' }],
    });
    const layout = computeLayout(ip);

    const clk = layout.ports.find((p) => p.kind === 'clock');
    const rst = layout.ports.find((p) => p.kind === 'reset');
    expect(clk).toBeDefined();
    expect(rst).toBeDefined();
    expect(clk!.side).toBe('left');
    expect(rst!.side).toBe('left');
    // Reset should be below clock
    expect(rst!.y).toBeGreaterThan(clk!.y);
  });

  it('places slave bus interfaces on the left, master on the right', () => {
    const ip = makeIpCore({
      busInterfaces: [
        {
          name: 's_axi',
          type: 'ipcraft.busif.axi4_lite.1.0',
          mode: 'slave' as const,
          physicalPrefix: 's_axi_',
        },
        {
          name: 'm_axi',
          type: 'ipcraft.busif.axi4_lite.1.0',
          mode: 'master' as const,
          physicalPrefix: 'm_axi_',
        },
      ],
    });
    const layout = computeLayout(ip);

    const slaveBus = layout.ports.find((p) => p.label === 's_axi');
    const masterBus = layout.ports.find((p) => p.label === 'm_axi');
    expect(slaveBus).toBeDefined();
    expect(masterBus).toBeDefined();
    expect(slaveBus!.side).toBe('left');
    expect(masterBus!.side).toBe('right');
    expect(slaveBus!.kind).toBe('bus');
    expect(masterBus!.kind).toBe('bus');
    expect(slaveBus!.protocol).toBe('AXI4-Lite');
    expect(slaveBus!.mode).toBe('S');
    expect(masterBus!.mode).toBe('M');
  });

  it('places input ports on the left, output on the right', () => {
    const ip = makeIpCore({
      ports: [
        { name: 'data_in', direction: 'in' as const, width: 32 },
        { name: 'data_out', direction: 'out' as const, width: 8 },
      ],
    });
    const layout = computeLayout(ip);

    const inPort = layout.ports.find((p) => p.label === 'data_in');
    const outPort = layout.ports.find((p) => p.label === 'data_out');
    expect(inPort).toBeDefined();
    expect(outPort).toBeDefined();
    expect(inPort!.side).toBe('left');
    expect(outPort!.side).toBe('right');
    expect(inPort!.widthLabel).toBe('[31:0]');
    expect(outPort!.widthLabel).toBe('[7:0]');
  });

  it('places bidirectional ports on the bottom edge', () => {
    const ip = makeIpCore({
      ports: [
        { name: 'sda', direction: 'inout' as const },
        { name: 'scl', direction: 'inout' as const },
      ],
    });
    const layout = computeLayout(ip);

    const bottomPorts = layout.ports.filter((p) => p.side === 'bottom');
    expect(bottomPorts).toHaveLength(2);
    expect(bottomPorts[0].label).toBe('sda');
    expect(bottomPorts[1].label).toBe('scl');
  });

  it('scales block height with many ports', () => {
    const ports = Array.from({ length: 20 }, (_, i) => ({
      name: `port_${i}`,
      direction: 'in' as const,
      width: 1,
    }));
    const ip = makeIpCore({ ports });
    const layout = computeLayout(ip);

    const expectedHeight = 20 * PORT_PITCH + EDGE_PADDING * 2;
    expect(layout.blockRect.height).toBeGreaterThanOrEqual(expectedHeight);
  });

  it('generates unique IDs for all ports', () => {
    const ip = makeIpCore({
      clocks: [{ name: 'clk' }],
      resets: [{ name: 'rst' }],
      ports: [
        { name: 'a', direction: 'in' as const },
        { name: 'b', direction: 'out' as const },
      ],
      busInterfaces: [
        {
          name: 's_axi',
          type: 'ipcraft.busif.axi4_lite.1.0',
          mode: 'slave' as const,
          physicalPrefix: 's_axi_',
        },
      ],
    });
    const layout = computeLayout(ip);

    const ids = layout.ports.map((p) => p.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('formats width labels correctly', () => {
    const ip = makeIpCore({
      ports: [
        { name: 'single', direction: 'in' as const, width: 1 },
        { name: 'byte', direction: 'in' as const, width: 8 },
        { name: 'param', direction: 'in' as const, width: 'DATA_WIDTH' },
        { name: 'no_width', direction: 'in' as const },
      ],
    });
    const layout = computeLayout(ip);

    const single = layout.ports.find((p) => p.label === 'single');
    const byte = layout.ports.find((p) => p.label === 'byte');
    const param = layout.ports.find((p) => p.label === 'param');
    const noWidth = layout.ports.find((p) => p.label === 'no_width');

    expect(single!.widthLabel).toBe(''); // width=1 -> no label
    expect(byte!.widthLabel).toBe('[7:0]');
    expect(param!.widthLabel).toBe('[DATA_WIDTH]');
    expect(noWidth!.widthLabel).toBe(''); // undefined -> no label
  });

  it('handles sink/source bus modes correctly', () => {
    const ip = makeIpCore({
      busInterfaces: [
        {
          name: 'axis_in',
          type: 'ipcraft.busif.axi_stream.1.0',
          mode: 'sink' as const,
          physicalPrefix: 's_axis_',
        },
        {
          name: 'axis_out',
          type: 'ipcraft.busif.axi_stream.1.0',
          mode: 'source' as const,
          physicalPrefix: 'm_axis_',
        },
      ],
    });
    const layout = computeLayout(ip);

    const sinkBus = layout.ports.find((p) => p.label === 'axis_in');
    const sourceBus = layout.ports.find((p) => p.label === 'axis_out');
    expect(sinkBus!.side).toBe('left');
    expect(sourceBus!.side).toBe('right');
    expect(sinkBus!.mode).toBe('Sink');
    expect(sourceBus!.mode).toBe('Src');
    expect(sinkBus!.protocol).toBe('AXI-Stream');
  });
});
