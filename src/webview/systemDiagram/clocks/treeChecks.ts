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
import { nameWithFrequency } from './frequency';
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
    : { tone: 'muted', text: `? ${text}`, title: 'The script sets no frequency for this domain' };
}

/** The check of a reset sink: released on its own clock, on another one, on a related one, or not checkable. */
export function resetCheck(crossing: PinCrossing): RowCheck {
  const { to } = crossing;
  if (to.async) {
    return { tone: 'ok', text: '✓ asynchronous input', title: crossing.reason };
  }
  if (crossing.from.constant) {
    return { tone: 'ok', text: '✓ tied to a constant', title: crossing.reason };
  }
  if (crossing.status === 'cross') {
    return {
      tone: 'warning',
      text: `✗ clocked by ${to.domain ? nameWithFrequency(to.domain) : 'unknown'}`,
      title: crossing.reason,
    };
  }
  if (crossing.status === 'related') {
    return { tone: 'ok', text: '≈ related clocks', title: crossing.reason };
  }
  if (crossing.status === 'unchecked') {
    return {
      tone: 'muted',
      text: crossing.from.sourceUnknown ? '? source not known' : '? clock unknown',
      title: crossing.reason,
    };
  }
  return { tone: 'ok', text: `✓ ${to.domain?.name ?? 'released'}`, title: crossing.reason };
}

/** Keeps the first crossing of each reason: a generator with many connections has one note. */
export function uniqueByReason(crossings: readonly PinCrossing[]): PinCrossing[] {
  return crossings.filter(
    (crossing, index) => crossings.findIndex((other) => other.reason === crossing.reason) === index
  );
}

function isReset(crossing: Crossing): crossing is PinCrossing {
  return crossing.kind === 'reset';
}

/** The reset crossings of a reset source: its net ids are those of the crossing, and no other source shares one. */
function resetCrossingsOf(analysis: ClockAnalysis, reset: ResetSource): PinCrossing[] {
  return analysis.crossings.filter(
    (crossing): crossing is PinCrossing =>
      isReset(crossing) && crossing.netIds.includes(reset.netId)
  );
}

/** The check of every sink of a reset source, by sink key (see `endKey`). */
export function resetSinkChecks(
  analysis: ClockAnalysis,
  reset: ResetSource
): ReadonlyMap<string, RowCheck> {
  const checks = new Map<string, RowCheck>();
  for (const crossing of resetCrossingsOf(analysis, reset)) {
    checks.set(endKey(crossing.to), resetCheck(crossing));
  }
  return checks;
}

/** What else the analysis knows about a clock domain. */
export interface DomainRelations {
  /** Reset sources released on the domain. */
  resets: ResetSource[];
  /** Flagged data crossings with the domain at one end. */
  crossings: PinCrossing[];
  /** Data connections between the domain and a related one. */
  related: PinCrossing[];
  /** Blocks that have clocks on this and another domain. */
  spanning: BlockCrossing[];
}

export function domainRelations(analysis: ClockAnalysis, domain: ClockDomain): DomainRelations {
  const dataOf = (status: Crossing['status']) =>
    analysis.crossings.filter(
      (crossing): crossing is PinCrossing =>
        crossing.kind === 'data' &&
        crossing.status === status &&
        (crossing.from.domain === domain || crossing.to.domain === domain)
    );
  return {
    resets: analysis.resets.filter((reset) => reset.domain === domain),
    crossings: dataOf('cross'),
    related: uniqueByReason(dataOf('related')),
    spanning: analysis.crossings.filter(
      (crossing): crossing is BlockCrossing =>
        crossing.kind === 'block' && crossing.domains.includes(domain)
    ),
  };
}

/** The flagged and the related reset crossings of a reset source, and the domains of the sinks the flagged ones hit. */
export function resetRelations(
  analysis: ClockAnalysis,
  reset: ResetSource
): { crossings: PinCrossing[]; related: PinCrossing[]; domains: ClockDomain[] } {
  const of = (status: Crossing['status']) =>
    resetCrossingsOf(analysis, reset).filter((crossing) => crossing.status === status);
  const crossings = of('cross');
  const domains = new Set<ClockDomain>();
  for (const crossing of crossings) {
    if (crossing.to.domain) {
      domains.add(crossing.to.domain);
    }
  }
  return {
    crossings,
    related: uniqueByReason(of('related')),
    domains: [...domains].sort((a, b) => a.index - b.index),
  };
}

/** The data crossings that touch a net, for the note in its details; fine and related ones are listed once per reason. */
export function netCrossings(analysis: ClockAnalysis, netId: string): PinCrossing[] {
  const found = analysis.crossings.filter(
    (crossing): crossing is PinCrossing =>
      crossing.kind === 'data' && crossing.netIds.includes(netId)
  );
  const repeats = (crossing: PinCrossing) =>
    crossing.status === 'ok' || crossing.status === 'related';
  return found.filter(
    (crossing, index) =>
      !repeats(crossing) ||
      found.findIndex(
        (other) => other.status === crossing.status && other.reason === crossing.reason
      ) === index
  );
}
