import { ipName, knownOutput, KNOWN_OUTPUT_PINS } from '../../../domain/knownIpPins';
import type { SystemInstance } from '../../../domain/systemGraph';

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

const ip = (name: string): SystemInstance => instance({ vlnv: `xilinx.com:ip:${name}:1.0` });

/** Whether a pattern source has a `|` outside any group or character class, as `^a|b$` has. */
function hasTopLevelAlternation(source: string): boolean {
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '\\') {
      i++;
    } else if (inClass) {
      inClass = char !== ']';
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      depth++;
    } else if (char === ')') {
      depth--;
    } else if (char === '|' && depth === 0) {
      return true;
    }
  }
  return false;
}

describe('ipName', () => {
  it('takes the VLNV name of an AMD IP, else the Platform Designer module kind', () => {
    expect(ipName(instance({ vlnv: 'xilinx.com:ip:clk_wiz:6.0' }))).toBe('clk_wiz');
    expect(ipName(instance({ component: 'clock_source', version: '18.1' }))).toBe('clock_source');
  });

  it('falls back to the component for a VLNV without a name part', () => {
    expect(ipName(instance({ vlnv: 'weird', component: 'kind' }))).toBe('kind');
  });

  it('has no name for a module reference or a hierarchy: no rule applies to them', () => {
    expect(ipName(instance({ kind: 'module', moduleRef: 'pulse_gen' }))).toBeUndefined();
    expect(ipName(instance({ kind: 'module', moduleRef: 'clk_wiz' }))).toBeUndefined();
    expect(ipName(instance({ kind: 'hier' }))).toBeUndefined();
  });

  it('has no name for an IP of another vendor', () => {
    expect(ipName(instance({ vlnv: 'acme.com:user:proc_sys_reset:1.0' }))).toBeUndefined();
    expect(ipName(instance({ vlnv: 'xilinx.com.evil:ip:proc_sys_reset:1.0' }))).toBeUndefined();
  });
});

describe('knownOutput', () => {
  it.each([
    ['processing_system7', 'FCLK_CLK0'],
    ['processing_system7', 'FCLK_CLK3'],
    ['zynq_ultra_ps_e', 'pl_clk1'],
    ['versal_cips', 'pl0_ref_clk'],
    ['clk_wiz', 'clk_out4'],
    ['clk_wizard', 'clk_out2'],
    ['clk_wizard', 'clk_out1_o1'],
    ['clk_wizard', 'clk_out1_o4'],
  ])('knows the clock output %s %s', (name, pin) => {
    expect(knownOutput(ip(name), pin)).toBe(true);
  });

  it.each([
    ['proc_sys_reset', 'peripheral_aresetn'],
    ['proc_sys_reset', 'interconnect_aresetn'],
    ['proc_sys_reset', 'peripheral_reset'],
    ['proc_sys_reset', 'bus_struct_reset'],
    ['proc_sys_reset', 'mb_reset'],
    ['processing_system7', 'FCLK_RESET0_N'],
    ['zynq_ultra_ps_e', 'pl_resetn0'],
    ['versal_cips', 'pl0_resetn'],
  ])('knows the reset output %s %s', (name, pin) => {
    expect(knownOutput(ip(name), pin)).toBe(true);
  });

  it.each([
    ['clk_wiz', 'locked'],
    ['clk_wizard', 'locked'],
  ])('knows the status output %s %s', (name, pin) => {
    expect(knownOutput(ip(name), pin)).toBe(true);
  });

  it.each([
    ['xlconstant', 'dout'],
    ['util_vector_logic', 'Res'],
    ['util_reduced_logic', 'Res'],
    ['axi_gpio', 'gpio_io_o'],
    ['axi_gpio', 'gpio2_io_o'],
  ])('knows the logic output %s %s', (name, pin) => {
    expect(knownOutput(ip(name), pin)).toBe(true);
  });

  it.each([
    ['clk_wizard', 'clk_in1'],
    ['clk_wizard', 'resetn'],
    ['clk_wizard', 'clk_out1_ce'],
    ['clk_wizard', 'clk_out1_clr_n'],
    ['clk_wiz', 'clk_out1_o1'],
    ['clk_wiz', 'reset'],
    ['proc_sys_reset', 'slowest_sync_clk'],
    ['proc_sys_reset', 'ext_reset_in'],
    ['proc_sys_reset', 'dcm_locked'],
    ['processing_system7', 'M_AXI_GP0_ACLK'],
    ['xlconstant', 'dout_1'],
    ['util_vector_logic', 'Op1'],
    ['axi_gpio', 'gpio_io_i'],
  ])('does not take the input or other pin %s %s', (name, pin) => {
    expect(knownOutput(ip(name), pin)).toBe(false);
  });

  it('matches the exact IP and the exact pin name', () => {
    expect(knownOutput(ip('other_wizard'), 'clk_out1')).toBe(false);
    expect(knownOutput(ip('clk_wizard'), 'my_clk_out1')).toBe(false);
    expect(knownOutput(ip('clk_wizard'), 'clk_out1_extra')).toBe(false);
    expect(knownOutput(instance({ kind: 'hier' }), 'clk_out1')).toBe(false);
  });

  it('matches AMD IP instances only, never a module reference or another vendor', () => {
    expect(knownOutput(instance({ kind: 'module', moduleRef: 'clk_wiz' }), 'clk_out1')).toBe(false);
    expect(
      knownOutput(instance({ vlnv: 'acme.com:user:proc_sys_reset:1.0' }), 'peripheral_aresetn')
    ).toBe(false);
  });

  it('lists no Platform Designer pin: a .qsys declares every direction', () => {
    expect(knownOutput(instance({ component: 'clock_source' }), 'clk')).toBe(false);
    expect(knownOutput(instance({ component: 'clock_source' }), 'clk_reset')).toBe(false);
    expect(knownOutput(instance({ component: 'altera_clock_bridge' }), 'out_clk')).toBe(false);
  });

  it('keeps every rule anchored as a whole, so a pin name is never matched by a part of it', () => {
    expect(hasTopLevelAlternation('^a|b$')).toBe(true);
    expect(hasTopLevelAlternation('^(?:a|b)$')).toBe(false);
    expect(hasTopLevelAlternation('^[|]a\\|$')).toBe(false);
    for (const rule of KNOWN_OUTPUT_PINS) {
      expect(rule.pin.source.startsWith('^')).toBe(true);
      expect(rule.pin.source.endsWith('$')).toBe(true);
      expect(hasTopLevelAlternation(rule.pin.source)).toBe(false);
    }
  });
});
