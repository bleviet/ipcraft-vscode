import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  type EdgeTypes,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import { AutoDetail } from './AutoDetail';
import { BoundaryNode } from './BoundaryNode';
import { DiagramContextMenu, type ContextMenuItem } from './DiagramContextMenu';
import { DiagramLegend } from './DiagramLegend';
import { ElkEdge } from './ElkEdge';
import { FrameNode } from './FrameNode';
import { InstanceNode } from './InstanceNode';
import { isPaneDoubleClick } from './canvasTargets';
import { PinHoverCard } from './PinHoverCard';
import { usePinHover } from './hooks/usePinHover';
import type { DiagramLayout } from './hooks/useElkLayout';
import type { SystemGraph } from '../../domain/systemGraph';
import type { HighlightColor, HighlightMap } from '../../shared/messages/systemDiagram';
import type { InstanceNodeData } from './layout/diagramTypes';
import type { SearchFlash } from './hooks/useSearchStepper';
import type { ClockContext } from './clockDecor';
import { useCanvasElements } from './hooks/useCanvasElements';
import { HIGHLIGHT_COLORS, hasAnyHighlight, highlightCount } from './highlights';
import { nodeSelection, sameSelection, type Selection } from './model';
import type { FocusedPin, UnconnectedPin } from './unconnectedPins';

/** Everything the canvas needs to draw the unconnected-pin review; null while the review is off. */
export interface ReviewContext {
  graph: SystemGraph;
  findings: readonly UnconnectedPin[];
}

const NODE_TYPES: NodeTypes = { instance: InstanceNode, boundary: BoundaryNode, frame: FrameNode };
const EDGE_TYPES: EdgeTypes = { elk: ElkEdge };

interface DiagramCanvasProps {
  layout: DiagramLayout | null;
  error: string | null;
  selection: Selection | null;
  /** Every selected node (the primary selection included). */
  selectedNodeIds: readonly string[];
  selectedItems?: readonly Selection[];
  selectedNetIds?: ReadonlySet<string>;
  highlights?: HighlightMap;
  isolated: boolean;
  review: ReviewContext | null;
  clocks: ClockContext;
  focusedPin: FocusedPin | null;
  query: string;
  /** Auto detail is on: far out, pin text goes and block names grow. Absent, it is off. */
  autoDetail?: boolean;
  flash?: SearchFlash | null;
  onFlashEnd?: (token: number) => void;
  onSelect: (selection: Selection | null) => void;
  onToggleNode: (selection: Selection) => void;
  onIsolate: (nodeIds: string[]) => void;
  onShowAll: () => void;
  onHighlight?: (targets: readonly Selection[], color: HighlightColor | null) => void;
  onClearHighlights?: () => void;
  onEnterHierarchy: (instancePath: string) => void;
  /** Expands a hierarchy block in place, or collapses it. */
  onToggleExpand: (instancePath: string) => void;
  /** Whether the nodes can be isolated: all of them belong to the level on show. */
  isolatable: (nodeIds: string[]) => boolean;
  onFocusNode: (nodeId: string) => void;
  onFit: () => void;
}

/** Whether a React Flow node is a hierarchy block, collapsed (an instance) or expanded (a frame). */
function isHierarchy(node: Node): boolean {
  return (
    node.type === 'frame' ||
    (node.type === 'instance' && (node.data as InstanceNodeData).instance.kind === 'hier')
  );
}

