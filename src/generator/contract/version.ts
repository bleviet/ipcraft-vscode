import type { ScaffoldPack } from '../types';

export const CONTRACT_VERSION = '1.0.0' as const;

/**
 * Minimal semver range check for ^ and ~ prefix ranges (e.g. "^1.0", "~1.2.3").
 * Sufficient for apiVersion declarations; does not handle complex range expressions
 * or pre-release identifiers.
 *
 * ^ (caret): major must match, minor.patch must be >= the specified floor.
 * ~ (tilde): major and minor must match, patch must be >= the specified floor.
 * No prefix: exact match on all three segments.
 *
 * Limitation: ^0.x handling (locked minor) is not implemented — major >= 1 assumed.
 */
function satisfiesRange(version: string, range: string): boolean {
  const caret = range.startsWith('^');
  const tilde = range.startsWith('~');
  const rv = range.slice(caret || tilde ? 1 : 0).trim();

  const [vMaj, vMin = 0, vPat = 0] = version.split('.').map(Number);
  const [rMaj, rMin = 0, rPat = 0] = rv.split('.').map(Number);

  if (caret) {
    return vMaj === rMaj && (vMin > rMin || (vMin === rMin && vPat >= rPat));
  }
  if (tilde) {
    return vMaj === rMaj && vMin === rMin && vPat >= rPat;
  }
  return vMaj === rMaj && vMin === rMin && vPat === rPat;
}

/**
 * Throws if the pack's declared apiVersion range is not satisfied by CONTRACT_VERSION.
 * Passes silently when apiVersion is absent (unversioned pack — accepted with no warning).
 */
export function checkPackApiVersion(pack: ScaffoldPack): void {
  if (!pack.apiVersion) {
    return;
  }
  if (!satisfiesRange(CONTRACT_VERSION, pack.apiVersion)) {
    throw new Error(
      `Pack '${pack.name}' targets apiVersion '${pack.apiVersion}' ` +
        `but this IPCraft provides contract ${CONTRACT_VERSION}.`
    );
  }
}
