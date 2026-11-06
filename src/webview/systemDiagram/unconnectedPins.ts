/**
 * Pure review of pins that no net touches on their level (issue #245). A sink
 * without a net is "undriven"; a source (or role-less pin) without a net is
 * "unused". Only pins with a known pin list can be reviewed.
 */

import type { SystemGraph, SystemInstance, SystemPin } from '../../domain/systemGraph';
import { endpointRole } from '../../domain/systemGraphRoles';
import { boundaryId, endpointKey, netsByEndpoint, shortVlnv } from './model';
import { levelSource, type LevelSource } from './sourceFile';

export type UnconnectedClass = 'undriven' | 'unused';

/** One pin with no net on the level it is seen on. */
export interface UnconnectedPin {
  /** Level path the pin is seen on. */
  level: string;
  /** Instance path, or `boundaryId(level, pin.name)` for a boundary pin. */
  nodeId: string;
  /** Null for a boundary pin of `level`. */
  instance: string | null;
  pin: SystemPin;
  cls: UnconnectedClass;
}

/** The pin to halo while its node is the primary selection. */
export interface FocusedPin {
  nodeId: string;
  pin: string;
}

/** The single place that classifies an unconnected pin. */
export function unconnectedClass(
  pin: Pick<SystemPin, 'direction'>,
  isBoundary: boolean
): UnconnectedClass {
  return endpointRole(pin.direction, isBoundary) === 'sink' ? 'undriven' : 'unused';
}

/** Whether the full pin list of the instance is known (not just pins seen in connections). */
export function isPinListKnown(instance: SystemInstance): boolean {
  return instance.kind === 'hier' || instance.definition !== undefined;
}

export function unconnectedPins(graph: SystemGraph): UnconnectedPin[] {
  const found: UnconnectedPin[] = [];
  for (const [level, info] of Object.entries(graph.levels)) {
    const lookup = netsByEndpoint(graph, level);
    for (const path of info.instances) {
      const instance = graph.instances[path];
      for (const pin of instance?.pins ?? []) {
        if (!lookup.has(endpointKey({ instance: path, pin: pin.name }))) {
          found.push({
            level,
            nodeId: path,
            instance: path,
            pin,
            cls: unconnectedClass(pin, false),
          });
        }
      }
    }
    for (const pin of info.boundaryPins) {
      if (!lookup.has(endpointKey({ instance: null, pin: pin.name }))) {
        found.push({
          level,
          nodeId: boundaryId(level, pin.name),
          instance: null,
          pin,
          cls: unconnectedClass(pin, true),
        });
      }
    }
  }
  return [
    ...found.filter((finding) => finding.cls === 'undriven'),
    ...found.filter((finding) => finding.cls === 'unused'),
  ];
}

/** Instances whose pin list is not known; of one level when `levelPath` is given, else of all. */
export function uncheckedInstanceCount(graph: SystemGraph, levelPath?: string): number {
  const paths =
    levelPath === undefined
      ? Object.keys(graph.instances)
      : (graph.levels[levelPath]?.instances ?? []);
  return paths.filter((path) => {
    const instance = graph.instances[path];
    return instance !== undefined && !isPinListKnown(instance);
  }).length;
}

function isInside(level: string, path: string): boolean {
  return level === path || level.startsWith(`${path}/`);
}

/** Findings on the node, plus those on every level inside it when it is a hierarchy block. */
export function nodeUnconnectedCount(
  findings: readonly UnconnectedPin[],
  nodeId: string,
  graph: SystemGraph
): { all: number; undriven: number } {
  const isHier = graph.instances[nodeId]?.kind === 'hier';
  const matching = findings.filter(
    (finding) => finding.nodeId === nodeId || (isHier && isInside(finding.level, nodeId))
  );
  return {
    all: matching.length,
    undriven: matching.filter((finding) => finding.cls === 'undriven').length,
  };
}

/** What a diagram node needs to draw the review: its counts and whether its pins were checked. */
export interface NodeReview {
  all: number;
  undriven: number;
  pinListKnown: boolean;
}

export function nodeReview(
  findings: readonly UnconnectedPin[],
  nodeId: string,
  graph: SystemGraph
): NodeReview {
  const instance = graph.instances[nodeId];
  return {
    ...nodeUnconnectedCount(findings, nodeId, graph),
    pinListKnown: instance === undefined || isPinListKnown(instance),
  };
}

/** Banner text for the level on show. */
export function levelReviewSummary(
  findings: readonly UnconnectedPin[],
  graph: SystemGraph,
  levelPath: string
): string {
  const own = findings.filter((finding) => finding.level === levelPath);
  const undriven = own.filter((finding) => finding.cls === 'undriven').length;
  const prefix = levelPath === '/' ? '/' : `${levelPath}/`;
  const inner = findings.filter(
    (finding) => finding.level !== levelPath && finding.level.startsWith(prefix)
  ).length;
  const unchecked = uncheckedInstanceCount(graph, levelPath);
  let text = `This level: ${undriven} undriven, ${own.length - undriven} unused`;
  if (inner > 0) {
    text += `; ${inner} more inside nested hierarchies`;
  }
  text += '.';
  if (unchecked > 0) {
    text += ` ${unchecked} ${unchecked === 1 ? 'block (dashed) has' : 'blocks (dashed) have'} no pin definition and ${unchecked === 1 ? 'was' : 'were'} not checked.`;
  }
  return text;
}

/** Table cells of one finding. */
export interface FindingRow {
  block: string;
  level: string;
  type: string;
  knownFrom: string;
  /** Where the instance or boundary pin is written; absent without a line. */
  link?: { source: LevelSource; line: number };
}

export function findingRow(graph: SystemGraph, finding: UnconnectedPin): FindingRow {
  const { pin, level } = finding;
  const instance = finding.instance === null ? undefined : graph.instances[finding.instance];
  const levelName = level === '/' ? graph.name : (graph.levels[level]?.name ?? level);
  const block = instance
    ? instance.name
    : level === '/'
      ? 'external port'
      : `${levelName} (hierarchy pin)`;
  const type =
    pin.interfaceType ??
    (pin.vlnv ? shortVlnv(pin.vlnv) : undefined) ??
    pin.signalType ??
    (pin.isInterface ? 'interface' : 'signal');
  const knownFrom = instance && instance.kind !== 'hier' ? (pin.definedBy ?? '-') : 'declared';
  const line = instance ? instance.line : pin.line;
  return {
    block,
    level: levelName,
    type,
    knownFrom,
    ...(line !== undefined && {
      link: { source: levelSource(graph, instance ? instance.parent : level), line },
    }),
  };
}
