/* eslint-disable */
import * as path from 'path';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { Logger } from '../../../utils/Logger';

// ---------------------------------------------------------------------------
// ipcraft-vscode#32 item 1: a register with no fields must honor its
// register-level resetValue instead of always resetting to (others => '0').
//
// SystemVerilog is not covered here: pkg.sv.j2's regs_sw2hw_t aggregate has
// no fallback branch for a fieldless register (it always references
// `<reg>_t`, which is only typedef'd when the register has fields) -- a
// pre-existing gap unrelated to reset-value handling, out of scope here.
// ---------------------------------------------------------------------------

function buildContext(resetValue: number) {
  return {
    entity_name: 'raw_core',
    data_width: 32,
    addr_width: 8,
    reg_width: 4,
    clock_port: 'clk',
    reset_port: 'rst',
    reset_active_high: true,
    registers: [
      {
        name: 'SCRATCH_RAW',
        offset: 0,
        access: 'read-write',
        reset_value: resetValue,
        fields: [],
        has_cos_fields: false,
        has_mixed_fields: false,
      },
    ],
    sw_registers: [
      {
        name: 'SCRATCH_RAW',
        offset: 0,
        access: 'read-write',
        reset_value: resetValue,
        fields: [],
      },
    ],
    hw_registers: [],
    w1c_registers: [],
    sc_registers: [],
    cos_registers: [],
    mixed_registers: [],
  };
}

describe('register-level resetValue (ipcraft-vscode#32 item 1) — VHDL package template', () => {
  const logger = new Logger('test') as any;
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  let loader: TemplateLoader;

  beforeEach(() => {
    loader = new TemplateLoader(logger, templatesPath);
  });

  it('honors a non-zero register-level resetValue for a fieldless register', () => {
    const output = loader.render('package.vhdl.j2', buildContext(0x2a));
    expect(output).toContain('scratch_raw => std_logic_vector(to_unsigned(42, C_DATA_WIDTH))');
    expect(output).not.toContain("scratch_raw => (others => '0')");
  });

  it('still resets to all-zero when resetValue is 0 (no regression)', () => {
    const output = loader.render('package.vhdl.j2', buildContext(0));
    expect(output).toContain("scratch_raw => (others => '0')");
  });
});
