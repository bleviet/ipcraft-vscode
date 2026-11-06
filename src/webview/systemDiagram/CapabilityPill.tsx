import React from 'react';
import type { CapabilityState } from '../../domain/systemGraph';

/** Outlined state pill: border and text carry the state color, the background stays clear. */
export function CapabilityPill({ state }: { state: CapabilityState }) {
  return <span className={`sd-pill sd-pill-${state}`}>{state}</span>;
}
