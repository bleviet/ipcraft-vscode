import type { MemoryMap, AddressBlock } from '../types/memoryMap';

/**
 * Normalized field type
 */
export type NormalizedField = {
  name: string;
  bit_offset: number;
  bit_width: number;
  access?: string;
  reset_value?: number | null;
  description?: string;
  enumerated_values?: Record<string, string>;
};

/**
 * Normalized register type
 */
export type NormalizedRegister = {
  name: string;
  address_offset: number;
  size?: number;
  access?: string;
  reset_value?: number;
  description?: string;
  fields?: NormalizedField[];
};

/**
 * Normalized register array type
 */
export type NormalizedRegisterArray = {
  __kind: 'array';
  name: string;
  address_offset: number;
  count: number;
  stride: number;
  description?: string;
  registers: NormalizedRegister[];
};

/**
 * Utility functions for normalizing memory map data from various formats
 */
export class DataNormalizer {
  /**
   * Parse a value to a number with fallback
   */
  static parseNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (!s) {
        return fallback;
      }
      const n = Number.parseInt(s, 0);
      return Number.isFinite(n) ? n : fallback;
    }
    return fallback;
  }

  /**
   * Get default register bytes from a block
   */
  static getDefaultRegBytes(block: Record<string, unknown>): number {
    const bits = DataNormalizer.parseNumber(
      (block.defaultRegWidth ?? block.default_reg_width ?? 32),
      32
    );
    const bytes = Math.max(1, Math.floor(bits / 8));
    return bytes;
  }

  /**
   * Normalize a field object
   */
  static normalizeField(field: Record<string, unknown>): NormalizedField {
    // Parse bits field if it's a string like "[31:0]" or "[0:0]"
    let bit_offset = (field.bit_offset as number) || 0;
    let bit_width = (field.bit_width as number) || 1;

    if (field.bits && typeof field.bits === 'string') {
      const match = (field.bits as string).match(/\[(\d+)(?::(\d+))?\]/);
      if (match) {
        const high = parseInt(match[1], 10);
        const low = match[2] ? parseInt(match[2], 10) : high;
        bit_offset = Math.min(low, high);
        bit_width = Math.abs(high - low) + 1;
      }
    }

    // Ensure numeric values are valid
    bit_offset = Number.isFinite(Number(bit_offset)) ? Number(bit_offset) : 0;
    bit_width = Number.isFinite(Number(bit_width)) && Number(bit_width) > 0 ? Number(bit_width) : 1;

    return {
      name: String(field.name ?? ''),
      bit_offset,
      bit_width,
      access: field.access as string | undefined,
      reset_value: (field.reset_value ?? field.resetValue ?? field.reset) as number | null | undefined,
      description: field.description as string | undefined,
      enumerated_values: field.enumerated_values as Record<string, string> | undefined,
    };
  }

  /**
   * Normalize a register object
   */
  static normalizeRegister(reg: Record<string, unknown>): NormalizedRegister {
    return {
      name: String(reg.name ?? ''),
      address_offset: ((reg.offset as number) || (reg.address_offset as number)) || 0,
      size: (reg.size as number) || 32,
      access: reg.access as string | undefined,
      reset_value: reg.reset_value as number | undefined,
      description: reg.description as string | undefined,
      fields: (reg.fields as Record<string, unknown>[])?.map((field) => DataNormalizer.normalizeField(field)),
    };
  }

  /**
   * Normalize a list of registers (including arrays)
   */
  static normalizeRegisterList(
    regs: unknown[],
    defaultRegBytes: number
  ): Array<NormalizedRegister | NormalizedRegisterArray> {
    const out: Array<NormalizedRegister | NormalizedRegisterArray> = [];
    let currentOffset = 0;

    for (const entry of regs ?? []) {
      const e = entry as Record<string, unknown>;
      const explicitOffset = e.offset ?? e.address_offset ?? e.addressOffset;
      if (explicitOffset !== undefined) {
        currentOffset = DataNormalizer.parseNumber(explicitOffset, currentOffset);
      }

      const isArray =
        e &&
        typeof e === 'object' &&
        e.count !== undefined &&
        e.stride !== undefined &&
        Array.isArray(e.registers);
      if (isArray) {
        const arrayOffset = currentOffset;
        const count = Math.max(1, DataNormalizer.parseNumber(e.count, 1));
        const stride = Math.max(1, DataNormalizer.parseNumber(e.stride, defaultRegBytes));
        const nested = DataNormalizer.normalizeRegisterList(
          e.registers as unknown[],
          defaultRegBytes
        ) as NormalizedRegister[];
        out.push({
          __kind: 'array',
          name: String(e.name ?? ''),
          address_offset: arrayOffset,
          count,
          stride,
          description: e.description as string | undefined,
          registers: nested.filter((n) => (n as Record<string, unknown>).__kind !== 'array'),
        });
        currentOffset = arrayOffset + count * stride;
        continue;
      }

      const regOffset = currentOffset;
      const normalizedReg: NormalizedRegister = {
        name: String(e.name ?? ''),
        address_offset: regOffset,
        size: DataNormalizer.parseNumber(e.size, 32),
        access: e.access as string | undefined,
        reset_value: e.reset_value as number | undefined,
        description: e.description as string | undefined,
        fields: (e.fields as Record<string, unknown>[])?.map((field) => DataNormalizer.normalizeField(field)),
      };
      out.push(normalizedReg);
      currentOffset = regOffset + defaultRegBytes;
    }

    return out;
  }

  /**
   * Normalize a complete memory map
   */
  static normalizeMemoryMap(data: unknown): MemoryMap {
    const d = data as Record<string, unknown>;
    const blocks = (d.address_blocks ?? d.addressBlocks ?? []) as Record<string, unknown>[];
    return {
      name: String(d.name ?? ''),
      description: d.description as string | undefined,
      address_blocks: (blocks ?? []).map((block) => {
        const defaultRegBytes = DataNormalizer.getDefaultRegBytes(block);
        const baseAddress = DataNormalizer.parseNumber(
          block.offset ?? block.base_address ?? block.baseAddress ?? 0,
          0
        );

        const normalizedRegs = DataNormalizer.normalizeRegisterList(
          (block.registers as unknown[]) ?? [],
          defaultRegBytes
        );

        return {
          name: String(block.name ?? ''),
          base_address: baseAddress,
          range: (block.range as number) || 4096,
          usage: (block.usage as string) || 'register',
          access: block.access as string | undefined,
          description: block.description as string | undefined,
          // NOTE: this intentionally holds both registers and arrays; treated as mixed in consumers.
          registers: normalizedRegs as NormalizedRegister[],
          register_arrays: ((block.register_arrays as Record<string, unknown>[]) ?? []).map((registerArray) => ({
            name: String(registerArray.name ?? ''),
            base_address: DataNormalizer.parseNumber(registerArray.base_address, 0),
            count: DataNormalizer.parseNumber(registerArray.count, 1),
            stride: DataNormalizer.parseNumber(registerArray.stride, defaultRegBytes),
            template: DataNormalizer.normalizeRegister((registerArray.template as Record<string, unknown>) || {}),
            description: registerArray.description as string | undefined,
          })),
        };
      }) as unknown as AddressBlock[],
    };
  }
}