export function DiagramCanvas({
  layout,
  error,
  selection,
  selectedNodeIds,
  selectedItems,
  selectedNetIds,
  highlights,
  isolated,
  review,
  clocks,
  focusedPin,
  query,
  autoDetail,
  flash,
  onFlashEnd,
  onSelect,
  onToggleNode,
  onIsolate,
  onShowAll,
  onHighlight,
  onClearHighlights,
  onEnterHierarchy,
  onToggleExpand,
  isolatable,
  onFocusNode,
  onFit,
}: DiagramCanvasProps) {
  // onSelectNet goes into every node's data, so it must not change when the selection
  // handlers do (they change with each selection); it reads the latest ones instead.
  const handlers = useRef({ onSelect, onToggleNode });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onToggleNode };
  });
  const onSelectNet = useCallback((netId: string, additive?: boolean) => {
    const next: Selection = { kind: 'net', id: netId };
    if (additive) {
      handlers.current.onToggleNode(next);
    } else {
      handlers.current.onSelect(next);
    }
  }, []);

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
  const highlightItems = (targets: readonly Selection[]): ContextMenuItem[] =>
    onHighlight
      ? [
          {
            label: 'Highlight',
            swatches: HIGHLIGHT_COLORS.map((swatch) => ({
              label: swatch.label,
              color: swatch.css,
              onSelect: () => onHighlight(targets, swatch.id),
            })),
            onSelect: () => onHighlight(targets, HIGHLIGHT_COLORS[0].id),
          },
          {
            label: 'Clear Highlight',
            disabled: !hasAnyHighlight(highlights ?? {}, targets),
            onSelect: () => onHighlight(targets, null),
          },
          ...(onClearHighlights
            ? [
                {
                  label: 'Clear All Highlights',
                  disabled: highlightCount(highlights ?? {}) === 0,
                  onSelect: onClearHighlights,
                },
              ]
            : []),
        ]
      : [];

  const { hover, onHoverPin } = usePinHover(layout);

  const selectedIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const { nodes, edges, decor } = useCanvasElements({
    layout,
    selection,
    selectedIds,
    selectedNetIds,
    highlights,
    review,
    clocks,
    focusedPin,
    query,
    flash,
    onFlashEnd,
    onSelectNet,
    onHoverPin,
    onToggleExpand,
  });

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
        onlyRenderVisibleElements
        // A selected frame must not rise above the blocks and wires inside it.
        elevateNodesOnSelect={false}
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
          const nodeSel = nodeSelection(node.id);
          const currentItems = selectedItems ?? selectedNodeIds.map(nodeSelection);
          const inSelection =
            selectedIds.has(node.id) || currentItems.some((item) => sameSelection(item, nodeSel));
          const targets = inSelection
            ? currentItems.length > 0
              ? [...currentItems]
              : selectedNodeIds.map(nodeSelection)
            : [nodeSel];
          const isolateIds = targets.filter((item) => item.kind !== 'net').map((item) => item.id);
          if (!inSelection) {
            onSelect(nodeSel);
          }
          openMenu(event, [
            ...(isHierarchy(node)
              ? [
                  {
                    label: node.type === 'frame' ? 'Collapse' : 'Expand In-Place',
                    onSelect: () => onToggleExpand(node.id),
                  },
                  { label: 'Open Subsystem', onSelect: () => onEnterHierarchy(node.id) },
                ]
              : []),
            {
              label:
                isolateIds.length > 1
                  ? `Isolate ${isolateIds.length} Selected`
                  : 'Isolate Selection',
              disabled: isolateIds.length === 0 || !isolatable(isolateIds),
              onSelect: () => onIsolate(isolateIds),
            },
            showAllItem,
            ...highlightItems(targets),
          ]);
        }}
        onEdgeContextMenu={(event, edge) => {
          if (!edge.data?.netId) {
            return;
          }
          const netSel: Selection = { kind: 'net', id: edge.data.netId };
          const currentItems = selectedItems ?? selectedNodeIds.map(nodeSelection);
          const inSelection = currentItems.some((item) => sameSelection(item, netSel));
          const targets = inSelection ? [...currentItems] : [netSel];
          if (!inSelection) {
            onSelect(netSel);
          }
          openMenu(event, [...highlightItems(targets), showAllItem]);
        }}
        onPaneContextMenu={(event) =>
          openMenu(event, [
            showAllItem,
            ...(onClearHighlights
              ? [
                  {
                    label: 'Clear All Highlights',
                    disabled: highlightCount(highlights ?? {}) === 0,
                    onSelect: onClearHighlights,
                  },
                ]
              : []),
          ])
        }
        onMoveStart={closeMenu}
        onPaneClick={() => {
          closeMenu();
          onSelect(null);
        }}
        onNodeDoubleClick={(_event, node) => {
          if (isHierarchy(node)) {
            onEnterHierarchy(node.id);
          } else {
            onFocusNode(node.id);
          }
        }}
        onEdgeClick={(event, edge) => {
          if (!edge.data?.netId) {
            return;
          }
          const next: Selection = { kind: 'net', id: edge.data.netId };
          if (event.metaKey || event.ctrlKey) {
            onToggleNode(next);
          } else {
            onSelect(next);
          }
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} />
        <DiagramLegend
          edges={layout?.edges ?? []}
          nodes={layout?.nodes ?? []}
          review={review !== null}
          domains={decor.legend}
        />
        <AutoDetail target={containerRef} enabled={autoDetail ?? false} />
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
