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
import { DiagramMinimap } from './DiagramMinimap';
import { ElkEdge } from './ElkEdge';
import { FrameNode } from './FrameNode';
import { InstanceNode } from './InstanceNode';
import { hopStepOfKey } from './hopKeys';
import { isPaneDoubleClick } from './canvasTargets';
import { PinHoverCard } from './PinHoverCard';
import { usePinHover } from './hooks/usePinHover';
import type { DiagramLayout } from './hooks/useElkLayout';
import type { ResourceReport } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import type { HighlightColor, HighlightMap } from '../../shared/messages/systemDiagram';
import type { FrameNodeData, InstanceNodeData } from './layout/diagramTypes';
import type { SearchFlash } from './hooks/useSearchStepper';
import type { ChangeContext } from './changeDecor';
import type { ClockContext } from './clockDecor';
import { useCanvasElements } from './hooks/useCanvasElements';
import { HIGHLIGHT_COLORS, hasAnyHighlight, highlightCount } from './highlights';
import { nodeSelection, sameSelection, type Selection } from './model';
import type { TextMatcher } from './searchMatcher';
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
  /** Steps the isolated view's hop radius; set only while one is shown. */
  onHopStep?: (delta: 1 | -1) => void;
  review: ReviewContext | null;
  clocks: ClockContext;
  /** The marks of a comparison; null while Marks is off or without a comparison. */
  changes?: ChangeContext | null;
  /** The report whose usage the block headers show; absent while Resources is off. */
  resources?: ResourceReport | null;
  /** Opens the Changes tab (the legend's removed entry). */
  onOpenChanges?: () => void;
  focusedPin: FocusedPin | null;
  /** The compiled search, or null without one. */
  matcher: TextMatcher | null;
  /** Matches below each hierarchy block (by node id) while a search is on: such a block is not dimmed. */
  searchInside?: ReadonlyMap<string, number> | null;
  /** Auto detail is on: far out, pin text goes and block names grow. Absent, it is off. */
  autoDetail?: boolean;
  /** The minimap is shown. Absent, it is not. */
  minimap?: boolean;
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
  /** Picks the Tcl script of a block design container. Absent, the menu does not offer it. */
  onAssignContainerTcl?: (instancePath: string) => void;
  /** Whether the nodes can be isolated: all of them belong to the level on show. */
  isolatable: (nodeIds: string[]) => boolean;
  /** Whether the boundary port has a wire to trace. */
  traceable?: (portId: string) => boolean;
  /** Goes to the topmost level the wire of a boundary port reaches and selects it there. */
  onTraceSignal?: (portId: string) => void;
  onFocusNode: (nodeId: string) => void;
  onFit: () => void;
}

/**
 * Whether a React Flow node is a hierarchy block that can be entered or expanded, collapsed (an
 * instance) or expanded (a frame). The ghost of a removed hierarchy (see `unionGraph.ts`) cannot:
 * it has no level in the design on show.
 */
function isHierarchy(node: Node): boolean {
  return (
    node.type === 'frame' ||
    (node.type === 'instance' &&
      (node.data as InstanceNodeData).instance.kind === 'hier' &&
      (node.data as InstanceNodeData).change?.status !== 'removed')
  );
}

/** Whether a React Flow node is a block design container, collapsed or expanded. */
function isContainer(node: Node): boolean {
  return (
    (node.type === 'instance' || node.type === 'frame') &&
    (node.data as InstanceNodeData | FrameNodeData).instance.container !== undefined
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
  onHopStep,
  review,
  clocks,
  changes = null,
  resources,
  onOpenChanges,
  focusedPin,
  matcher,
  searchInside,
  autoDetail,
  minimap,
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
  onAssignContainerTcl,
  isolatable,
  traceable,
  onTraceSignal,
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
  const { nodes, edges, decor, changeLegend } = useCanvasElements({
    layout,
    selection,
    selectedIds,
    selectedNetIds,
    highlights,
    review,
    clocks,
    changes,
    resources,
    focusedPin,
    matcher,
    searchInside,
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
      className="sd-canvas relative h-full w-full"
      role="group"
      aria-label="Diagram canvas"
      aria-keyshortcuts={onHopStep ? '+ -' : undefined}
      tabIndex={0}
      data-review={review !== null}
      onKeyDown={(event) => {
        const delta = hopStepOfKey(event.key, event);
        if (delta && onHopStep && !(event.target as Element).closest('[role=menu]')) {
          event.preventDefault();
          onHopStep(delta);
          return;
        }
        // Space expands the selected hierarchy block in place, or collapses its frame, like the
        // header toggle. A focused control (the toggle itself, a menu) keeps its own Space.
        if (
          event.key === ' ' &&
          !(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) &&
          selection?.kind === 'instance' &&
          !(event.target as Element).closest('button, input, textarea, select, [role=menu]')
        ) {
          const node = nodes.find((candidate) => candidate.id === selection.id);
          if (node && isHierarchy(node)) {
            event.preventDefault();
            onToggleExpand(node.id);
          }
        }
      }}
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
            ...(node.type === 'boundary' && onTraceSignal
              ? [
                  {
                    label: 'Trace Signal',
                    disabled: !traceable?.(node.id),
                    onSelect: () => onTraceSignal(node.id),
                  },
                ]
              : []),
            ...(onAssignContainerTcl && isContainer(node)
              ? [{ label: 'Assign Tcl…', onSelect: () => onAssignContainerTcl(node.id) }]
              : []),
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
          changes={changeLegend}
          onOpenChanges={onOpenChanges}
        />
        <AutoDetail target={containerRef} enabled={autoDetail ?? false} marks={changes !== null} />
        {minimap && <DiagramMinimap matcher={matcher} />}
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
