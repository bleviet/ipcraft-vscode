import React from 'react';
import type { ClockDomain } from './clocks/clockTypes';
import { nameWithFrequency } from './clocks/frequency';

/** Small disc in the color of a clock domain. */
export function DomainDot({ color }: { color: string }) {
  return <i aria-hidden="true" className="sd-dot" style={{ background: color }} />;
}

/** `name · frequency` with the domain's dot (the name alone without a frequency), or `unknown` without a domain. */
export function DomainLabel({ domain }: { domain?: ClockDomain }) {
  if (!domain) {
    return <span className="opacity-60">unknown</span>;
  }
  return (
    <span className="whitespace-nowrap">
      <DomainDot color={domain.color} /> {nameWithFrequency(domain)}
    </span>
  );
}

/** The domain's dot and name alone, for tables that show the frequency in another column. */
export function DomainName({ domain }: { domain: ClockDomain }) {
  return (
    <span className="whitespace-nowrap font-semibold">
      <DomainDot color={domain.color} /> {domain.name}
    </span>
  );
}
