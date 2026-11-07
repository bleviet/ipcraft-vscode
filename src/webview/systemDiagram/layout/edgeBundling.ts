/**
 * Bus bundling: parallel connections between the same two blocks are drawn as
 * one trunk wire. Pure: no ELK, no React. ELK routes one edge per bundle,
 * between one representative port at each end; the other member pins join the
 * trunk through short comb branches drawn after the layout.
 */

import type { NetCategory } from '../../../domain/systemGraph';
import { categoryShort } from '../legend';
import { isClockOrReset } from '../model';
import { PIN_ROW_HEIGHT } from './pinRows';

/** Distance of the comb line from the node border. */
export const COMB_OFFSET = 10;

/** Bundling as a layout input: the bundle keys the user chose to draw as separate wires. */
export interface BusBundling {
  unbundled: ReadonlySet<string>;
}

/** One drawn connection inside a bundle; the handles are the pin names after pin folding. */
export interface BundleMember {
  edgeId: string;
  netId: string;
  sourcePin: string;
  targetPin: string;
  sourceHandle: string;
  targetHandle: string;
}

/** A connection of the current level, ends already attached to the ports ELK sees. */
export interface BundleCandidate extends BundleMember {
  sourceNode: string;
  targetNode: string;
  category: NetCategory;
  isInterface: boolean;
}

/** Where a port sits on its block: its centre y and the border it is on. */
export interface PortSpot {
  y: number;
  side: 'east' | 'west';
}

/** The ports of the nodes that may be bundled, by node id then handle. */
export type PortYs = ReadonlyMap<string, ReadonlyMap<string, PortSpot>>;

export interface Bundle {
  /** Also the id of the ELK and React Flow edge. */
  key: string;
  sourceNode: string;
  targetNode: string;
  category: NetCategory;
  isInterface: boolean;
  members: BundleMember[];
  /** Representative handles: the trunk runs between these. */
  sourceHandle: string;
  targetHandle: string;
  /** Distinct member handles at each end, top to bottom. */
  sourceHandles: string[];
  targetHandles: string[];
}

export interface BundlePlan {
  bundles: Bundle[];
  rest: BundleCandidate[];
}

export interface Point {
  x: number;
  y: number;
}

export function bundleKey(candidate: BundleCandidate): string {
  const { sourceNode, targetNode, category, isInterface } = candidate;
  return `bundle:${sourceNode}->${targetNode}|${category}|${isInterface ? 'i' : 's'}`;
}

/** The distinct handles of one end, top to bottom, when they sit on one side on consecutive rows. */
function contiguousHandles(
  ports: ReadonlyMap<string, PortSpot> | undefined,
  handles: readonly string[]
): string[] | undefined {
  const distinct = [...new Set(handles)];
  if (!ports || distinct.some((handle) => !ports.has(handle))) {
    return undefined;
  }
  distinct.sort((a, b) => ports.get(a)!.y - ports.get(b)!.y);
  const contiguous = distinct.every(
    (handle, index) =>
      ports.get(handle)!.side === ports.get(distinct[0])!.side &&
      (index === 0 || ports.get(handle)!.y - ports.get(distinct[index - 1])!.y === PIN_ROW_HEIGHT)
  );
  return contiguous ? distinct : undefined;
}

const median = (handles: readonly string[]) => handles[Math.floor((handles.length - 1) / 2)];

/**
 * Groups `candidates` into bundles by (source block, target block, category,
 * interface-ness). A group needs two or more connections, is not a clock or
 * reset, is not in `unbundled`, and has its member pins on consecutive rows at
 * both ends; otherwise its connections stay in `rest`.
 */
export function planBundles(
  candidates: readonly BundleCandidate[],
  ports: PortYs,
  unbundled: ReadonlySet<string>
): BundlePlan {
  const groups = new Map<string, BundleCandidate[]>();
  const rest: BundleCandidate[] = [];
  for (const candidate of candidates) {
    if (isClockOrReset(candidate)) {
      rest.push(candidate);
      continue;
    }
    const key = bundleKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  const bundles: Bundle[] = [];
  for (const [key, members] of groups) {
    const { sourceNode, targetNode, category, isInterface } = members[0];
    const sourceHandles =
      members.length >= 2 && !unbundled.has(key)
        ? contiguousHandles(
            ports.get(sourceNode),
            members.map((member) => member.sourceHandle)
          )
        : undefined;
    const targetHandles =
      sourceHandles &&
      contiguousHandles(
        ports.get(targetNode),
        members.map((member) => member.targetHandle)
      );
    if (!sourceHandles || !targetHandles) {
      rest.push(...members);
      continue;
    }
    bundles.push({
      key,
      sourceNode,
      targetNode,
      category,
      isInterface,
      members: members.map(
        ({ edgeId, netId, sourcePin, targetPin, sourceHandle, targetHandle }) => ({
          edgeId,
          netId,
          sourcePin,
          targetPin,
          sourceHandle,
          targetHandle,
        })
      ),
      sourceHandle: median(sourceHandles),
      targetHandle: median(targetHandles),
      sourceHandles,
      targetHandles,
    });
  }
  return { bundles, rest };
}

/** Badge text of a bundle, e.g. `×12 AXI`. */
export function bundleLabel(category: NetCategory, count: number): string {
  return `×${count} ${categoryShort(category)}`;
}

/** One end of a bundle in absolute coordinates. */
export interface BundleEnd {
  side: 'east' | 'west';
  /** x of the node border the pins sit on. */
  borderX: number;
  /** Centre of each member pin marker, by handle. */
  centres: ReadonlyMap<string, Point>;
}

/**
 * Comb branches of one end: for each distinct handle but the representative,
 * from its marker centre out to the comb line, then along it to the trunk.
 */
export function endBranches(
  end: BundleEnd,
  handles: readonly string[],
  representative: string
): Point[][] {
  const trunkY = end.centres.get(representative)?.y;
  if (trunkY === undefined) {
    return [];
  }
  const combX = end.side === 'east' ? end.borderX + COMB_OFFSET : end.borderX - COMB_OFFSET;
  return handles.flatMap((handle) => {
    const centre = end.centres.get(handle);
    return handle === representative || !centre
      ? []
      : [[centre, { x: combX, y: centre.y }, { x: combX, y: trunkY }]];
  });
}
