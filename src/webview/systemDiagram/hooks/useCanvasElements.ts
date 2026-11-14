import { useMemo } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import type { HighlightMap } from '../../../shared/messages/systemDiagram';
import { selectedTree } from '../clocks/treeSelection';
import { changeDecor, type ChangeContext } from '../changeDecor';
import { clockDecor, clockNodeData, type ClockContext } from '../clockDecor';
import {
  highlightedEdgesLast,
  highlightedNetColors,
  highlightedNetIds,
  netHighlightColor,
  nodeHighlightColor,
} from '../highlights';
import type { DiagramLayout } from './useElkLayout';
import type { SearchFlash } from './useSearchStepper';
import { badgedNodeIds, highlightedPinsByNode } from '../pinHighlight';
import { boundaryMatchesQuery, matchesQuery, type Selection } from '../model';
import { focusedPinOf, nodeReview, type FocusedPin, type UnconnectedPin } from '../unconnectedPins';
import type { PinHoverTarget } from '../model';
import type { TextMatcher } from '../searchMatcher';
import { useStableElements } from './useStableElements';

/** Class of the node wrapper that fades a dimmed block (see systemDiagram.css). */
export const DIMMED_CLASS = 'sd-dimmed';

interface CanvasElementsInput {
  layout: DiagramLayout | null;
  selection: Selection | null;
  selectedIds: ReadonlySet<string>;
  selectedNetIds?: ReadonlySet<string>;
  highlights?: HighlightMap;
  review: { graph: SystemGraph; findings: readonly UnconnectedPin[] } | null;
  clocks: ClockContext;
  /** The marks of a comparison; null while Marks is off or without a comparison. */
  changes: ChangeContext | null;
  focusedPin: FocusedPin | null;
  matcher: TextMatcher | null;
  flash?: SearchFlash | null;
  onFlashEnd?: (token: number) => void;
  onSelectNet: (netId: string, additive?: boolean) => void;
  onHoverPin: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
  onToggleExpand: (instancePath: string) => void;
}

/**
 * The React Flow nodes and edges of a layout with everything the canvas draws on top of it
 * (search dimming, selection, highlights, clock and review decoration). Node and edge objects
 * are reused while what they draw is unchanged, so React Flow skips them.
 */
