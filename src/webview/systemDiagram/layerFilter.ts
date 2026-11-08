/** Legend layer filters: which wire categories are hidden. Pure; draw-only, never a layout input. */

import type { NetCategory } from '../../domain/systemGraph';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/diagramTypes';

export type HiddenLayers = ReadonlySet<NetCategory>;

export const NO_HIDDEN_LAYERS: HiddenLayers = new Set();

/** Hides `category`, or shows it again when hidden. */
export function toggleLayer(hidden: HiddenLayers, category: NetCategory): HiddenLayers {
  const next = new Set(hidden);
  if (!next.delete(category)) {
    next.add(category);
  }
  return next;
}

/** Whether `category` is the only one of `all` that is shown. */
export function isSoloLayer(
  hidden: HiddenLayers,
  category: NetCategory,
  all: readonly NetCategory[]
): boolean {
  return all.every((other) => (other === category ? !hidden.has(other) : hidden.has(other)));
}

/** Shows only `category` of `all`; when it already is the only one, shows all. */
export function soloLayer(
  hidden: HiddenLayers,
  category: NetCategory,
  all: readonly NetCategory[]
): HiddenLayers {
  return isSoloLayer(hidden, category, all)
    ? NO_HIDDEN_LAYERS
    : new Set(all.filter((other) => other !== category));
}

export interface LaidOutElements {
  nodes: readonly DiagramFlowNode[];
  edges: readonly DiagramFlowEdge[];
}

/**
 * `layout` without the wires of the hidden legend categories (a bundle by its
 * category). Nodes are untouched, so no block moves; the same object when
 * nothing is hidden.
 */
export function withoutHiddenLayers(
  layout: LaidOutElements,
  hidden: HiddenLayers
): LaidOutElements {
  return hidden.size === 0
    ? layout
    : {
        nodes: layout.nodes,
        edges: layout.edges.filter((edge) => !hidden.has(edge.data.category)),
      };
}
