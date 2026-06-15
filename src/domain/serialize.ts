import { formatBitsRange } from '../webview/utils/BitFieldUtils';

function isNil(v: unknown): boolean {
  return v === null || v === undefined;
}

/**
 * Clean a value before serializing to YAML, ensuring it conforms strictly to the schema.
 * Tolerates any shape and removes runtime-only keys (like rowId, __kind, offsets on fields).
 */
export function serializeValue(obj: unknown, defaultRegWidth = 32): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => serializeValue(item, defaultRegWidth));
  }

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };

  // Remove rowId and __kind from all objects
  delete out.rowId;
  delete out.__kind;

  // Determine if it is a BitFieldDef
  const isField = 'bits' in out || 'bit_offset' in out || 'bitOffset' in out;
  if (isField) {
    // If bits is not present but offsets are, reconstruct bits string
    if (typeof out.bits !== 'string' || out.bits === '') {
      const offset = out.offset ?? out.bit_offset ?? out.bitOffset;
      const width = out.width ?? out.bit_width ?? out.bitWidth;
      if (typeof offset === 'number' && typeof width === 'number' && width > 0) {
        out.bits = formatBitsRange(offset + width - 1, offset);
      }
    }

    // Drop redundant offsets to follow strict schema validation
    delete out.offset;
    delete out.width;
    delete out.bit_offset;
    delete out.bit_width;
    delete out.bit_range;
    delete out.bitRange;
    delete out.bitOffset;
    delete out.bitWidth;

    // Handle aliases and cleanups
    if ('reset_value' in out) {
      out.resetValue = out.reset_value;
      delete out.reset_value;
    }
    if ('enumerated_values' in out) {
      out.enumeratedValues = out.enumerated_values;
      delete out.enumerated_values;
    }
    if ('monitor_change_of' in out) {
      out.monitorChangeOf = out.monitor_change_of;
      delete out.monitor_change_of;
    }

    if (isNil(out.resetValue) || out.resetValue === 0) {
      delete out.resetValue;
    }
    if (isNil(out.access)) {
      delete out.access;
    }
    if (out.description === '') {
      delete out.description;
    }
    if (isNil(out.monitorChangeOf)) {
      delete out.monitorChangeOf;
    }
    if (isNil(out.enumeratedValues)) {
      delete out.enumeratedValues;
    }

    // Rebuild in canonical schema order: name, bits, access, resetValue, description, then extras
    const canonical: Record<string, unknown> = {};
    if (out.name !== undefined) {
      canonical.name = out.name;
    }
    if (out.bits !== undefined) {
      canonical.bits = serializeValue(out.bits, defaultRegWidth);
    }
    if (out.access !== undefined) {
      canonical.access = out.access;
    }
    if (out.resetValue !== undefined) {
      canonical.resetValue = out.resetValue;
    }
    if (out.description !== undefined) {
      canonical.description = out.description;
    }
    for (const key of Object.keys(out)) {
      if (!(key in canonical)) {
        canonical[key] = serializeValue(out[key], defaultRegWidth);
      }
    }
    return canonical;
  }

  // Determine if it is a RegisterDef
  const isRegister = 'offset' in out || 'address_offset' in out || 'addressOffset' in out;
  if (isRegister && !('baseAddress' in out || 'base_address' in out)) {
    if (typeof out.offset !== 'number') {
      const explicitOffset = out.address_offset ?? out.addressOffset;
      if (typeof explicitOffset === 'number') {
        out.offset = explicitOffset;
      }
    }
    delete out.address_offset;
    delete out.addressOffset;

    if ('reset_value' in out) {
      out.resetValue = out.reset_value;
      delete out.reset_value;
    }

    const size = typeof out.size === 'number' ? out.size : 32;
    if (size === 32 && defaultRegWidth === 32) {
      delete out.size;
    }

    if (isNil(out.resetValue) || out.resetValue === 0) {
      delete out.resetValue;
    }
    if (isNil(out.access)) {
      delete out.access;
    }
    if (out.description === '') {
      delete out.description;
    }
    if (Array.isArray(out.fields) && out.fields.length === 0) {
      delete out.fields;
    }

    // Recursively clean fields / sub-registers
    for (const key in out) {
      out[key] = serializeValue(out[key], size);
    }
    return out;
  }

  // Determine if it is an AddressBlock
  const isBlock =
    'baseAddress' in out ||
    'base_address' in out ||
    'defaultRegWidth' in out ||
    'default_reg_width' in out;
  if (isBlock) {
    if (typeof out.baseAddress !== 'number') {
      const explicitBase = out.base_address ?? out.offset;
      if (typeof explicitBase === 'number') {
        out.baseAddress = explicitBase;
      }
    }
    delete out.base_address;
    delete out.default_reg_width;

    if ('defaultRegWidth' in out) {
      out.defaultRegWidth = out.defaultRegWidth;
    }

    if (isNil(out.range)) {
      delete out.range;
    }
    if (out.description === '') {
      delete out.description;
    }

    const regWidth =
      typeof out.defaultRegWidth === 'number' && out.defaultRegWidth > 0 ? out.defaultRegWidth : 32;

    for (const key in out) {
      out[key] = serializeValue(out[key], regWidth);
    }
    return out;
  }

  // Determine if it is a MemoryMap
  const isMemoryMap = 'addressBlocks' in out || 'address_blocks' in out;
  if (isMemoryMap) {
    if (Array.isArray(out.address_blocks)) {
      out.addressBlocks = out.address_blocks;
      delete out.address_blocks;
    }
    if (out.description === '') {
      delete out.description;
    }

    for (const key in out) {
      out[key] = serializeValue(out[key], defaultRegWidth);
    }
    return out;
  }

  // General object: recursively clean properties
  for (const key in out) {
    out[key] = serializeValue(out[key], defaultRegWidth);
  }
  return out;
}

/**
 * Serialize a normalized MemoryMap to its pure JSON schema shape.
 */
export function serializeMemoryMap(normalized: unknown, rootStyle: string): unknown {
  const cleaned = serializeValue(normalized);

  if (rootStyle === 'array') {
    return [cleaned];
  }
  if (rootStyle === 'nested') {
    return { memoryMaps: [cleaned] };
  }
  return cleaned;
}

/**
 * Serialize a normalized IP Core to its pure JSON schema shape.
 */
export function serializeIpCore(normalized: unknown): unknown {
  return serializeValue(normalized);
}
