/** Per-row checks and cross-references shown with a clock or reset tree. */

import type { ClockAnalysis } from './analyzeClocks';
import type {
  BlockCrossing,
  ClockDomain,
  Crossing,
  ExpectedFrequency,
  PinCrossing,
  ResetSource,
} from './clockTypes';
import { formatHz } from './frequency';
import { endKey } from './physicalNets';

export interface RowCheck {
  tone: 'ok' | 'warning' | 'muted';
  /** With its mark: `✓`, `✗` or `?`. */
  text: string;
  /** The reason behind the check, when there is one. */
  title?: string;
}

/** The check of a clock pin's expected frequency (from its definition) against its domain. */
export function frequencyCheck(expected: ExpectedFrequency): RowCheck {
  const text = `.ip.yml expects ${expected.expected}`;
  if (expected.status === 'match') {
    return { tone: 'ok', text: `✓ ${text}` };
  }
  return expected.status === 'mismatch'
    ? { tone: 'warning', text: `✗ ${text}` }
    : { tone: 'muted', text: `? ${text}`, title: 'The frequency of the domain is unknown' };
}

/** The check of a reset sink: released on its own clock, on another one, or not checkable. */
export function resetCheck(crossing: PinCrossing): RowCheck {
  const { to } = crossing;
  if (to.async) {
    return { tone: 'ok', text: '✓ asynchronous input', title: crossing.reason };
  }
  if (crossing.status === 'cross') {
    return {
      tone: 'warning',
      text: `✗ clocked by ${to.domain?.name ?? 'unknown'} · ${formatHz(to.domain?.hz)}`,
      title: crossing.reason,
    };
  }
  return crossing.status === 'unchecked'
    ? { tone: 'muted', text: '? clock unknown', title: crossing.reason }
    : { tone: 'ok', text: `✓ ${to.domain?.name ?? 'released'}`, title: crossing.reason };
}

function isReset(crossing: Crossing): crossing is PinCrossing {
  return crossing.kind === 'reset';
}

/** The check of every sink of a reset source, by sink key (see `endKey`). */
export function resetSinkChecks(
  analysis: ClockAnalysis,
  reset: ResetSource
): ReadonlyMap<string, RowCheck> {
  const checks = new Map<string, RowCheck>();
  for (const crossing of analysis.crossings.filter(isReset)) {
    if (endKey(crossing.from) === endKey(reset.source)) {
      checks.set(endKey(crossing.to), resetCheck(crossing));
    }
  }
  return checks;
}

/** What else the analysis knows about a clock domain. */
export interface DomainRelations {
  /** Reset sources released on the domain. */
  resets: ResetSource[];
  /** Flagged data crossings with the domain at one end. */
  crossings: PinCrossing[];
  /** Blocks that have clocks on this and another domain. */
  spanning: BlockCrossing[];
}

export function domainRelations(analysis: ClockAnalysis, domain: ClockDomain): DomainRelations {
  return {
    resets: analysis.resets.filter((reset) => reset.domain === domain),
    crossings: analysis.crossings.filter(
      (crossing): crossing is PinCrossing =>
        crossing.kind === 'data' &&
        crossing.status === 'cross' &&
        (crossing.from.domain === domain || crossing.to.domain === domain)
    ),
    spanning: analysis.crossings.filter(
      (crossing): crossing is BlockCrossing =>
        crossing.kind === 'block' && crossing.domains.includes(domain)
    ),
  };
}

/** The flagged reset crossings of a reset source and the domains of the sinks they hit. */
export function resetRelations(
  analysis: ClockAnalysis,
  reset: ResetSource
): { crossings: PinCrossing[]; domains: ClockDomain[] } {
  const crossings = analysis.crossings.filter(
    (crossing): crossing is PinCrossing =>
      isReset(crossing) &&
      crossing.status === 'cross' &&
      endKey(crossing.from) === endKey(reset.source)
  );
  const domains = new Set<ClockDomain>();
  for (const crossing of crossings) {
    if (crossing.to.domain) {
      domains.add(crossing.to.domain);
    }
  }
  return { crossings, domains: [...domains].sort((a, b) => a.index - b.index) };
}

/** The data crossings that touch a net, for the note in its details; fine ones are listed once per reason. */
export function netCrossings(analysis: ClockAnalysis, netId: string): PinCrossing[] {
  const found = analysis.crossings.filter(
    (crossing): crossing is PinCrossing =>
      crossing.kind === 'data' && crossing.netIds.includes(netId)
  );
  return found.filter(
    (crossing, index) =>
      crossing.status !== 'ok' ||
      found.findIndex((other) => other.status === 'ok' && other.reason === crossing.reason) ===
        index
  );
}
