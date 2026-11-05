/**
 * Pin-role rules for the system graph: whether an endpoint drives (source) or
 * loads (sink) its net. Pure and free of Node imports so the webview can reuse
 * it. A boundary pin is seen from inside its level, so its role is reversed.
 */

import type { PinDirection } from './systemGraph';

export type EndpointRole = 'source' | 'sink' | 'none';

/**
 * Role of an endpoint with `direction` in a net. `isBoundary` is true for a
 * boundary pin of the net's own level; a hier instance pin seen from its parent
 * level is NOT a boundary endpoint. `inout`/`unknown` have no role.
 */
export function endpointRole(direction: PinDirection, isBoundary: boolean): EndpointRole {
  if (direction === 'out' || direction === 'master') {
    return isBoundary ? 'sink' : 'source';
  }
  if (direction === 'in' || direction === 'slave') {
    return isBoundary ? 'source' : 'sink';
  }
  return 'none';
}

/** The pin direction that makes an endpoint play `role` (inverse of {@link endpointRole}). */
export function directionForRole(
  role: 'source' | 'sink',
  isInterface: boolean,
  isBoundary: boolean
): PinDirection {
  const outward = (role === 'source') !== isBoundary;
  if (outward) {
    return isInterface ? 'master' : 'out';
  }
  return isInterface ? 'slave' : 'in';
}
