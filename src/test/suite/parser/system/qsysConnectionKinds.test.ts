import {
  inferConnectionKinds,
  type KindConnection,
  type KindExport,
} from '../../../../parser/system/qsysConnectionKinds';

const conn = (start: string, end: string, extra: Partial<KindConnection> = {}): KindConnection => ({
  start,
  end,
  parameters: {},
  ...extra,
});

const infer = (connections: KindConnection[], interfaces: KindExport[] = []) =>
  inferConnectionKinds(connections, interfaces);

const byName = (start: string, end: string) => infer([conn(start, end)])[0];

describe('inferConnectionKinds: rule 1, explicit kind', () => {
  it('uses the third argument and marks it declared', () => {
    expect(infer([conn('a.x', 'b.y', { declared: 'clock' })])).toEqual([
      { kind: 'clock', kindSource: 'declared' },
    ]);
  });

  it('beats parameters and names', () => {
    const [result] = infer([
      conn('a.irq', 'b.irq', { declared: 'avalon', parameters: { irqNumber: '0' } }),
    ]);
    expect(result).toEqual({ kind: 'avalon', kindSource: 'declared' });
  });
});

describe('inferConnectionKinds: rule 2, connection parameters', () => {
  it('maps irqNumber to interrupt', () => {
    const [result] = infer([conn('cpu.x', 'u.y', { parameters: { irqNumber: '0' } })]);
    expect(result).toEqual({ kind: 'interrupt', kindSource: 'declared' });
  });

  it('maps baseAddress to avalon, or axi when an endpoint name contains axi', () => {
    expect(infer([conn('cpu.x', 'u.y', { parameters: { baseAddress: '0' } })])[0].kind).toBe(
      'avalon'
    );
    expect(
      infer([conn('hps_0.axi_master', 'u.axi_slave', { parameters: { baseAddress: '0' } })])[0]
    ).toEqual({ kind: 'axi', kindSource: 'declared' });
  });

  it('prefers irqNumber over baseAddress', () => {
    const [result] = infer([
      conn('a.x', 'b.y', { parameters: { baseAddress: '0', irqNumber: '1' } }),
    ]);
    expect(result.kind).toBe('interrupt');
  });
});

describe('inferConnectionKinds: AXI needs both interface names', () => {
  it('is avalon for an AXI master on an Avalon slave, by parameter and by name', () => {
    const withAddress = conn('hps_0.h2f_lw_axi_master', 'led_pio.s1', {
      parameters: { baseAddress: '0' },
    });
    expect(infer([withAddress])[0]).toEqual({ kind: 'avalon', kindSource: 'declared' });
    expect(byName('hps_0.h2f_lw_axi_master', 'led_pio.s1')).toEqual({
      kind: 'avalon',
      kindSource: 'name',
    });
  });

  it('is axi when both interface names indicate AXI', () => {
    expect(byName('hps_0.h2f_lw_axi_master', 'bridge.axi_slave')).toEqual({
      kind: 'axi',
      kindSource: 'name',
    });
  });

  it('never looks at instance names', () => {
    const [byParameter] = infer([
      conn('cpu.data_master', 'taxi_pio.s1', { parameters: { baseAddress: '0' } }),
    ]);
    expect(byParameter.kind).toBe('avalon');
    expect(byName('axi_cpu.data_master', 'taxi_pio.s1').kind).toBe('avalon');
  });
});

describe('inferConnectionKinds: rule 3, propagation', () => {
  it('gives an endpoint known from another connection to every connection on it', () => {
    const results = infer([
      conn('cpu.data_manager', 'mem.s1', { parameters: { baseAddress: '0' } }),
      conn('cpu.data_manager', 'sys.control_slave'),
      conn('cpu.dm_agent', 'sys.x'),
    ]);
    expect(results[1]).toEqual({ kind: 'avalon', kindSource: 'declared' });
    // Propagation only follows endpoints already typed, so this one falls to the names.
    expect(results[2]).toEqual({ kind: 'avalon', kindSource: 'name' });
  });

  it('iterates until nothing changes', () => {
    const results = infer([
      conn('c.p', 'd.q'),
      conn('b.p', 'c.p'),
      conn('a.p', 'b.p', { declared: 'avalon_streaming' }),
    ]);
    expect(results.map((r) => r.kind)).toEqual([
      'avalon_streaming',
      'avalon_streaming',
      'avalon_streaming',
    ]);
    expect(results[0].kindSource).toBe('declared');
  });

  it('uses the add_interface type of an exported endpoint', () => {
    const results = infer([conn('clk_0.odd', 'cpu.x')], [{ internal: 'clk_0.odd', type: 'clock' }]);
    expect(results[0]).toEqual({ kind: 'clock', kindSource: 'declared' });
  });

  it('ignores an interface that exports nothing', () => {
    expect(infer([conn('a.p', 'b.q')], [{ type: 'clock' }])[0].kindSource).toBe('default');
  });

  it('beats the interface names', () => {
    const results = infer([conn('a.p', 'b.q', { declared: 'avalon' }), conn('a.p', 'c.out_clk')]);
    expect(results[1]).toEqual({ kind: 'avalon', kindSource: 'declared' });
  });
});

