/**
 * YamlSanitizer
 *
 * Canonicalizes in-memory memory-map objects to the .mm.yml schema
 * (ipcraft-spec/schemas/memory_map.schema.json) before serialization.
 *
 * The webview pipeline mixes raw YAML objects with normalized runtime
 * objects (DataNormalizer / LayoutEngine output). Writing those back
 * verbatim pollutes the file with runtime-only keys (`address_offset`,
 * `bit_offset`, `base_address`, `__kind`, ...) and non-schema aliases
 * (`reset_value`, `enumerated_values`). Every whole-map or array-level
 * write must pass through this module.
 *
 * Strategy: blocklist. Runtime-only keys are stripped, aliases are renamed
 * to their canonical schema spelling, null/empty defaults are dropped.
 * Unknown keys pass through untouched so user extensions survive.
 */

import { formatBitsRange } from '../utils/BitFieldUtils';

type Obj = Record<string, unknown>;

function isNil(v: unknown): boolean {
  return v === null || v === undefined;
}

function dropIfNil(obj: Obj, key: string): void {
  if (key in obj && isNil(obj[key])) {
    delete obj[key];
  }
}

function dropIfEmptyString(obj: Obj, key: string): void {
  if (obj[key] === '') {
    delete obj[key];
  }
}

/** Rename `from` to canonical `to` unless `to` already set. Drops nil values. */
function canonicalizeKey(obj: Obj, from: string, to: string): void {
  if (from in obj) {
    if (!(to in obj) && !isNil(obj[from])) {
      obj[to] = obj[from];
    }
    delete obj[from];
  }
  dropIfNil(obj, to);
}

/** Sanitize a bit field for YAML output. Canonical position key is `bits`. */
export function sanitizeFieldForYaml(field: Obj): Obj {
  const out: Obj = { ...field };

  // Ensure canonical `bits` string, derived from runtime offsets when absent.
  if (typeof out.bits !== 'string' || out.bits === '') {
    const offset = out.bit_offset ?? out.offset;
    const width = out.bit_width ?? out.width;
    if (typeof offset === 'number' && typeof width === 'number' && width > 0) {
      out.bits = formatBitsRange(offset + width - 1, offset);
    }
  }
  // `offset`/`width` are schema-valid alternatives, but redundant next to `bits`.
  if (typeof out.bits === 'string') {
    delete out.offset;
    delete out.width;
  }
  delete out.bit_offset;
  delete out.bit_width;
  delete out.bit_range;

  canonicalizeKey(out, 'reset_value', 'resetValue');
  canonicalizeKey(out, 'enumerated_values', 'enumeratedValues');
  dropIfNil(out, 'monitorChangeOf');
  dropIfNil(out, 'access');
  dropIfEmptyString(out, 'description');

  return out;
}

/**
 * Sanitize a register (or register-array node) for YAML output.
 *
 * @param reg              Register object (raw or normalized).
 * @param defaultRegWidth  Effective register width of the parent block in
 *                         bits; `size` equal to it (and to the schema default
 *                         of 32) is redundant and dropped.
 */
export function sanitizeRegisterForYaml(reg: Obj, defaultRegWidth = 32): Obj {
  const out: Obj = { ...reg };

  // Canonical offset key is `offset`; `address_offset` is a runtime alias.
  if (typeof out.offset !== 'number' && typeof out.address_offset === 'number') {
    out.offset = out.address_offset;
  }
  delete out.address_offset;
  delete out.__kind;

  // Schema default for `size` is 32; only meaningful when it deviates.
  if (out.size === 32 && defaultRegWidth === 32) {
    delete out.size;
  }
  dropIfNil(out, 'size');

  canonicalizeKey(out, 'reset_value', 'resetValue');
  dropIfNil(out, 'access');
  dropIfEmptyString(out, 'description');

  if (Array.isArray(out.fields)) {
    if (out.fields.length === 0) {
      delete out.fields;
    } else {
      out.fields = (out.fields as Obj[]).map((f) => sanitizeFieldForYaml(f));
    }
  }

  // Register-array template registers.
  if (Array.isArray(out.registers)) {
    out.registers = (out.registers as Obj[]).map((r) =>
      sanitizeRegisterForYaml(r, defaultRegWidth)
    );
  }

  return out;
}

/** Sanitize an address block for YAML output. Canonical base key is `baseAddress`. */
export function sanitizeBlockForYaml(block: Obj): Obj {
  const out: Obj = { ...block };

  // Canonical base-address key.
  const base = out.baseAddress ?? out.base_address;
  if (typeof base === 'number') {
    out.baseAddress = base;
  }
  delete out.base_address;

  canonicalizeKey(out, 'default_reg_width', 'defaultRegWidth');
  dropIfNil(out, 'range');
  dropIfEmptyString(out, 'description');

  if (Array.isArray(out.register_arrays) && out.register_arrays.length === 0) {
    delete out.register_arrays;
  }

  const widthRaw = out.defaultRegWidth;
  const width = typeof widthRaw === 'number' && widthRaw > 0 ? widthRaw : 32;

  if (Array.isArray(out.registers)) {
    out.registers = (out.registers as Obj[]).map((r) => sanitizeRegisterForYaml(r, width));
  }

  return out;
}

/** Sanitize a whole memory map for YAML output. Canonical blocks key is `addressBlocks`. */
export function sanitizeMemoryMapForYaml(map: Obj): Obj {
  const out: Obj = { ...map };

  const blocks = out.addressBlocks ?? out.address_blocks;
  if (Array.isArray(blocks)) {
    out.addressBlocks = (blocks as Obj[]).map((b) => sanitizeBlockForYaml(b));
  }
  delete out.address_blocks;
  dropIfEmptyString(out, 'description');

  return out;
}
