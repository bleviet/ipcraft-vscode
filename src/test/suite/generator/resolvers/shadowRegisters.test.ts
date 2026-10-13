import {
  buildShadowRegisters,
  validateShadowRegisters,
} from '../../../../generator/resolvers/shadowRegisters';

function makeReg(
  name: string,
  access: string,
  fields: Array<{ name: string; access: string; monitorChangeOf?: string }>
): Record<string, unknown> {
  return {
    name,
    access,
    offset: 0,
    fields: fields.map((f) => ({
      name: f.name,
      access: f.access,
      monitorChangeOf: f.monitorChangeOf ?? null,
    })),
  };
}

describe('buildShadowRegisters', () => {
  it('splits read-write register into sw_registers only', () => {
    const reg = makeReg('CTRL', 'read-write', []);
    const result = buildShadowRegisters([reg]);
    expect(result.sw_registers).toHaveLength(1);
    expect(result.hw_registers).toHaveLength(0);
    expect(result.w1c_registers).toHaveLength(0);
    expect(result.cos_registers).toHaveLength(0);
  });

  it('splits read-only register into hw_registers only', () => {
    const reg = makeReg('STATUS', 'read-only', []);
    const result = buildShadowRegisters([reg]);
    expect(result.sw_registers).toHaveLength(0);
    expect(result.hw_registers).toHaveLength(1);
  });

  it('annotates registers with has_cos_fields', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'SRC', access: 'write-1-to-clear' },
      {
        name: 'EDGE',
        access: 'write-1-to-clear',
        monitorChangeOf: 'SRC',
      },
    ]);
    const result = buildShadowRegisters([reg]);
    const annotated = result.registers[0];
    expect(annotated.has_cos_fields).toBe(true);
    expect(result.cos_registers).toHaveLength(1);
  });

  it('annotates w1c fields with is_cos flag', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'SRC', access: 'write-1-to-clear' },
      {
        name: 'EDGE',
        access: 'write-1-to-clear',
        monitorChangeOf: 'SRC',
      },
    ]);
    const result = buildShadowRegisters([reg]);
    const w1cFields = result.w1c_registers[0].fields as Array<Record<string, unknown>>;
    expect(w1cFields.find((f) => f.name === 'SRC')?.is_cos).toBe(false);
    expect(w1cFields.find((f) => f.name === 'EDGE')?.is_cos).toBe(true);
  });

  it('uses per-field read composition without inventing hardware value ports', () => {
    const reg = makeReg('MIXED', 'read-write', [
      { name: 'VISIBLE', access: 'read-write' },
      { name: 'COMMAND', access: 'write-only' },
      { name: 'EVENT', access: 'write-1-to-clear' },
      { name: 'TRIGGER', access: 'write-self-clearing' },
    ]);
    const result = buildShadowRegisters([reg]);

    expect(result.registers[0].has_mixed_fields).toBe(true);
    expect(result.mixed_registers).toHaveLength(0);
  });

  it('throws when monitorChangeOf access is not w1c', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'SRC', access: 'read-write' },
      { name: 'EDGE', access: 'read-write', monitorChangeOf: 'SRC' },
    ]);
    expect(() => buildShadowRegisters([reg])).toThrow('not write-1-to-clear');
  });

  it('throws when monitorChangeOf target field does not exist', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'EDGE', access: 'write-1-to-clear', monitorChangeOf: 'NONEXISTENT' },
    ]);
    expect(() => buildShadowRegisters([reg])).toThrow('no such field');
  });
});

