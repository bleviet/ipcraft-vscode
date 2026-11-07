import type { SystemInstance, SystemPin } from '../../../../domain/systemGraph';
import {
  boundaryFrequency,
  CLOCK_OUTPUT_RULES,
  CLOCK_SOURCE_RULES,
  generatorOf,
  ipName,
  isAsyncResetSink,
  isClockOutput,
  isNotClockPin,
  passThroughOf,
  resetRelease,
  sourceFrequency,
} from '../../../../webview/systemDiagram/clocks/clockRules';

function instance(overrides: Partial<SystemInstance>): SystemInstance {
  return {
    path: '/x',
    name: 'x',
    parent: '/',
    kind: 'ip',
    parameters: {},
    pins: [],
    line: 1,
    ...overrides,
  };
}

describe('ipName', () => {
  it('takes the VLNV name, else the Platform Designer kind, else the module reference', () => {
    expect(ipName(instance({ vlnv: 'xilinx.com:ip:clk_wiz:6.0' }))).toBe('clk_wiz');
    expect(ipName(instance({ component: 'clock_source', version: '18.1' }))).toBe('clock_source');
    expect(ipName(instance({ kind: 'module', moduleRef: 'pulse_gen' }))).toBe('pulse_gen');
    expect(ipName(instance({ kind: 'hier' }))).toBeUndefined();
  });

  it('falls back to the component for a VLNV without a name part', () => {
    expect(ipName(instance({ vlnv: 'weird', component: 'kind' }))).toBe('kind');
  });
});

describe('isClockOutput', () => {
  it.each([
    ['xilinx.com:ip:processing_system7:5.5', 'FCLK_CLK2'],
    ['xilinx.com:ip:zynq_ultra_ps_e:3.5', 'pl_clk1'],
    ['xilinx.com:ip:versal_cips:3.4', 'pl0_ref_clk'],
    ['xilinx.com:ip:clk_wiz:6.0', 'clk_out3'],
    ['xilinx.com:ip:clk_wizard:1.0', 'clk_out2'],
    ['xilinx.com:ip:clk_wizard:1.0', 'clk_out1_o4'],
  ])('knows %s %s as a clock output', (vlnv, pin) => {
    expect(isClockOutput(instance({ vlnv }), pin)).toBe(true);
  });

  it.each([
    ['clock_source', 'clk'],
    ['altera_clock_bridge', 'out_clk'],
  ])('knows the Platform Designer %s %s as a clock output', (component, pin) => {
    expect(isClockOutput(instance({ component }), pin)).toBe(true);
  });

  it('does not take an input, a status output or another IP', () => {
    const wizard = instance({ vlnv: 'xilinx.com:ip:clk_wizard:1.0' });
    expect(isClockOutput(wizard, 'clk_in1')).toBe(false);
    expect(isClockOutput(wizard, 'locked')).toBe(false);
    expect(isClockOutput(instance({ vlnv: 'xilinx.com:ip:clk_wiz:6.0' }), 'clk_out1_o1')).toBe(
      false
    );
    expect(isClockOutput(instance({ vlnv: 'a:b:other:1' }), 'clk_out1')).toBe(false);
  });

  it('covers every pin that CLOCK_SOURCE_RULES gives a frequency', () => {
    const examples: Record<string, string> = {
      processing_system7: 'FCLK_CLK0',
      zynq_ultra_ps_e: 'pl_clk0',
      clk_wiz: 'clk_out1',
      clock_source: 'clk',
    };
    for (const rule of CLOCK_SOURCE_RULES) {
      expect(rule.pin.test(examples[rule.ip])).toBe(true);
      expect(
        CLOCK_OUTPUT_RULES.some(
          (output) => output.ip === rule.ip && output.pin.test(examples[rule.ip])
        )
      ).toBe(true);
    }
  });
});

describe('isNotClockPin', () => {
  it.each([
    ['xilinx.com:ip:clk_wiz:6.0', 'locked'],
    ['xilinx.com:ip:clk_wizard:1.0', 'locked'],
    ['xilinx.com:ip:proc_sys_reset:5.0', 'dcm_locked'],
  ])('knows %s %s as a status, not a clock', (vlnv, pin) => {
    expect(isNotClockPin(instance({ vlnv }), pin)).toBe(true);
  });

  it('knows no other pin', () => {
    expect(isNotClockPin(instance({ vlnv: 'xilinx.com:ip:clk_wiz:6.0' }), 'clk_out1')).toBe(false);
    expect(isNotClockPin(instance({ vlnv: 'a:b:other:1' }), 'locked')).toBe(false);
  });
});

