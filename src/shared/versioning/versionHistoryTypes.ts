/**
 * Shape of a memory map's `versionHistory`. Kept in its own import-free module so the domain
 * types can refer to it without a cycle through `versionHistory.ts` (which uses domain types).
 */

export interface VersionEntry {
  version: string;
  registerSet: string;
}

export interface VersionHistory {
  /** Frozen snapshots keyed by register-set hash; raw schema objects, tokens kept symbolic. */
  registerSets: Record<string, { addressBlocks: unknown[] }>;
  /** Release order: the last entry is the latest. */
  versions: VersionEntry[];
}
