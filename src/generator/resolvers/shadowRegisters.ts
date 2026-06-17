import type { ContextResolver, ResolverInput, ContractDiagnostic } from './types';

const W1C_ACCESS = new Set(['write-1-to-clear', 'read-write-1-to-clear']);

function getString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && 'value' in value) {
    return String((value as Record<string, unknown>).value);
  }
  return String(value);
}

export interface ShadowRegisterResult {
  sw_registers: Array<Record<string, unknown>>;
  hw_registers: Array<Record<string, unknown>>;
  w1c_registers: Array<Record<string, unknown>>;
  sc_registers: Array<Record<string, unknown>>;
  cos_registers: Array<Record<string, unknown>>;
  registers: Array<Record<string, unknown>>;
}

export interface ShadowValidationError {
  readonly field: string;
  readonly message: string;
}

/** Validate and compute all shadow register slices. Throws on CoS configuration errors. */
export function buildShadowRegisters(
  baseRegisters: readonly Record<string, unknown>[]
): ShadowRegisterResult {
  const swAccess = new Set([
    'read-write',
    'write-only',
    'rw',
    'wo',
    'read-write-1-to-clear',
    'write-1-to-clear',
    'read-write-self-clearing',
    'write-self-clearing',
  ]);
  const hwAccess = new Set(['read-only', 'ro']);
  const scAccess = new Set(['write-self-clearing', 'read-write-self-clearing']);

  const registers = baseRegisters as Array<Record<string, unknown>>;

  const swRegisters = registers.filter((reg) => {
    const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
    if (fields.length === 0) {
      return !hwAccess.has(getString(reg.access) || 'read-write');
    }
    return fields.some((f) => swAccess.has(getString(f.access) || 'read-write'));
  });
  const hwRegisters = registers.filter((reg) => {
    const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
    if (fields.length === 0) {
      return hwAccess.has(getString(reg.access) || 'read-write');
    }
    return fields.every((f) => hwAccess.has(getString(f.access) || 'read-write'));
  });
  const w1cRegisters = registers.filter((reg) => {
    const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
    return fields.some((f) => W1C_ACCESS.has(getString(f.access)));
  });

  const scRegisters = registers.filter((reg) => {
    const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
    return fields.some((f) => scAccess.has(getString(f.access)));
  });

  const cosRegisters = registers
    .map((reg) => {
      const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
      const cosFields = fields
        .filter((f) => getString(f['monitorChangeOf']) !== '')
        .map((field) => {
          const targetName = getString(field['monitorChangeOf']);
          if (!W1C_ACCESS.has(getString(field.access))) {
            throw new Error(
              `Field "${getString(field.name)}" in register "${getString(reg.name)}" uses monitorChangeOf but access type "${getString(field.access)}" is not write-1-to-clear or read-write-1-to-clear.`
            );
          }
          const monitoredField =
            fields.find((f) => getString(f.name as string) === targetName) ?? null;
          if (!monitoredField) {
            throw new Error(
              `Field "${getString(field.name)}" in register "${getString(reg.name)}" references monitorChangeOf: "${targetName}" but no such field exists in the same register.`
            );
          }
          return { ...field, monitored_field: monitoredField };
        });

      if (cosFields.length === 0) {
        return null;
      }

      const seen = new Set<string>();
      const valFields = cosFields
        .map((cf) => cf.monitored_field)
        .filter((mf) => {
          if (!mf) {
            return false;
          }
          const n = getString(mf.name);
          if (seen.has(n)) {
            return false;
          }
          seen.add(n);
          return true;
        });

      return { ...reg, cos_fields: cosFields, val_fields: valFields };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const cosRegNames = new Set(
    cosRegisters.map((r) => getString((r as Record<string, unknown>).name))
  );

  const annotatedW1cRegisters = w1cRegisters.map((reg) => {
    const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
    return {
      ...reg,
      fields: fields.map((field) => ({
        ...field,
        is_cos: getString(field['monitorChangeOf']) !== '',
      })),
    };
  });

  const annotatedRegisters = registers.map((reg) => ({
    ...reg,
    has_cos_fields: cosRegNames.has(getString(reg.name)),
  }));

  return {
    registers: annotatedRegisters,
    sw_registers: swRegisters,
    hw_registers: hwRegisters,
    w1c_registers: annotatedW1cRegisters,
    sc_registers: scRegisters,
    cos_registers: cosRegisters,
  };
}

export function validateShadowRegisters(
  baseRegisters: readonly Record<string, unknown>[]
): readonly ContractDiagnostic[] {
  const diagnostics: ContractDiagnostic[] = [];
  for (const reg of baseRegisters) {
    const fields = (reg.fields as Array<Record<string, unknown>>) ?? [];
    for (const field of fields) {
      const targetName = getString(field['monitorChangeOf']);
      if (!targetName) {
        continue;
      }
      if (!W1C_ACCESS.has(getString(field.access))) {
        diagnostics.push({
          field: `${getString(reg.name)}.${getString(field.name)}`,
          message: `monitorChangeOf requires write-1-to-clear access, got "${getString(field.access)}"`,
        });
      }
      const exists = fields.some((f) => getString(f.name as string) === targetName);
      if (!exists) {
        diagnostics.push({
          field: `${getString(reg.name)}.${getString(field.name)}`,
          message: `monitorChangeOf: "${targetName}" — no such field in register`,
        });
      }
    }
  }
  return diagnostics;
}

export const shadowRegistersResolver: ContextResolver = {
  name: 'shadowRegisters',

  resolve({ registers }: ResolverInput): Record<string, unknown> {
    const result = buildShadowRegisters(registers);
    return result as unknown as Record<string, unknown>;
  },
};
