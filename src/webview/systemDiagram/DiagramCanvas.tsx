import React, { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { BoundaryNode } from './BoundaryNode';
import { ElkEdge } from './ElkEdge';
import { InstanceNode } from './InstanceNode';
import { isPaneDoubleClick } from './canvasTargets';
import { PinHoverCard } from './PinHoverCard';
import { usePinHover } from './hooks/usePinHover';
import type { DiagramLayout } from './hooks/useElkLayout';
import type { InstanceNodeData } from './layout/diagramTypes';
import { boundaryMatchesQuery, matchesQuery, type Selection } from './model';

const NODE_TYPES: NodeTypes = { instance: InstanceNode, boundary: BoundaryNode };
const EDGE_TYPES: EdgeTypes = { elk: ElkEdge };

interface DiagramCanvasProps {
  layout: DiagramLayout | null;
  error: string | null;
  selection: Selection | null;
  query: string;
  onSelect: (selection: Selection | null) => void;
  onEnterHierarchy: (instancePath: string) => void;
  onFocusNode: (nodeId: string) => void;
  onFit: () => void;
}

export function DiagramCanvas({
  layout,
  error,
  selection,
  query,
  onSelect,
  onEnterHierarchy,
  onFocusNode,
  onFit,
}: DiagramCanvasProps) {
  const onSelectNet = useCallback(
    (netId: string) => onSelect({ kind: 'net', id: netId }),
    [onSelect]
  );

  const { hover, onHoverPin } = usePinHover(layout);

  const nodes = useMemo(() => {
    const searching = query.trim() !== '';
    return (layout?.nodes ?? []).map((node) => {
      const dimmed =
        searching &&
        (node.type === 'instance'
          ? !matchesQuery(node.data.instance, query)
          : !boundaryMatchesQuery(node.data.pin, query));
      return {
        ...node,
        selected: selection?.kind !== 'net' && selection?.id === node.id,
        data: { ...node.data, dimmed, onSelectNet, onHoverPin },
      };
    });
  }, [layout, query, selection, onSelectNet, onHoverPin]);

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
      className="relative h-full w-full"
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
        minZoom={0.05}
        zoomOnDoubleClick={false}
        onNodeClick={(_event, node) =>
          onSelect({ kind: node.type === 'boundary' ? 'boundary' : 'instance', id: node.id })
        }
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
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} />
      </ReactFlow>
      {hover && <PinHoverCard hover={hover} />}
    </div>
  );
}
