/** Canvas view helpers of the domain mode: pin colors, frequency labels, node domain strips. */

import type { PinRef, SystemGraph } from '../../../domain/systemGraph';
import type { ClockAnalysis } from './analyzeClocks';
import { crossingCountText, crossingsWithin, nodeCrossings, plural } from './crossingSummary';
import { formatHz, nameWithFrequency } from './frequency';

/** Marker color of a reset that is asynchronous or released by an unknown clock. */
export const UNRELEASED_RESET_COLOR = 'var(--vscode-descriptionForeground)';

/** Marker color of a pin: the domain of a clock pin, the releasing domain of a reset pin; undefined for other pins. */
export function pinDomainColor(
  analysis: ClockAnalysis,
  level: string,
  ref: PinRef
): string | undefined {
  const domain = analysis.domainOfPin(level, ref);
  if (domain) {
    return domain.color;
  }
  const reset = analysis.resetOfPin(level, ref);
  return reset && (reset.domain?.color ?? UNRELEASED_RESET_COLOR);
}

/** Frequency label of a clock pin on a domain whose frequency the script sets; undefined for other pins. */
export function pinFrequencyLabel(
  analysis: ClockAnalysis,
  level: string,
  ref: PinRef
): string | undefined {
  const domain = analysis.domainOfPin(level, ref);
  return domain?.hz === undefined ? undefined : formatHz(domain.hz);
}

/** One segment of a node's domain strip. */
export interface DomainSegment {
  /** The domain's id, a stable key. */
  id: string;
  name: string;
  color: string;
}

/** What a diagram node needs to draw the domain mode. */
export interface NodeDomains {
  /** One segment per clock domain of the node, in domain order. */
  segments: DomainSegment[];
  /** Flagged data crossings on the node's pins, or inside a hierarchy block. */
  cdc: number;
  /** Flagged reset crossings on the node's pins, or inside a hierarchy block. */
  rdc: number;
}

export function nodeDomains(
  analysis: ClockAnalysis,
  graph: SystemGraph,
  nodeId: string
): NodeDomains {
  const { data, reset } = nodeCrossings(graph, analysis.crossings, nodeId);
  return {
    segments: analysis
      .instanceDomains(nodeId)
      .map((domain) => ({ id: domain.id, name: domain.name, color: domain.color })),
    cdc: data,
    rdc: reset,
  };
}

/** Header badge of a node in the domain mode. */
export interface DomainBadge {
  text: string;
  /** Crossings are flagged (warning tone); otherwise the node only spans several domains. */
  warning: boolean;
  /** Spoken and tooltip text. */
  label: string;
}

/** The crossings on a node, else a note that it spans domains; undefined when neither applies. */
export function domainBadge({ segments, cdc, rdc }: NodeDomains): DomainBadge | undefined {
  if (cdc > 0 || rdc > 0) {
    return {
      text: crossingCountText(cdc, rdc),
      warning: true,
      label: [
        cdc > 0 ? plural(cdc, 'clock domain crossing', 'clock domain crossings') : '',
        rdc > 0 ? plural(rdc, 'reset domain crossing', 'reset domain crossings') : '',
      ]
        .filter(Boolean)
        .join(' and '),
    };
  }
  return segments.length > 1
    ? {
        text: `${segments.length} DOMAINS`,
        warning: false,
        label: `Clocks on ${segments.length} domains: ${segments.map((segment) => segment.name).join(', ')}`,
      }
    : undefined;
}

/** What an outline row shows in the domain mode. */
export interface OutlineDomains {
  /** One dot per clock domain of the block. */
  colors: string[];
  /** `name frequency` per domain (the name alone without a frequency), for the dots' tooltip. */
  title: string;
  /** Flagged crossings inside a hierarchy block; 0 for a leaf block. */
  crossings: number;
}

export function outlineDomains(
  analysis: ClockAnalysis,
  graph: SystemGraph,
  instancePath: string
): OutlineDomains {
  const domains = analysis.instanceDomains(instancePath);
  const inside =
    graph.instances[instancePath]?.kind === 'hier'
      ? crossingsWithin(analysis.crossings, instancePath)
      : { data: 0, reset: 0 };
  return {
    colors: domains.map((domain) => domain.color),
    title: domains.map((domain) => nameWithFrequency(domain, ' ')).join(', '),
    crossings: inside.data + inside.reset,
  };
}