describe('inferConnectionKinds: rule 4, interface names', () => {
  it.each([
    ['clk_0.out_clk', 'cpu.clk', 'clock'],
    ['clk_0.out_clk', 'onchip_mem.clk1', 'clock'],
    ['clk_0.clk', 'hps_0.h2f_lw_axi_clock', 'clock'],
    ['clk_0.clk', 'hps_0.f2h_sdram0_clock', 'clock'],
    ['bridge.out_reset', 'cpu.reset', 'reset'],
    ['bridge.out_reset', 'mem.reset1', 'reset'],
    ['hps_0.h2f_reset', 'pio.reset', 'reset'],
    ['hps_0.h2f_reset', 'clk_0.clk_in_reset', 'reset'],
    ['cpu.irq', 'x.y', 'interrupt'],
    ['hps_0.f2h_irq0', 'u.interrupt_sender', 'interrupt'],
    ['cpu.platform_irq_rx', 'uart.irq', 'interrupt'],
    ['nios2.data_master', 'mem.s1', 'avalon'],
    ['nios2.instruction_master', 'x.y', 'avalon'],
    ['niosv.data_manager', 'x.y', 'avalon'],
    ['niosv.instruction_manager', 'x.y', 'avalon'],
    ['x.y', 'niosv.dm_agent', 'avalon'],
    ['x.y', 'niosv.timer_sw_agent', 'avalon'],
    ['x.y', 'nios2.debug_mem_slave', 'avalon'],
    ['x.y', 'uart.avalon_jtag_slave', 'avalon'],
    ['x.y', 'sysid.control_slave', 'avalon'],
    ['x.y', 'pio.s1', 'avalon'],
    ['x.y', 'accel.avs', 'avalon'],
    ['accel.avm', 'x.y', 'avalon'],
    ['x.m0', 'y.z', 'avalon'],
    ['hps_0.h2f_lw_axi_master', 'x.axi_slave', 'axi'],
    ['hps_0.h2f_lw_axi_master', 'x.y', 'avalon'],
    ['ddr.f2h_sdram0_data', 'hps_0.f2h_sdram0_data', 'avalon'],
  ])('%s -> %s is %s by name', (start, end, kind) => {
    expect(byName(start, end)).toEqual({ kind, kindSource: 'name' });
  });

  it('checks the start name first within a rule', () => {
    expect(byName('a.out_clk', 'b.irq').kind).toBe('interrupt');
    expect(byName('a.out_clk', 'b.out_reset').kind).toBe('reset');
  });

  it('finds the rule on the end name when the start has none', () => {
    expect(byName('a.foo', 'b.out_reset').kind).toBe('reset');
  });

  it('checks interrupt, then reset, then clock, then memory-mapped', () => {
    expect(byName('a.irq_clk', 'b.x').kind).toBe('interrupt');
    expect(byName('a.clk_in_reset', 'b.x').kind).toBe('reset');
    expect(byName('a.axi_clock', 'b.x').kind).toBe('clock');
    expect(byName('a.master_clk', 'b.x').kind).toBe('clock');
  });

  it('only matches whole word parts', () => {
    expect(byName('a.circuit', 'b.slaveless').kind).toBe('');
    expect(byName('a.dmaster', 'b.s').kind).toBe('');
  });
});

describe('inferConnectionKinds: rule 5, default', () => {
  it('leaves the kind empty with the default source', () => {
    expect(byName('accel.status', 'accel.debug_probe')).toEqual({
      kind: '',
      kindSource: 'default',
    });
    expect(byName('instance', 'other')).toEqual({ kind: '', kindSource: 'default' });
  });
});
