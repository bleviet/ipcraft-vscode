/**
 * Identity of a register set: a hash of the driver-relevant projection of the address blocks.
 *
 * Operates on the NORMALIZED domain model, so `bits: "[3:0]"` versus offset/width spellings and
 * hex versus decimal numbers hash identically. Descriptions, enumerations and formatting never
 * affect the hash; `$version` tokens are hashed by their text (unresolved), so a version bump
 * alone does not change it.
 */
import type {
  NormalizedAddressBlock,
  NormalizedField,
  NormalizedRegister,
} from '../../domain/internal.types';
import { sha256Hex } from './sha256';

/** Versions the projection; changing the projection later means a new prefix. */
export const REGISTER_SET_HASH_PREFIX = 'rs1';

const HASH_HEX_LENGTH = 16;

function projectField(field: NormalizedField): unknown {
  return {
    name: field.name,
    offset: field.offset,
    width: field.width,
    access: field.access,
    resetValue: field.resetValue,
    versionRef: field.versionRef,
  };
}

function projectRegister(register: NormalizedRegister): unknown {
  return {
    name: register.name,
    offset: register.offset,
    size: register.size,
    access: register.access,
    resetValue: register.resetValue,
    versionRef: register.versionRef,
    count: register.count,
    stride: register.stride,
    fields: register.fields.map(projectField),
    registers: register.registers?.map(projectRegister),
  };
}

/** The driver-relevant subset of the address blocks that the hash covers. */
export function projectRegisterSet(blocks: NormalizedAddressBlock[]): unknown {
  return blocks.map((block) => ({
    name: block.name,
    baseAddress: block.baseAddress,
    range: block.range,
    usage: block.usage,
    access: block.access,
    defaultRegWidth: block.defaultRegWidth,
    registers: block.registers.map(projectRegister),
  }));
}

/** JSON with sorted object keys, no whitespace, and null/undefined object properties omitted. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item ?? null)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const members = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== null && record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** `rs1-` followed by the first 16 hex digits of the SHA-256 of the canonical projection. */
export function hashRegisterSet(blocks: NormalizedAddressBlock[]): string {
  const digest = sha256Hex(canonicalJson(projectRegisterSet(blocks)));
  return `${REGISTER_SET_HASH_PREFIX}-${digest.slice(0, HASH_HEX_LENGTH)}`;
}