describe('generatorOf', () => {
  it('names the clocking wizards and their input pins', () => {
    for (const name of ['clk_wiz', 'clk_wizard']) {
      const rule = generatorOf(instance({ vlnv: `xilinx.com:ip:${name}:1.0` }));
      expect(rule?.input.test('clk_in1')).toBe(true);
      expect(rule?.input.test('clk_in2')).toBe(true);
      expect(rule?.input.test('clk_in1_p')).toBe(true);
      expect(rule?.input.test('s_axi_aclk')).toBe(false);
      expect(rule?.input.test('clk_out1')).toBe(false);
    }
  });

  it('does not take a PS clock source as a generator', () => {
    expect(generatorOf(instance({ vlnv: 'xilinx.com:ip:processing_system7:5.5' }))).toBeUndefined();
    expect(generatorOf(instance({ vlnv: 'xilinx.com:ip:versal_cips:3.4' }))).toBeUndefined();
  });
});

describe('sourceFrequency', () => {
  it.each([
    [
      'xilinx.com:ip:processing_system7:5.5',
      'FCLK_CLK2',
      'CONFIG.PCW_FPGA2_PERIPHERAL_FREQMHZ',
      '50',
      50e6,
    ],
    [
      'xilinx.com:ip:zynq_ultra_ps_e:3.5',
      'pl_clk1',
      'CONFIG.PSU__CRL_APB__PL1_REF_CTRL__FREQMHZ',
      '250.0',
      250e6,
    ],
    ['xilinx.com:ip:clk_wiz:6.0', 'clk_out3', 'CONFIG.CLKOUT3_REQUESTED_OUT_FREQ', '300', 300e6],
  ])('reads %s %s from %s', (vlnv, pin, parameter, value, hz) => {
    expect(sourceFrequency(instance({ vlnv, parameters: { [parameter]: value } }), pin)).toEqual({
      hz,
      parameter,
      value,
    });
  });

  it('reads a Platform Designer clock_source in Hz', () => {
    const source = instance({
      component: 'clock_source',
      parameters: { clockFrequency: '50000000' },
    });
    expect(sourceFrequency(source, 'clk')).toEqual({
      hz: 50e6,
      parameter: 'clockFrequency',
      value: '50000000',
    });
  });

  it('is unknown without the parameter, without a rule, or for a pin the rule does not name', () => {
    const ps7 = 'xilinx.com:ip:processing_system7:5.5';
    expect(sourceFrequency(instance({ vlnv: ps7 }), 'FCLK_CLK0')).toBeUndefined();
    expect(
      sourceFrequency(
        instance({ vlnv: ps7, parameters: { 'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ': '100' } }),
        'M_AXI_GP0_ACLK'
      )
    ).toBeUndefined();
    expect(sourceFrequency(instance({ vlnv: 'a:b:other:1' }), 'FCLK_CLK0')).toBeUndefined();
  });

  it('is unknown for a value that is not a number', () => {
    const source = instance({
      vlnv: 'xilinx.com:ip:processing_system7:5.5',
      parameters: { 'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ': '$freq' },
    });
    expect(sourceFrequency(source, 'FCLK_CLK0')).toBeUndefined();
  });
});

describe('boundaryFrequency', () => {
  const pin = (parameters: Record<string, string>): SystemPin => ({
    name: 'ext_clk',
    isInterface: false,
    direction: 'in',
    directionSource: 'declared',
    parameters,
  });

  it('reads CONFIG.FREQ_HZ in Hz', () => {
    expect(boundaryFrequency(pin({ 'CONFIG.FREQ_HZ': '125000000' }))).toEqual({
      hz: 125e6,
      parameter: 'CONFIG.FREQ_HZ',
      value: '125000000',
    });
  });

  it('is unknown without a usable value', () => {
    expect(boundaryFrequency(pin({}))).toBeUndefined();
    expect(boundaryFrequency(pin({ 'CONFIG.FREQ_HZ': 'fast' }))).toBeUndefined();
  });
});

describe('passThroughOf', () => {
  it('knows the Platform Designer clock_source only', () => {
    expect(passThroughOf(instance({ component: 'clock_source' }))).toEqual({
      ip: 'clock_source',
      input: 'clk_in',
      output: 'clk',
    });
    expect(passThroughOf(instance({ component: 'altera_clock_bridge' }))).toBeUndefined();
  });
});

