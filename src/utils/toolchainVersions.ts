export type RunnerKind = 'local' | 'docker';

export interface ConfiguredToolVersion {
  runner: RunnerKind;
  version: string;
}

/** Parses a dotted version string like "2024.2" or "23.1.0" into numeric segments. */
function parseVersionSegments(version: string): number[] | undefined {
  const nums = version.trim().split('.').map(Number);
  return nums.some((n) => Number.isNaN(n)) ? undefined : nums;
}

/**
 * Compares two version strings numerically by dotted segment. Falls back to
 * a plain lexicographic compare when either side doesn't parse as numeric
 * segments (e.g. a Docker label like "latest-patched").
 */
export function compareVersions(a: string, b: string): number {
  const segA = parseVersionSegments(a);
  const segB = parseVersionSegments(b);
  if (!segA || !segB) {
    return a.localeCompare(b);
  }
  const len = Math.max(segA.length, segB.length);
  for (let i = 0; i < len; i++) {
    const diff = (segA[i] ?? 0) - (segB[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

export function sortVersionsDescending(versions: string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

/**
 * Numeric distance between two versions, used to suggest the "closest
 * installed" version when the exact required one isn't configured. Earlier
 * segments are weighted far more heavily so "2024.2" is closer to "2024.1"
 * than to "2023.9". Non-numeric versions are either equal (distance 0) or
 * maximally far apart.
 */
export function versionDistance(a: string, b: string): number {
  const segA = parseVersionSegments(a);
  const segB = parseVersionSegments(b);
  if (!segA || !segB) {
    return a === b ? 0 : Number.MAX_SAFE_INTEGER;
  }
  const len = Math.max(segA.length, segB.length);
  let distance = 0;
  for (let i = 0; i < len; i++) {
    const weight = 10 ** (2 * (len - i));
    distance += Math.abs((segA[i] ?? 0) - (segB[i] ?? 0)) * weight;
  }
  return distance;
}

/** Returns the entry in `available` numerically closest to `target`, or
 *  undefined when `available` is empty. Ties break toward the higher version. */
export function findClosestVersion(target: string, available: string[]): string | undefined {
  if (available.length === 0) {
    return undefined;
  }
  return [...available].sort((a, b) => {
    const diff = versionDistance(target, a) - versionDistance(target, b);
    return diff !== 0 ? diff : compareVersions(b, a);
  })[0];
}

/** Returns every configured entry whose version exactly matches one of `candidates`. */
export function matchConfiguredVersions(
  candidates: string[],
  configured: ConfiguredToolVersion[]
): ConfiguredToolVersion[] {
  const candidateSet = new Set(candidates);
  return configured.filter((c) => candidateSet.has(c.version));
}

/**
 * Maps a Vivado `.xpr` root `<Project Version="N" Minor="M">` pair (keyed as
 * "N.M") to the release(s) that could have produced it. Xilinx does not
 * publish a guaranteed 1:1 mapping from project-file format version to
 * release, so one format version may legitimately map to more than one
 * candidate — detection reports 'ambiguous' rather than guessing in that case.
 *
 * This table is intentionally sparse. Add an entry only after opening a
 * project saved by a real, known Vivado release and reading its actual
 * Version/Minor attributes — never guess a mapping. An unlisted format
 * version returns no candidates (detection falls back to 'none' confidence).
 */
export const VIVADO_PROJECT_FORMAT_TABLE: Record<string, string[]> = {};

export function candidateVivadoReleases(formatVersion: string, formatMinor: string): string[] {
  return VIVADO_PROJECT_FORMAT_TABLE[`${formatVersion}.${formatMinor}`] ?? [];
}
