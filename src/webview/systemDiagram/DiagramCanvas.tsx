import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { BoundaryNode } from './BoundaryNode';
import { DiagramContextMenu, type ContextMenuItem } from './DiagramContextMenu';
import { DiagramLegend } from './DiagramLegend';
import { ElkEdge } from './ElkEdge';
import { InstanceNode } from './InstanceNode';
import { isPaneDoubleClick } from './canvasTargets';
import { PinHoverCard } from './PinHoverCard';
import { usePinHover } from './hooks/usePinHover';
import type { DiagramLayout } from './hooks/useElkLayout';
import type { SystemGraph } from '../../domain/systemGraph';
import type { InstanceNodeData } from './layout/diagramTypes';
import type { SearchFlash } from './hooks/useSearchStepper';
import { highlightedPinsByNode } from './pinHighlight';
import { boundaryMatchesQuery, matchesQuery, nodeSelection, type Selection } from './model';
import {
  levelReviewSummary,
  nodeReview,
  type FocusedPin,
  type UnconnectedPin,
} from './unconnectedPins';

/** Everything the canvas needs to draw the unconnected-pin review; null while the review is off. */
export interface ReviewContext {
  graph: SystemGraph;
  levelPath: string;
  findings: readonly UnconnectedPin[];
}

const NODE_TYPES: NodeTypes = { instance: InstanceNode, boundary: BoundaryNode };
const EDGE_TYPES: EdgeTypes = { elk: ElkEdge };

interface DiagramCanvasProps {
  layout: DiagramLayout | null;
  error: string | null;
  selection: Selection | null;
  /** Every selected node (the primary selection included). */
  selectedNodeIds: readonly string[];
  isolated: boolean;
  review: ReviewContext | null;
  focusedPin: FocusedPin | null;
  query: string;
  flash?: SearchFlash | null;
  onFlashEnd?: (token: number) => void;
  onSelect: (selection: Selection | null) => void;
  onToggleNode: (selection: Selection) => void;
  onIsolate: (nodeIds: string[]) => void;
  onShowAll: () => void;
  onEnterHierarchy: (instancePath: string) => void;
  onFocusNode: (nodeId: string) => void;
  onFit: () => void;
}

export function DiagramCanvas({
  layout,
  error,
  selection,
  selectedNodeIds,
  isolated,
  review,
  focusedPin,
  query,
  flash,
  onFlashEnd,
  onSelect,
  onToggleNode,
  onIsolate,
  onShowAll,
  onEnterHierarchy,
  onFocusNode,
  onFit,
}: DiagramCanvasProps) {
  const onSelectNet = useCallback(
    (netId: string) => onSelect({ kind: 'net', id: netId }),
    [onSelect]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = (event: React.MouseEvent | MouseEvent, items: ContextMenuItem[]) => {
    event.preventDefault();
    const box = containerRef.current?.getBoundingClientRect();
    setMenu({ x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0), items });
  };
  const showAllItem: ContextMenuItem = {
    label: 'Show All',
    disabled: !isolated,
    onSelect: onShowAll,
  };

  const { hover, onHoverPin } = usePinHover(layout);

  const selectedIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  const nodes = useMemo(() => {
    const highlighted =
      selection?.kind === 'net' && layout
        ? highlightedPinsByNode(selection.id, layout.edges, layout.nodes)
        : undefined;
    const searching = query.trim() !== '';
    return (layout?.nodes ?? []).map((node) => {
      const dimmed =
        searching &&
        (node.type === 'instance'
          ? !matchesQuery(node.data.instance, query)
          : !boundaryMatchesQuery(node.data.pin, query));
      return {
        ...node,
        selected: selectedIds.has(node.id),
        data: {
          ...node.data,
          dimmed,
          ...(review && { review: nodeReview(review.findings, node.id, review.graph) }),
          ...(focusedPin?.nodeId === node.id &&
            selection?.kind !== 'net' &&
            selection?.id === node.id && { focusedPin: focusedPin.pin }),
          ...(highlighted?.has(node.id) && { highlightedPins: highlighted.get(node.id) }),
          onSelectNet,
          onHoverPin,
          ...(flash?.id === node.id && { flashToken: flash.token, onFlashEnd }),
        },
      };
    });
  }, [
    layout,
    query,
    flash,
    onFlashEnd,
    selection,
    selectedIds,
    review,
    focusedPin,
    onSelectNet,
    onHoverPin,
  ]);

  const edges = useMemo(
    () =>
      (layout?.edges ?? []).map((edge) => ({
        ...edge,
        selected: selection?.kind === 'net' && selection.id === edge.data.netId,
      })),
    [layout, selection]
  );

  // React Flow stays mounted on error: unmounting resets its store to the
  // default viewport, losing the user's zoom and pan.
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      data-review={review !== null}
      onDoubleClick={(event) => {
        if (event.target instanceof Element && isPaneDoubleClick(event.target)) {
          onFit();
        }
      }}
    >
      {error && (
        <p role="alert" className="absolute inset-x-0 top-0 z-10 p-4">
          Layout failed: {error}
        </p>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        selectionKeyCode={null}
        minZoom={0.05}
        zoomOnDoubleClick={false}
        onNodeClick={(event, node) => {
          const next = nodeSelection(node.id);
          if (event.metaKey || event.ctrlKey) {
            onToggleNode(next);
          } else {
            onSelect(next);
          }
        }}
        onNodeContextMenu={(event, node) => {
          const ids = selectedIds.has(node.id) ? [...selectedNodeIds] : [node.id];
          if (!selectedIds.has(node.id)) {
            onSelect(nodeSelection(node.id));
          }
          openMenu(event, [
            {
              label: ids.length > 1 ? `Isolate ${ids.length} Selected` : 'Isolate Selection',
              onSelect: () => onIsolate(ids),
            },
            showAllItem,
          ]);
        }}
        onPaneContextMenu={(event) => openMenu(event, [showAllItem])}
        onMoveStart={closeMenu}
        onPaneClick={() => {
          closeMenu();
          onSelect(null);
        }}
        onNodeDoubleClick={(_event, node) => {
          if (
            node.type === 'instance' &&
            (node.data as InstanceNodeData).instance.kind === 'hier'
          ) {
            onEnterHierarchy(node.id);
          } else {
            onFocusNode(node.id);
          }
        }}
        onEdgeClick={(_event, edge) => onSelect({ kind: 'net', id: edge.data?.netId })}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} />
        <DiagramLegend
          edges={layout?.edges ?? []}
          nodes={layout?.nodes ?? []}
          review={review !== null}
        />
        {review && (
          <Panel position="top-right" className="sd-review-banner" aria-label="Unconnected pins">
            {levelReviewSummary(review.findings, review.graph, review.levelPath)}
          </Panel>
        )}
      </ReactFlow>
      {hover && <PinHoverCard hover={hover} />}
      {menu && (
        <DiagramContextMenu
          x={menu.x}
          y={menu.y}
          canvasWidth={containerRef.current?.clientWidth ?? 0}
          canvasHeight={containerRef.current?.clientHeight ?? 0}
          items={menu.items}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