export function useCanvasElements({
  layout,
  selection,
  selectedIds,
  selectedNetIds,
  highlights,
  review,
  clocks,
  changes,
  focusedPin,
  matcher,
  flash,
  onFlashEnd,
  onSelectNet,
  onHoverPin,
  onToggleExpand,
}: CanvasElementsInput) {
  const activeSelectedNetIds = useMemo(
    () =>
      selectedNetIds ?? (selection?.kind === 'net' ? new Set([selection.id]) : new Set<string>()),
    [selectedNetIds, selection]
  );
  const showHighlights = review === null;

  // Only a selected clock or reset net changes the decoration, so any other selection keeps
  // the previous decor (and the per-node objects in it) instead of rebuilding it.
  const decorSelection = selectedTree(clocks.analysis, selection) ? selection : null;
  const decor = useMemo(
    () => clockDecor(layout, clocks, decorSelection),
    [layout, clocks, decorSelection]
  );
  const { tree } = decor;
  // The marks depend on the layout and the comparison only, so a selection keeps the same objects.
  const look = useMemo(() => (changes ? changeDecor(layout, changes) : null), [layout, changes]);

  const selectedAndTreeNetIds = useMemo(
    () => (tree ? new Set([...activeSelectedNetIds, ...tree.netIds]) : activeSelectedNetIds),
    [activeSelectedNetIds, tree]
  );
  const highlighted = useMemo(() => {
    const activeNetIds = new Set(selectedAndTreeNetIds);
    if (showHighlights && highlights) {
      for (const netId of highlightedNetIds(highlights)) {
        activeNetIds.add(netId);
      }
    }
    return activeNetIds.size > 0 && layout
      ? highlightedPinsByNode(activeNetIds, layout.edges, layout.nodes)
      : undefined;
  }, [selectedAndTreeNetIds, showHighlights, highlights, layout]);
  // Only the nodes that draw a badge on a selected net read the selected nets.
  const badgedNodes = useMemo(
    () =>
      selectedAndTreeNetIds.size > 0 && layout
        ? badgedNodeIds(selectedAndTreeNetIds, layout.nodes)
        : undefined,
    [selectedAndTreeNetIds, layout]
  );
  const highlightColors = useMemo(
    () => (showHighlights && highlights ? highlightedNetColors(highlights) : undefined),
    [showHighlights, highlights]
  );
  const highlightBadgedNodes = useMemo(
    () =>
      highlightColors && highlightColors.size > 0 && layout
        ? badgedNodeIds(new Set(highlightColors.keys()), layout.nodes)
        : undefined,
    [highlightColors, layout]
  );
  const reviews = useMemo(
    () =>
      review && layout
        ? new Map(
            layout.nodes.map((node) => [
              node.id,
              nodeReview(review.findings, node.id, review.graph),
            ])
          )
        : undefined,
    [review, layout]
  );

  const builtNodes = useMemo(() => {
    return (layout?.nodes ?? []).map((node) => {
      const dimmed =
        (matcher !== null &&
          (node.type === 'boundary'
            ? !boundaryMatchesQuery(node.data.pin, matcher)
            : !matchesQuery(node.data.instance, matcher))) ||
        // A selected clock or reset tree dims the blocks and ports it does not touch.
        (tree !== undefined && node.type !== 'frame' && !highlighted?.has(node.id));
      const focused = focusedPinOf(focusedPin, selection, node.id);
      const highlightColor =
        showHighlights && highlights ? nodeHighlightColor(highlights, node.id) : undefined;
      return {
        ...node,
        // Dimming only fades the block, so it is a class on the node wrapper, not data.
        ...(dimmed && { className: DIMMED_CLASS }),
        selected: selectedIds.has(node.id),
        data: {
          ...node.data,
          // A ghost (what only the base has) is not part of the design the review checks.
          ...(reviews &&
            look?.nodes.get(node.id)?.status !== 'removed' && {
              review: reviews.get(node.id),
            }),
          ...clockNodeData(decor, node.id),
          ...(look?.nodes.has(node.id) && { change: look.nodes.get(node.id) }),
          ...(badgedNodes?.has(node.id) && { selectedNetIds: selectedAndTreeNetIds }),
          ...(highlightBadgedNodes?.has(node.id) && { highlightColors }),
          ...(highlightColor !== undefined && { highlightColor }),
          ...(focused !== undefined && { focusedPin: focused }),
          ...(highlighted?.has(node.id) && { highlightedPins: highlighted.get(node.id) }),
          onSelectNet,
          onHoverPin,
          onToggleExpand,
          ...(flash?.id === node.id && { flashToken: flash.token, onFlashEnd }),
        },
      };
    });
  }, [
    layout,
    matcher,
    flash,
    onFlashEnd,
    selection,
    selectedIds,
    selectedAndTreeNetIds,
    badgedNodes,
    highlightColors,
    highlightBadgedNodes,
    highlighted,
    showHighlights,
    highlights,
    reviews,
    decor,
    look,
    tree,
    focusedPin,
    onSelectNet,
    onHoverPin,
    onToggleExpand,
  ]);
  const nodes = useStableElements(builtNodes);

  const builtEdges = useMemo(
    () =>
      highlightedEdgesLast(
        (layout?.edges ?? []).map((edge) => {
          const marks = decor.edges.get(edge.id);
          const changeNew = look?.newEdgeIds.has(edge.id) ? (true as const) : undefined;
          const changeRemoved = look?.removedEdgeIds?.has(edge.id) ? (true as const) : undefined;
          const highlightColor =
            showHighlights && highlights
              ? netHighlightColor(highlights, edge.data.netId)
              : undefined;
          return {
            ...edge,
            selected:
              activeSelectedNetIds.has(edge.data.netId) ||
              (selection?.kind === 'net' &&
                (tree ? tree.netIds.has(edge.data.netId) : selection.id === edge.data.netId)),
            ...((marks !== undefined ||
              highlightColor !== undefined ||
              changeNew !== undefined ||
              changeRemoved !== undefined) && {
              data: {
                ...edge.data,
                ...marks,
                ...(changeNew && { changeNew }),
                ...(changeRemoved && { changeRemoved }),
                ...(highlightColor !== undefined && { highlightColor }),
              },
            }),
          };
        })
      ),
    [layout, selection, activeSelectedNetIds, decor, look, tree, showHighlights, highlights]
  );
  const edges = useStableElements(builtEdges);

  return { nodes, edges, decor, changeLegend: look?.legend ?? null };
}
