import type { MemoryMap } from '../types/memoryMap';

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
  fields?: any[];
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
  static parseNumber(value: any, fallback = 0): number {
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
  static getDefaultRegBytes(block: any): number {
    const bits = DataNormalizer.parseNumber(
      block.defaultRegWidth ?? block.default_reg_width ?? 32,
      32
    );
    const bytes = Math.max(1, Math.floor(bits / 8));
    return bytes;
  }

  /**
   * Normalize a field object
   */
  static normalizeField(field: any): any {
    // Parse bits field if it's a string like "[31:0]" or "[0:0]"
    let bit_offset = field.bit_offset || 0;
    let bit_width = field.bit_width || 1;

    if (field.bits && typeof field.bits === 'string') {
      const match = field.bits.match(/\[(\d+)(?::(\d+))?\]/);
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
      name: field.name,
      bit_offset,
      bit_width,
      access: field.access,
      reset_value: field.reset_value ?? field.resetValue ?? field.reset,
      description: field.description,
      enumerated_values: field.enumerated_values,
    };
  }

  /**
   * Normalize a register object
   */
  static normalizeRegister(reg: any): any {
    return {
      name: reg.name,
      address_offset: reg.offset || reg.address_offset || 0,
      size: reg.size || 32,
      access: reg.access,
      reset_value: reg.reset_value,
      description: reg.description,
      fields: reg.fields?.map((field: any) => DataNormalizer.normalizeField(field)),
    };
  }

  /**
   * Normalize a list of registers (including arrays)
   */
  static normalizeRegisterList(
    regs: any[],
    defaultRegBytes: number
  ): Array<NormalizedRegister | NormalizedRegisterArray> {
    const out: Array<NormalizedRegister | NormalizedRegisterArray> = [];
    let currentOffset = 0;

    for (const entry of regs ?? []) {
      const explicitOffset = entry.offset ?? entry.address_offset ?? entry.addressOffset;
      if (explicitOffset !== undefined) {
        currentOffset = DataNormalizer.parseNumber(explicitOffset, currentOffset);
      }

      const isArray =
        entry &&
        typeof entry === 'object' &&
        entry.count !== undefined &&
        entry.stride !== undefined &&
        Array.isArray(entry.registers);
      if (isArray) {
        const arrayOffset = currentOffset;
        const count = Math.max(1, DataNormalizer.parseNumber(entry.count, 1));
        const stride = Math.max(1, DataNormalizer.parseNumber(entry.stride, defaultRegBytes));
        const nested = DataNormalizer.normalizeRegisterList(
          entry.registers,
          defaultRegBytes
        ) as NormalizedRegister[];
        out.push({
          __kind: 'array',
          name: entry.name,
          address_offset: arrayOffset,
          count,
          stride,
          description: entry.description,
          registers: nested.filter((n) => (n as any).__kind !== 'array'),
        });
        currentOffset = arrayOffset + count * stride;
        continue;
      }

      const regOffset = currentOffset;
      const normalizedReg: NormalizedRegister = {
        name: entry.name,
        address_offset: regOffset,
        size: DataNormalizer.parseNumber(entry.size, 32),
        access: entry.access,
        reset_value: entry.reset_value,
        description: entry.description,
        fields: entry.fields?.map((field: any) => DataNormalizer.normalizeField(field)),
      };
      out.push(normalizedReg);
      currentOffset = regOffset + defaultRegBytes;
    }

    return out;
  }

  /**
   * Normalize a complete memory map
   */
  static normalizeMemoryMap(data: any): MemoryMap {
    const blocks = data.addressBlocks ?? data.address_blocks ?? [];
    return {
      name: data.name,
      description: data.description,
      address_blocks: (blocks ?? []).map((block: any) => {
        const defaultRegBytes = DataNormalizer.getDefaultRegBytes(block);
        const baseAddress = DataNormalizer.parseNumber(
          block.offset ?? block.base_address ?? block.baseAddress ?? 0,
          0
        );

        const normalizedRegs = DataNormalizer.normalizeRegisterList(
          block.registers ?? [],
          defaultRegBytes
        );

        return {
          name: block.name,
          base_address: baseAddress,
          range: block.range || 4096,
          usage: block.usage || 'register',
          access: block.access,
          description: block.description,
          // NOTE: this intentionally holds both registers and arrays; treated as "any" in consumers.
          registers: normalizedRegs as any,
          register_arrays: (block.register_arrays ?? []).map((arr: any) => ({
            name: arr.name,
            base_address: DataNormalizer.parseNumber(arr.base_address, 0),
            count: DataNormalizer.parseNumber(arr.count, 1),
            stride: DataNormalizer.parseNumber(arr.stride, defaultRegBytes),
            template: DataNormalizer.normalizeRegister(arr.template || {}),
            description: arr.description,
          })),
        };
      }),
    };
  }
}
