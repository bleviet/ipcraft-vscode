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
    expect(diags[0].message).toMatch('write-1-to-clear');
  });

  it('returns diagnostic for missing target field', () => {
    const reg = makeReg('IRQ', 'read-write', [
      { name: 'EDGE', access: 'write-1-to-clear', monitorChangeOf: 'GHOST' },
    ]);
    const diags = validateShadowRegisters([reg]);
    expect(diags.some((d) => d.message.includes('no such field'))).toBe(true);
  });
});