describe('buildShadowRegisters register plan (issue #238)', () => {
  const plan = (reg: Record<string, unknown>) => {
    const r = buildShadowRegisters([reg]).registers[0] as Record<string, any>;
    return {
      needsWrite: r.needs_write_branch,
      writeFields: (r.write_fields as Array<{ name: string }>).map((f) => f.name),
      readSource: r.read_source,
    };
  };

  it('A: register read-write + all read-only fields reads regs_in, no write branch', () => {
    expect(
      plan(makeReg('STATUS_A', 'read-write', [{ name: 'BUSY', access: 'read-only' }]))
    ).toEqual({ needsWrite: false, writeFields: [], readSource: 'regs_in' });
  });

  it('B: no register access + all read-only fields behaves like A', () => {
    const reg = makeReg('STATUS_B', 'read-write', [{ name: 'BUSY', access: 'read-only' }]);
    delete reg.access;
    expect(plan(reg)).toEqual({ needsWrite: false, writeFields: [], readSource: 'regs_in' });
  });

  it('C: register read-write + all write-1-to-clear fields has no write branch', () => {
    expect(
      plan(makeReg('EVENTS_C', 'read-write', [{ name: 'FLAG', access: 'write-1-to-clear' }]))
    ).toEqual({ needsWrite: false, writeFields: [], readSource: 'composed' });
  });

  it('D: register read-only + read-write field has a write branch and reads regs', () => {
    expect(plan(makeReg('CTRL_D', 'read-only', [{ name: 'EN', access: 'read-write' }]))).toEqual({
      needsWrite: true,
      writeFields: ['EN'],
      readSource: 'regs',
    });
  });

  it('E: register write-only + all read-only fields reads regs_in, no write branch', () => {
    expect(
      plan(makeReg('STATUS_E', 'write-only', [{ name: 'BUSY', access: 'read-only' }]))
    ).toEqual({ needsWrite: false, writeFields: [], readSource: 'regs_in' });
  });

  it('F: mixed read-write + read-only fields writes only the rw field and reads composed', () => {
    expect(
      plan(
        makeReg('MIXED_F', 'read-write', [
          { name: 'EN', access: 'read-write' },
          { name: 'BUSY', access: 'read-only' },
        ])
      )
    ).toEqual({ needsWrite: true, writeFields: ['EN'], readSource: 'composed' });
  });

  it('treats a missing field access as read-write', () => {
    const reg = makeReg('CTRL', 'read-only', [{ name: 'EN', access: 'read-write' }]);
    delete (reg.fields as Array<Record<string, unknown>>)[0].access;
    expect(plan(reg)).toEqual({ needsWrite: true, writeFields: ['EN'], readSource: 'regs' });
  });

  it.each([
    ['read-write', true, 'regs'],
    ['rw', true, 'regs'],
    ['write-only', true, 'none'],
    ['wo', true, 'none'],
    ['read-only', false, 'regs_in'],
    ['ro', false, 'regs_in'],
    ['read-write-1-to-clear', false, 'regs'],
    ['read-write-self-clearing', false, 'regs'],
    ['write-1-to-clear', false, 'none'],
    ['write-self-clearing', false, 'none'],
  ])('field-less register with access %s', (access, needsWrite, readSource) => {
    expect(plan(makeReg('R', access, []))).toEqual({
      needsWrite,
      writeFields: [],
      readSource,
    });
  });
});

describe('validateShadowRegisters', () => {
  it('returns no diagnostics for valid registers', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'SRC', access: 'write-1-to-clear' },
      {
        name: 'EDGE',
        access: 'write-1-to-clear',
        monitorChangeOf: 'SRC',
      },
    ]);
    expect(validateShadowRegisters([reg])).toHaveLength(0);
  });

  it('returns diagnostic for invalid access', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'SRC', access: 'read-write' },
      { name: 'EDGE', access: 'read-write', monitorChangeOf: 'SRC' },
    ]);
    const diags = validateShadowRegisters([reg]);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toMatch('requires write-1-to-clear or read-write-1-to-clear access');
  });

  it('returns diagnostic for missing target field', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'EDGE', access: 'write-1-to-clear', monitorChangeOf: 'GHOST' },
    ]);
    const diags = validateShadowRegisters([reg]);
    expect(diags.some((d) => d.message.includes('no such field'))).toBe(true);
  });
});

