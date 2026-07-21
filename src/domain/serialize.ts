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

  // Determine if it is a BitFieldDef. A canonical field always carries `bits`;
  // an object with both `offset` and `width` is also a field (registers have
  // `offset` but never `width`), letting us reconstruct `bits` when absent.
  const isField = 'bits' in out || ('offset' in out && 'width' in out);
  if (isField) {
    // If bits is not present but offset/width are, reconstruct the bits string.
    if (typeof out.bits !== 'string' || out.bits === '') {
      const offset = out.offset;
      const width = out.width;
      if (typeof offset === 'number' && typeof width === 'number' && width > 0) {
        out.bits = formatBitsRange(offset + width - 1, offset);
      }
    }

    // Drop redundant, runtime-computed layout metadata; `bits` is canonical.
    delete out.offset;
    delete out.width;
    delete out.bitRange;

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
  const isRegister = 'offset' in out;
  if (isRegister && !('baseAddress' in out)) {
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
  const isBlock = 'baseAddress' in out || 'defaultRegWidth' in out;
  if (isBlock) {
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
  const isMemoryMap = 'addressBlocks' in out;
  if (isMemoryMap) {
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
