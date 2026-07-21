import { formatBitsRange } from '../webview/utils/BitFieldUtils';

function isNil(v: unknown): boolean {
  return v === null || v === undefined;
}

type SerializationHint = 'auto' | 'field' | 'register' | 'block' | 'opaque';

function childHint(key: string): SerializationHint {
  if (key === 'fields') {
    return 'field';
  }
  if (key === 'registers') {
    return 'register';
  }
  if (key === 'addressBlocks') {
    return 'block';
  }
  return 'opaque';
}

function serializeChild(key: string, value: unknown, defaultRegWidth: number): unknown {
  return serializeValueWithHint(value, defaultRegWidth, childHint(key));
}

function serializeValueWithHint(
  obj: unknown,
  defaultRegWidth: number,
  hint: SerializationHint
): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => serializeValueWithHint(item, defaultRegWidth, hint));
  }

  if (hint === 'opaque') {
    return obj;
  }

  const record = obj as Record<string, unknown>;
  const out: Record<string, unknown> = { ...record };

  // Remove rowId and __kind from schema nodes only. Opaque metadata may
  // legitimately use those names and is preserved verbatim.
  delete out.rowId;
  delete out.__kind;

  // A shape check is retained for direct serializeValue(field) calls. Nested
  // objects are classified by their schema-bearing parent key, so opaque maps
  // containing keys such as `offset` and `width` are never mistaken for fields.
  const isField =
    hint === 'field' || (hint === 'auto' && ('bits' in out || ('offset' in out && 'width' in out)));
  if (isField) {
    if (typeof out.bits !== 'string' || out.bits === '') {
      const offset = out.offset;
      const width = out.width;
      if (typeof offset === 'number' && typeof width === 'number' && width > 0) {
        out.bits = formatBitsRange(offset + width - 1, offset);
      }
    }

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

    const canonical: Record<string, unknown> = {};
    if (out.name !== undefined) {
      canonical.name = out.name;
    }
    if (out.bits !== undefined) {
      canonical.bits = out.bits;
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
        canonical[key] = serializeChild(key, out[key], defaultRegWidth);
      }
    }
    return canonical;
  }

  const isRegister = hint === 'register' || (hint === 'auto' && 'offset' in out);
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

    for (const key in out) {
      out[key] = serializeChild(key, out[key], size);
    }
    return out;
  }

  const isBlock =
    hint === 'block' || (hint === 'auto' && ('baseAddress' in out || 'defaultRegWidth' in out));
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
      out[key] = serializeChild(key, out[key], regWidth);
    }
    return out;
  }

  if ('addressBlocks' in out) {
    if (out.description === '') {
      delete out.description;
    }

    for (const key in out) {
      out[key] = serializeChild(key, out[key], defaultRegWidth);
    }
    return out;
  }

  for (const key in out) {
    out[key] = serializeChild(key, out[key], defaultRegWidth);
  }
  return out;
}

/**
 * Clean a value before serializing to YAML, ensuring it conforms strictly to the schema.
 * Tolerates any shape and removes runtime-only keys (like rowId, __kind, offsets on fields).
 */
export function serializeValue(obj: unknown, defaultRegWidth = 32): unknown {
  return serializeValueWithHint(obj, defaultRegWidth, 'auto');
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
