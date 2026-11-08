/** What a diagram node draws on its pins in the domain mode or for a selected clock tree. */

import type { PinRef, SystemGraph, SystemPin } from '../../../domain/systemGraph';
import { parseBoundaryId } from '../model';
import type { ClockAnalysis } from './analyzeClocks';
import { pinDomainColor, pinFrequencyLabel } from './domainView';
import { occurrenceKey } from './physicalNets';
import type { SelectedTree } from './treeSelection';

export interface PinMark {
  /** Marker color: the domain of a clock pin, the releasing domain of a reset pin. */
  color?: string;
  /** Frequency label of a clock pin on a known domain. */
  frequency?: string;
  /** The pin is an end of a flagged crossing. */
  crossing?: true;
}

/** Marks by pin name; pins without a mark are absent. */
export type PinMarks = Readonly<Record<string, PinMark>>;

/** Whether any pin of a node ends a flagged crossing: the node is drawn with the warning border. */
export function hasCrossingEnd(pinMarks: PinMarks | undefined): boolean {
  return Object.values(pinMarks ?? {}).some((mark) => mark.crossing);
}

/**
 * Whether the frequency of a clock pin sits below its wire: on the west side, or where a net
 * badge takes the place above. Otherwise it sits above, so the labels at the two ends of a short
 * wire never overlap.
 */
export function frequencyBelowWire(side: 'west' | 'east', hasBadge: boolean): boolean {
  return side === 'west' || hasBadge;
}

export interface PinMarkContext {
  graph: SystemGraph;
  analysis: ClockAnalysis;
  domainMode: boolean;
  tree: SelectedTree | undefined;
  /** Pin occurrences that end a flagged crossing (see `crossingEndKeys`). */
  crossingKeys: ReadonlySet<string>;
}

/** The pins of a diagram node, each as seen on the level where the node is drawn. */
function nodePins(
  graph: SystemGraph,
  nodeId: string
): { level: string; pins: { pin: SystemPin; ref: PinRef }[] } | undefined {
  const instance = graph.instances[nodeId];
  if (instance) {
    return {
      level: instance.parent,
      pins: instance.pins.map((pin) => ({ pin, ref: { instance: nodeId, pin: pin.name } })),
    };
  }
  const { level, pin: name } = parseBoundaryId(nodeId);
  const pin = graph.levels[level]?.boundaryPins.find((candidate) => candidate.name === name);
  return pin && { level, pins: [{ pin, ref: { instance: null, pin: name } }] };
}

/** Marks of the pins of a node; undefined when it has none. */
export function nodePinMarks(ctx: PinMarkContext, nodeId: string): PinMarks | undefined {
  const { analysis, domainMode, tree } = ctx;
  const node = nodePins(ctx.graph, nodeId);
  if (!node) {
    return undefined;
  }
  const marks: Record<string, PinMark> = {};
  for (const { pin, ref } of node.pins) {
    const clock = analysis.domainOfPin(node.level, ref);
    const shown =
      clock !== undefined && (domainMode || (tree?.kind === 'clock' && tree.domain === clock));
    const color = clock
      ? shown
        ? clock.color
        : undefined
      : domainMode
        ? pinDomainColor(analysis, node.level, ref)
        : undefined;
    const frequency = shown ? pinFrequencyLabel(analysis, node.level, ref) : undefined;
    const crossing = domainMode && ctx.crossingKeys.has(occurrenceKey(node.level, ref));
    if (color !== undefined || frequency !== undefined || crossing) {
      marks[pin.name] = {
        ...(color !== undefined && { color }),
        ...(frequency !== undefined && { frequency }),
        ...(crossing && { crossing: true as const }),
      };
    }
  }
  return Object.keys(marks).length > 0 ? marks : undefined;
}
