import * as fs from 'fs/promises';
import * as path from 'path';
import { getIpcraftConfigDir } from '../utils/configDir';
import { Logger } from '../utils/Logger';

const logger = new Logger('BusDefScanCache');

const CACHE_VERSION = 1;

export interface BusDefScanCacheEntry {
  mtimeMs: number;
  size: number;
  kind: 'busdef' | 'none';
  busTypes?: string[];
  record?: unknown;
}

interface BusDefScanCacheFile {
  version: number;
  entries: Record<string, BusDefScanCacheEntry>;
}

function getCacheFilePath(): string {
  return path.join(getIpcraftConfigDir(), 'bus_definitions', 'scan-cache.json');
}

/**
 * Persists a per-file memo of workspace bus-definition scan results
 * (`~/.config/ipcraft/bus_definitions/scan-cache.json`, OS-equivalent path
 * via `getIpcraftConfigDir()`) so that `WorkspaceBusDefinitionScanner` only
 * has to read+parse files that are new or changed since the last scan —
 * including across VS Code sessions, where the in-memory cache starts empty.
 *
 * Keyed on `(mtimeMs, size)` from `fs.stat`, not a content hash: stat is
 * cheap and doesn't touch file content, which is the whole point of this
 * cache. `kind: 'none'` entries are a negative cache — a file already
 * probed and found to not be a bus definition is remembered so future scans
 * skip even the cheap content-sniff probe for it.
 *
 * Tolerates a missing or corrupt cache file by treating it as empty; never
 * throws. Not safe for concurrent multi-window writers beyond last-write-wins
 * (acceptable: worst case is a redundant parse, never incorrect data).
 */
export class BusDefScanCache {
  private entries = new Map<string, BusDefScanCacheEntry>();

  /** Loads the persisted cache from disk, tolerating missing/corrupt JSON as empty. */
  async load(): Promise<void> {
    this.entries = new Map();
    try {
      const raw = await fs.readFile(getCacheFilePath(), 'utf8');
      const parsed = JSON.parse(raw) as Partial<BusDefScanCacheFile>;
      if (parsed.version !== CACHE_VERSION || typeof parsed.entries !== 'object') {
        return;
      }
      for (const [filePath, entry] of Object.entries(parsed.entries ?? {})) {
        if (isValidEntry(entry)) {
          this.entries.set(filePath, entry);
        }
      }
    } catch {
      // Missing file, unreadable, or unparseable JSON — treat as empty cache.
    }
  }

  /** Returns the cached entry for `filePath` if present, or undefined. */
  get(filePath: string): BusDefScanCacheEntry | undefined {
    return this.entries.get(filePath);
  }

  /**
   * Discards any loaded/recorded entries without touching disk — used by the
   * `force=true` clean-rescan path so every candidate is treated as a cache
   * miss for this scan. `persist()` afterwards overwrites the on-disk cache
   * with the fresh results.
   */
  clear(): void {
    this.entries = new Map();
  }

  /** Records (or overwrites) the entry for `filePath` for the current scan. */
  set(filePath: string, entry: BusDefScanCacheEntry): void {
    this.entries.set(filePath, entry);
  }

  /**
   * Replaces the in-memory cache with only the entries for `seenPaths`,
   * dropping anything else (e.g. deleted files), then persists it to disk.
   * Call once per scan, after every candidate has been processed.
   */
  async persist(seenPaths: ReadonlySet<string>): Promise<void> {
    const pruned = new Map<string, BusDefScanCacheEntry>();
    for (const [filePath, entry] of this.entries) {
      if (seenPaths.has(filePath)) {
        pruned.set(filePath, entry);
      }
    }
    this.entries = pruned;

    const cacheFilePath = getCacheFilePath();
    const payload: BusDefScanCacheFile = {
      version: CACHE_VERSION,
      entries: Object.fromEntries(this.entries),
    };
    try {
      await fs.mkdir(path.dirname(cacheFilePath), { recursive: true });
      await fs.writeFile(cacheFilePath, JSON.stringify(payload), 'utf8');
    } catch (error) {
      logger.warn(
        `Failed to persist workspace bus definition scan cache: ${(error as Error).message}`
      );
    }
  }
}

function isValidEntry(value: unknown): value is BusDefScanCacheEntry {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<BusDefScanCacheEntry>;
  return (
    typeof candidate.mtimeMs === 'number' &&
    typeof candidate.size === 'number' &&
    (candidate.kind === 'busdef' || candidate.kind === 'none')
  );
}
