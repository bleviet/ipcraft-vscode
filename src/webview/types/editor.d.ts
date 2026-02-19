/**
 * Shared editor types for the webview — runtime shapes and callback signatures.
 *
 * These types describe the **live objects** that the webview builds and passes
 * through its component tree, which are richer than (but compatible with) the
 * auto-generated schema types in `memoryMap.d.ts` and `ipCore.d.ts`.
 */

import type { YamlPath } from '../services/YamlPathResolver';

/** Re-export canonical YamlPath for convenience. */
export type { YamlPath };

/**
 * Callback signature for committing a YAML path + value change.
 * Used consistently across all editor components and hooks so that the
 * signature is defined in one place and never diverges.
 *
 * @example
 * const handleUpdate: YamlUpdateHandler = (path, value) => { ... };
 */
export type YamlUpdateHandler = (path: YamlPath, value: unknown) => void;

/**
 * Minimum shape for a bit field during layout / repacking operations.
 *
 * Looser than the generated `BitFieldDef` so that the algorithms can operate
 * on the enriched runtime objects the webview builds (which carry computed
 * `bit_offset`, `bit_width`, and `bit_range` alongside the canonical `bits`
 * string).
 */
export interface BitFieldRecord {
  name?: string;
  bits?: string | null;
  bit_offset?: number | null;
  bit_width?: number | null;
  bit_range?: [number, number];
  access?: string | null;
  reset_value?: number | null;
  description?: string | null;
  [key: string]: unknown;
}

/**
 * Minimum shape for a register (regular or array-element) during repacking
 * operations.
 */
export interface RegisterRecord {
  name?: string;
  /** Byte offset inside an address block. */
  offset?: number | null;
  address_offset?: number;
  /** Present on register-array nodes. */
  __kind?: string;
  count?: number;
  stride?: number;
  registers?: RegisterRecord[];
  [key: string]: unknown;
}

/**
 * Minimum shape for an address block during repacking operations.
 */
export interface AddressBlockRecord {
  name?: string;
  base_address?: number;
  size?: number;
  registers?: RegisterRecord[];
  [key: string]: unknown;
}
