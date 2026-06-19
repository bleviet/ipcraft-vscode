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

    expect(layout.coreName).toBe('my_core v1.0.0');
    expect(layout.vendorLabel).toBe('test');
    expect(layout.libraryLabel).toBe('ip');
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
          type: 'ipcraft:busif:axi4_lite:1.0',
          mode: 'slave' as const,
          physicalPrefix: 's_axi_',
        },
        {
          name: 'm_axi',
          type: 'ipcraft:busif:axi4_lite:1.0',
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

  it('first port Y is below the block VLNV header text (no label overlap)', () => {
    // The VLNV subtitle is rendered at blockRect.y + 42. Before this fix the first port
    // was also at blockY + 42, causing direct text overlap on the right-side interface label.
    const VLNV_Y_OFFSET = 42; // matches IpBlockCanvas.tsx <text y={blockRect.y + 42}>
    const ip = makeIpCore({
      busInterfaces: [
        {
          name: 'm_axis',
          type: 'ipcraft:busif:axi_stream:1.0',
          mode: 'master' as const,
          physicalPrefix: 'm_axis_',
        },
      ],
    });
    const layout = computeLayout(ip);
    const firstPort = layout.ports[0];
    expect(firstPort.y).toBeGreaterThan(layout.blockRect.y + VLNV_Y_OFFSET);
  });

  it('conduit sub-port IDs are unique even when port names are duplicated', () => {
    // Duplicate conduit port names must not produce duplicate React keys, which
    // would prevent stale sub-port elements from unmounting on accordion collapse.
    const ip = makeIpCore({
      busInterfaces: [
        {
          name: 'custom_if',
          type: 'ipcraft:busif:conduit:1.0',
          mode: 'conduit' as const,
          physicalPrefix: 'if_',
          conduitPorts: [
            { name: 'sig', direction: 'in' as const, width: 1 },
            { name: 'sig', direction: 'out' as const, width: 1 }, // duplicate name
          ],
        },
      ],
    } as Parameters<typeof makeIpCore>[0]);
    const layout = computeLayout(ip, new Set(['bus:0']));

    const subIds = layout.subPorts.map((sp) => sp.id);
    const unique = new Set(subIds);
    expect(unique.size).toBe(subIds.length);
    // IDs are index-based so they survive name collisions
    expect(subIds).toContain('bus:0:cp:0');
    expect(subIds).toContain('bus:0:cp:1');
  });

  it('port Y positions are not shifted by a description section', () => {
    // A description appends extra height below the ports area. The centering formula
    // must use portsBlockHeight (ports area only), not total blockHeight, otherwise
    // ports are incorrectly shifted down by descSectionHeight/2 — causing the last
    // port to sit on top of or past the description separator line.
    const ip = makeIpCore({
      ports: [
        { name: 'a', direction: 'in' as const },
        { name: 'b', direction: 'in' as const },
        { name: 'c', direction: 'out' as const },
      ],
    });
    const layoutNoDesc = computeLayout(ip);
    const layoutWithDesc = computeLayout(
      ip,
      new Set(),
      () => null,
      'A description that should not affect port vertical positions.'
    );

    // Port Y coordinates must be identical regardless of description presence
    layoutNoDesc.ports.forEach((p, i) => {
      expect(layoutWithDesc.ports[i].y).toBe(p.y);
    });
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
          type: 'ipcraft:busif:axi4_lite:1.0',
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

  it('handles sink/source bus modes correctly (mapped to slave/master)', () => {
    const ip = makeIpCore({
      busInterfaces: [
        {
          name: 'axis_in',
          type: 'ipcraft:busif:axi_stream:1.0',
          mode: 'sink' as const,
          physicalPrefix: 's_axis_',
        },
        {
          name: 'axis_out',
          type: 'ipcraft:busif:axi_stream:1.0',
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
    expect(sinkBus!.mode).toBe('S');
    expect(sourceBus!.mode).toBe('M');
    expect(sinkBus!.protocol).toBe('AXI-Stream');
  });

  it('places custom interface with master mode on the right, slave/conduit on the left', () => {
    const ip = makeIpCore({
      busInterfaces: [
        {
          name: 'xcvr_slave',
          type: 'user:busif:xcvr:1.0',
          mode: 'slave' as const,
          physicalPrefix: 'xcvr_s_',
          conduitPorts: [{ name: 'tx_data', direction: 'out' as const, width: 16 }],
        },
        {
          name: 'xcvr_master',
          type: 'user:busif:xcvr:1.0',
          mode: 'master' as const,
          physicalPrefix: 'xcvr_m_',
          conduitPorts: [{ name: 'tx_data', direction: 'out' as const, width: 16 }],
        },
        {
          name: 'xcvr_conduit',
          type: 'user:busif:xcvr:1.0',
          mode: 'conduit' as const,
          physicalPrefix: 'xcvr_c_',
          conduitPorts: [{ name: 'tx_data', direction: 'out' as const, width: 16 }],
        },
      ],
    });
    const layout = computeLayout(ip);

    const slaveIf = layout.ports.find((p) => p.label === 'xcvr_slave');
    const masterIf = layout.ports.find((p) => p.label === 'xcvr_master');
    const conduitIf = layout.ports.find((p) => p.label === 'xcvr_conduit');

    expect(slaveIf!.side).toBe('left');
    expect(slaveIf!.mode).toBe('S');

    expect(masterIf!.side).toBe('right');
    expect(masterIf!.mode).toBe('M');

    expect(conduitIf!.side).toBe('left');
    expect(conduitIf!.mode).toBe('');
  });

  describe('subcores / Dependencies section', () => {
    it('produces empty subcoreDeps when no subcores are defined', () => {
      const ip = makeIpCore();
      const layout = computeLayout(ip);
      expect(layout.subcoreDeps).toHaveLength(0);
    });

    it('computes subcoreDeps entries from string subcores', () => {
      const ip = makeIpCore({
        subcores: ['xilinx.com:ip:fifo_generator:13.2', 'xilinx.com:ip:clk_wiz:6.0'],
      } as Partial<IpCore>);
      const layout = computeLayout(ip);

      expect(layout.subcoreDeps).toHaveLength(2);
      expect(layout.subcoreDeps[0].vlnv).toBe('xilinx.com:ip:fifo_generator:13.2');
      expect(layout.subcoreDeps[0].shortName).toBe('fifo_generator');
      expect(layout.subcoreDeps[0].index).toBe(0);
      expect(layout.subcoreDeps[1].vlnv).toBe('xilinx.com:ip:clk_wiz:6.0');
      expect(layout.subcoreDeps[1].shortName).toBe('clk_wiz');
      expect(layout.subcoreDeps[1].index).toBe(1);
    });

    it('computes subcoreDeps entries from object subcores', () => {
      const ip = makeIpCore({
        subcores: [{ vlnv: 'my.com:lib:my_sub:1.0', path: 'cores/my_sub' }],
      } as Partial<IpCore>);
      const layout = computeLayout(ip);

      expect(layout.subcoreDeps).toHaveLength(1);
      expect(layout.subcoreDeps[0].vlnv).toBe('my.com:lib:my_sub:1.0');
      expect(layout.subcoreDeps[0].shortName).toBe('my_sub');
    });

    it('depSeparatorY is at blockY + 86 regardless of subcores count', () => {
      const ip = makeIpCore({
        subcores: ['a.com:l:foo:1.0'],
      } as Partial<IpCore>);
      const layout = computeLayout(ip);
      expect(layout.depSeparatorY).toBe(layout.blockRect.y + 86);
    });

    it('subcore rows have increasing Y positions', () => {
      const ip = makeIpCore({
        subcores: ['a:b:c:1', 'a:b:d:1', 'a:b:e:1'],
      } as Partial<IpCore>);
      const layout = computeLayout(ip);

      const ys = layout.subcoreDeps.map((d) => d.y);
      expect(ys[1]).toBeGreaterThan(ys[0]);
      expect(ys[2]).toBeGreaterThan(ys[1]);
    });

    it('paramSeparatorY is pushed below the subcores section', () => {
      const ipNoSub = makeIpCore({
        parameters: [{ name: 'WIDTH', defaultValue: 8 }] as unknown as IpCore['parameters'],
      });
      const ipWithSub = makeIpCore({
        subcores: ['a:b:c:1', 'a:b:d:1'],
        parameters: [{ name: 'WIDTH', defaultValue: 8 }] as unknown as IpCore['parameters'],
      } as Partial<IpCore>);

      const layoutNoSub = computeLayout(ipNoSub);
      const layoutWithSub = computeLayout(ipWithSub);

      // Having subcores must push the parameter separator lower
      expect(layoutWithSub.paramSeparatorY).toBeGreaterThan(layoutNoSub.paramSeparatorY);
    });

    it('block height increases to accommodate subcores section', () => {
      const ipNoSub = makeIpCore();
      const ipWithSub = makeIpCore({
        subcores: ['a:b:c:1', 'a:b:d:1', 'a:b:e:1'],
      } as Partial<IpCore>);

      const layoutNoSub = computeLayout(ipNoSub);
      const layoutWithSub = computeLayout(ipWithSub);

      expect(layoutWithSub.blockRect.height).toBeGreaterThan(layoutNoSub.blockRect.height);
    });
  });
});
