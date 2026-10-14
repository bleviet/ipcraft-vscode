/**
 * Shape of a memory map's `versionHistory`. Kept in its own import-free module so the domain
 * types can refer to it without a cycle through `versionHistory.ts` (which uses domain types).
 */

export interface VersionEntry {
  version: string;
  registerSet: string;
  /** CRC-8 of the version bytes under the core's scheme at write time; absent in older entries. */
  crc8?: number;
  /** CRC-16 of the version bytes under the core's scheme at write time; absent in older entries. */
  crc16?: number;
}

export interface VersionHistory {
  /** Frozen snapshots keyed by register-set hash; raw schema objects, tokens kept symbolic. */
  registerSets: Record<string, { addressBlocks: unknown[] }>;
  /** Release order: the last entry is the latest. */
  versions: VersionEntry[];
}