describe('resetRelease', () => {
  const sys = instance({ vlnv: 'xilinx.com:ip:proc_sys_reset:5.0' });

  it.each([
    'peripheral_aresetn',
    'interconnect_aresetn',
    'peripheral_reset',
    'bus_struct_reset',
    'mb_reset',
  ])('releases proc_sys_reset %s on slowest_sync_clk', (pin) => {
    expect(resetRelease(sys, pin)).toEqual({
      async: false,
      clockPin: 'slowest_sync_clk',
      from: 'proc_sys_reset slowest_sync_clk',
    });
  });

  it('knows no other proc_sys_reset output', () => {
    expect(resetRelease(sys, 'ext_reset_in')).toBeUndefined();
  });

  it('knows the output of a constant: it never toggles, so no clock releases it', () => {
    const constant = instance({ vlnv: 'xilinx.com:ip:xlconstant:1.1' });
    expect(resetRelease(constant, 'dout')).toEqual({
      async: false,
      constant: true,
      from: 'xlconstant, tied to a constant',
    });
    expect(resetRelease(constant, 'dout_1')).toBeUndefined();
    expect(resetRelease(constant, 'Dout')).toBeUndefined();
  });

  it.each([
    ['util_vector_logic', 'Res', 'util_vector_logic, logic output'],
    ['util_reduced_logic', 'Res', 'util_reduced_logic, logic output'],
    ['axi_gpio', 'gpio_io_o', 'axi_gpio, GPIO output'],
    ['axi_gpio', 'gpio2_io_o', 'axi_gpio, GPIO output'],
  ])('knows %s %s as a driver that no rule ties to a clock', (name, pin, from) => {
    expect(resetRelease(instance({ vlnv: `xilinx.com:ip:${name}:1.0` }), pin)).toEqual({
      async: false,
      from,
    });
  });

  it.each([
    ['util_vector_logic', 'Op1'],
    ['util_vector_logic', 'res'],
    ['util_reduced_logic', 'Op1'],
    ['axi_gpio', 'gpio_io_t'],
    ['axi_gpio', 'gpio_io_i'],
    ['axi_gpio', 'gpio3_io_o'],
    ['axi_gpio', 'gpio_io_o2'],
    ['other_ip', 'Res'],
  ])('knows no output %s %s', (name, pin) => {
    expect(resetRelease(instance({ vlnv: `xilinx.com:ip:${name}:1.0` }), pin)).toBeUndefined();
  });

  it.each([
    ['xilinx.com:ip:processing_system7:5.5', 'FCLK_RESET3_N'],
    ['xilinx.com:ip:zynq_ultra_ps_e:3.5', 'pl_resetn0'],
    ['xilinx.com:ip:versal_cips:3.4', 'pl0_resetn'],
  ])('treats %s %s as asynchronous', (vlnv, pin) => {
    expect(resetRelease(instance({ vlnv }), pin)).toEqual({
      async: true,
      from: 'PS reset, asynchronous',
    });
  });

  it.each([
    ['DEASSERT', false],
    ['BOTH', false],
    ['NONE', true],
    ['ASSERT', true],
    [undefined, true],
  ])('releases clock_source clk_reset with resetSynchronousEdges %s (async %s)', (edges, async) => {
    const source = instance({
      component: 'clock_source',
      parameters: edges === undefined ? {} : { resetSynchronousEdges: edges },
    });
    const release = resetRelease(source, 'clk_reset');
    expect(release?.async).toBe(async);
    expect(release?.clockPin).toBe(async ? undefined : 'clk');
    expect(release?.from).toBe(
      `clock_source resetSynchronousEdges ${edges === undefined ? 'not set' : `= ${edges}`}`
    );
  });
});

describe('isAsyncResetSink', () => {
  it('accepts the proc_sys_reset asynchronous inputs only', () => {
    const sys = instance({ vlnv: 'xilinx.com:ip:proc_sys_reset:5.0' });
    expect(isAsyncResetSink(sys, 'ext_reset_in')).toBe(true);
    expect(isAsyncResetSink(sys, 'aux_reset_in')).toBe(true);
    expect(isAsyncResetSink(sys, 'slowest_sync_clk')).toBe(false);
    const source = instance({ component: 'clock_source' });
    expect(isAsyncResetSink(source, 'clk_in_reset')).toBe(true);
    expect(isAsyncResetSink(source, 'clk_reset')).toBe(false);
    expect(isAsyncResetSink(instance({ vlnv: 'a:b:other:1' }), 'ext_reset_in')).toBe(false);
  });

  it.each(['clk_wiz', 'clk_wizard'])('accepts the %s reset inputs', (name) => {
    const wizard = instance({ vlnv: `xilinx.com:ip:${name}:1.0` });
    expect(isAsyncResetSink(wizard, 'reset')).toBe(true);
    expect(isAsyncResetSink(wizard, 'resetn')).toBe(true);
    expect(isAsyncResetSink(wizard, 'clk_in1')).toBe(false);
  });
});