describe('buildShadowRegisters constants ($version)', () => {
  const constant = (name: string) => ({
    name,
    access: 'read-only',
    monitorChangeOf: null,
    is_constant: true,
  });
  const plain = (name: string, access: string) => ({ name, access, monitorChangeOf: null });
  const reg = (name: string, fields: Array<Record<string, unknown>>, access = 'read-only') => ({
    name,
    access,
    offset: 0,
    is_constant: fields.length > 0 && fields.every((f) => f.is_constant === true),
    fields,
  });
  const names = (list: Array<Record<string, unknown>>) => list.map((r) => r.name);

  it('(a) a register of only constant fields is read from literals, not stored or driven', () => {
    const result = buildShadowRegisters([reg('VERSION', [constant('MAJOR'), constant('MINOR')])]);
    const [annotated] = result.registers;
    expect(annotated.read_source).toBe('constant');
    expect(annotated.has_mixed_fields).toBe(false);
    expect(annotated.needs_write_branch).toBe(false);
    expect(result.hw_registers).toHaveLength(0);
    expect(result.sw_registers).toHaveLength(0);
    expect(result.mixed_registers).toHaveLength(0);
  });

  it('(b) a fieldless register-level $version is a constant register too', () => {
    const versionReg = { name: 'VERSION', access: 'read-only', offset: 0, is_constant: true };
    const result = buildShadowRegisters([{ ...versionReg, fields: [] }]);
    const [annotated] = result.registers;
    expect(annotated.read_source).toBe('constant');
    expect(annotated.needs_write_branch).toBe(false);
    expect(result.hw_registers).toHaveLength(0);
  });

  it('(c) a constant next to a read-write field is read-composed with no hardware value port', () => {
    const result = buildShadowRegisters([
      reg('CTRL', [constant('REV'), plain('EN', 'read-write')], 'read-write'),
    ]);
    const [annotated] = result.registers as Array<Record<string, any>>;
    expect(annotated.read_source).toBe('composed');
    expect(annotated.has_mixed_fields).toBe(true);
    expect(names(annotated.write_fields as Array<Record<string, unknown>>)).toEqual(['EN']);
    expect(names(result.sw_registers)).toEqual(['CTRL']);
    expect(result.mixed_registers).toHaveLength(0);
  });

  it('(d) a constant next to a hardware read-only field keeps only the hardware field in val_fields', () => {
    const result = buildShadowRegisters([reg('STATUS', [constant('REV'), plain('BUSY', 'ro')])]);
    const [annotated] = result.registers as Array<Record<string, any>>;
    expect(annotated.read_source).toBe('composed');
    expect(annotated.has_mixed_fields).toBe(true);
    expect(annotated.needs_write_branch).toBe(false);
    expect(result.hw_registers).toHaveLength(0);
    expect(result.sw_registers).toHaveLength(0);
    expect(names(result.mixed_registers)).toEqual(['STATUS']);
    expect(names(result.mixed_registers[0].val_fields as Array<Record<string, unknown>>)).toEqual([
      'BUSY',
    ]);
  });

  it('a constant in a mixed read-write / read-only register is never a val field', () => {
    const result = buildShadowRegisters([
      reg(
        'MIX',
        [constant('REV'), plain('EN', 'read-write'), plain('BUSY', 'read-only')],
        'read-write'
      ),
    ]);
    expect(names(result.mixed_registers[0].val_fields as Array<Record<string, unknown>>)).toEqual([
      'BUSY',
    ]);
  });

  it('registers without constants keep their classification', () => {
    const result = buildShadowRegisters([
      makeReg('STATUS', 'read-only', [{ name: 'BUSY', access: 'read-only' }]),
    ]);
    expect(result.hw_registers).toHaveLength(1);
    expect(result.registers[0].read_source).toBe('regs_in');
  });
});
