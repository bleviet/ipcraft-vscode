import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DATA_INSPECTOR_NODE_MIME, DATA_INSPECTOR_OPERATION_MIME } from '../WorkbenchLibrary';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import type { BitVector } from '../../../dataInspector/BitVector';
import { formatValue, type ValueRepresentation } from '../../../dataInspector/formatValue';
import { evaluateRecipe } from '../../../dataInspector/evaluateRecipe';
import {
  applyGraphEdit,
  recipeToGraph,
  wouldCreateCycle,
} from '../../../dataInspector/recipeGraph';
import { validateRecipeSemantics } from '../../../dataInspector/recipe';
import type { IPCraftDataInspectorRecipe, Step } from '../../../domain/dataInspector.types';
import { isBinaryOperation, parameterDefaults, type RecipeStepType } from '../transform/operations';
import { layoutRecipeGraph, resolveCanvasPositions } from './layout';
import { SourceNode, type SourceNodeData } from './nodes/SourceNode';
import { StepNode, type StepNodeData } from './nodes/StepNode';

type CanvasNode = Node<SourceNodeData | StepNodeData>;

interface DraftNode {
  id: string;
  type: RecipeStepType;
  position: { x: number; y: number };
  inputId?: string;
  operandId?: string;
}

interface TransformCanvasProps {
  recipe: IPCraftDataInspectorRecipe;
  samples: ReadonlyMap<string, BitVector>;
  valueRepresentation: ValueRepresentation;
  onValueRepresentationChange: (representation: ValueRepresentation) => void;
  resetToken?: string;
  preserveViewport: boolean;
  onRecipeChange: (recipe: IPCraftDataInspectorRecipe) => void;
  onInspectValue: (nodeId: string, kind: 'source' | 'step') => void;
  onDeleteNodes: (nodeIds: string[]) => string | undefined;
  addCommand?: CanvasAddCommand;
}

export interface CanvasAddCommand {
  id: number;
  kind: 'source' | 'operation';
  value: string;
}

const nodeTypes: NodeTypes = {
  source: SourceNode,
  step: StepNode,
};

function nextStepId(recipe: IPCraftDataInspectorRecipe, extraIds: readonly string[] = []): string {
  const ids = new Set([
    ...recipe.sources.map((source) => source.id),
    ...recipe.steps.map((step) => step.id),
    ...extraIds,
  ]);
  let index = recipe.steps.length + 1;
  while (ids.has(`step${index}`)) {
    index += 1;
  }
  return `step${index}`;
}

function stepErrors(recipe: IPCraftDataInspectorRecipe): Map<string, string> {
  const errors = new Map<string, string>();
  for (const error of validateRecipeSemantics(recipe)) {
    const match = /^Step ([A-Za-z0-9._-]+)/.exec(error);
    if (match && !errors.has(match[1])) {
      errors.set(match[1], error);
    }
  }
  return errors;
}

function valueText(value: BitVector | undefined, representation: ValueRepresentation): string {
  return value ? formatValue(value, representation) : 'No sample';
}

function edgeShowsError(targetHandle: string | null | undefined, error: string | undefined) {
  if (!error) {
    return false;
  }
  if (/operand/i.test(error)) {
    return targetHandle === 'operand';
  }
  return targetHandle === 'input';
}

function TransformCanvasInner({
  recipe,
  samples,
  valueRepresentation,
  onValueRepresentationChange,
  resetToken,
  preserveViewport,
  onRecipeChange,
  onInspectValue,
  onDeleteNodes,
  addCommand,
}: TransformCanvasProps) {
  const { fitView, screenToFlowPosition, zoomIn, zoomOut } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const fittedGraphRef = useRef('');
  const preserveViewportRef = useRef(false);
  const handledCommandRef = useRef(0);
  const [workingRecipe, setWorkingRecipe] = useState(recipe);
  const [drafts, setDrafts] = useState<DraftNode[]>([]);
  const [nodes, setNodes] = useState<CanvasNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [showMap, setShowMap] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setWorkingRecipe(recipe);
    setMessage('');
  }, [recipe]);

  useEffect(() => {
    setDrafts([]);
    setMessage('');
  }, [resetToken]);

  const evaluation = useMemo(
    () => evaluateRecipe(workingRecipe, samples),
    [samples, workingRecipe]
  );
  const errors = useMemo(() => stepErrors(workingRecipe), [workingRecipe]);

  const saveCandidate = useCallback(
    (candidate: IPCraftDataInspectorRecipe) => {
      setWorkingRecipe(candidate);
      const validationErrors = validateRecipeSemantics(candidate);
      if (validationErrors.length > 0) {
        setMessage(validationErrors[0]);
        return false;
      }
      setMessage('');
      onRecipeChange(candidate);
      return true;
    },
    [onRecipeChange]
  );

  useEffect(() => {
    const graph = recipeToGraph(workingRecipe);
    const positions = resolveCanvasPositions(graph, workingRecipe.view.canvas?.nodes);
    const positionById = new Map(positions.map((position) => [position.id, position]));
    const evaluationById = new Map(evaluation.steps.map((step) => [step.id, step]));
    const nextNodes: CanvasNode[] = [
      ...workingRecipe.sources.map((source, index) => ({
        id: source.id,
        type: 'source',
        position: positionById.get(source.id) ?? { x: 0, y: index * 164 },
        deletable: false,
        data: {
          name: source.name,
          badge: String.fromCharCode(65 + (index % 26)),
          width: source.width,
          value: valueText(evaluation.values.get(source.id)?.value, valueRepresentation),
        },
      })),
      ...workingRecipe.steps.map((step) => {
        const result = evaluationById.get(step.id);
        return {
          id: step.id,
          type: 'step',
          position: positionById.get(step.id) ?? { x: 280, y: 0 },
          deletable: false,
          data: {
            step,
            value: valueText(result?.value?.value, valueRepresentation),
            widthText: result?.outputWidth ? `${result.outputWidth}b` : 'unavailable',
            error: errors.get(step.id) ?? result?.error,
          },
        };
      }),
      ...drafts.map((draft) => {
        const inputWidth = draft.inputId
          ? (evaluation.values.get(draft.inputId)?.value.width ?? 1)
          : 1;
        return {
          id: draft.id,
          type: 'step',
          position: draft.position,
          deletable: false,
          data: {
            step: {
              id: draft.id,
              type: draft.type,
              inputId: draft.inputId ?? '',
              operandId: draft.operandId,
              ...parameterDefaults(draft.type, inputWidth),
            },
            value: 'Wire required inputs',
            widthText: 'draft',
            draft: true,
          },
        };
      }),
    ];
    const nextEdges: Edge[] = graph.edges.map((edge) => ({
      ...edge,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      className: edgeShowsError(edge.targetHandle, errors.get(edge.target))
        ? 'is-error'
        : undefined,
    }));
    for (const draft of drafts) {
      if (draft.inputId) {
        nextEdges.push({
          id: `${draft.id}.input`,
          source: draft.inputId,
          target: draft.id,
          targetHandle: 'input',
          type: 'smoothstep',
        });
      }
      if (draft.operandId) {
        nextEdges.push({
          id: `${draft.id}.operand`,
          source: draft.operandId,
          target: draft.id,
          targetHandle: 'operand',
          type: 'smoothstep',
        });
      }
    }
    setNodes((current) => {
      const measuredById = new Map(current.map((node) => [node.id, node.measured]));
      return nextNodes.map((node) => {
        const measured = measuredById.get(node.id);
        return measured ? { ...node, measured } : node;
      });
    });
    setEdges(nextEdges);
  }, [drafts, errors, evaluation, valueRepresentation, workingRecipe]);

  const graphSignature = useMemo(
    () =>
      nodes
        .map((node) => node.id)
        .sort()
        .join('|'),
    [nodes]
  );

  useEffect(() => {
    if (!nodesInitialized || !graphSignature || fittedGraphRef.current === graphSignature) {
      return;
    }
    fittedGraphRef.current = graphSignature;
    if (preserveViewportRef.current) {
      preserveViewportRef.current = false;
      return;
    }
    window.requestAnimationFrame(() => void fitView({ padding: 0.16, duration: 0 }));
  }, [fitView, graphSignature, nodesInitialized]);

  const connectDraft = useCallback(
    (connection: Connection, draft: DraftNode) => {
      if (!connection.source || !connection.targetHandle) {
        return;
      }
      const nextDraft = {
        ...draft,
        ...(connection.targetHandle === 'operand'
          ? { operandId: connection.source }
          : { inputId: connection.source }),
      };
      const ready =
        nextDraft.inputId !== undefined &&
        (!isBinaryOperation(nextDraft.type) || nextDraft.operandId !== undefined);
      if (!ready) {
        setDrafts((current) =>
          current.map((candidate) => (candidate.id === draft.id ? nextDraft : candidate))
        );
        return;
      }

      const inputWidth = evaluation.values.get(nextDraft.inputId!)?.value.width ?? 1;
      const id = nextStepId(workingRecipe);
      const step: Step = {
        id,
        type: nextDraft.type,
        inputId: nextDraft.inputId!,
        ...(nextDraft.operandId ? { operandId: nextDraft.operandId } : {}),
        ...parameterDefaults(nextDraft.type, inputWidth),
      };
      let candidate = applyGraphEdit(workingRecipe, { type: 'addSteps', steps: [step] });
      const positions = resolveCanvasPositions(
        recipeToGraph(candidate),
        workingRecipe.view.canvas?.nodes
      ).map((position) => (position.id === id ? { id, ...nextDraft.position } : position));
      candidate = { ...candidate, view: { ...candidate.view, canvas: { nodes: positions } } };
      if (preserveViewport) {
        preserveViewportRef.current = true;
      }
      saveCandidate(candidate);
      setDrafts((current) => current.filter((candidateDraft) => candidateDraft.id !== draft.id));
    },
    [evaluation.values, saveCandidate, workingRecipe]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !connection.targetHandle) {
        return;
      }
      const draft = drafts.find((candidate) => candidate.id === connection.target);
      if (draft) {
        connectDraft(connection, draft);
        return;
      }
      try {
        const candidate = applyGraphEdit(workingRecipe, {
          type: 'connect',
          sourceId: connection.source,
          targetId: connection.target,
          targetHandle: connection.targetHandle as 'input' | 'operand',
        });
        saveCandidate(candidate);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    },
    [connectDraft, drafts, saveCandidate, workingRecipe]
  );

  const isValidConnection = useCallback(
    (connection: Edge | Connection) => {
      if (!connection.source || !connection.target || connection.source === connection.target) {
        return false;
      }
      const targetNode = nodes.find((node) => node.id === connection.target);
      if (targetNode?.type === 'source') {
        return false;
      }
      return !wouldCreateCycle(workingRecipe, connection.source, connection.target);
    },
    [nodes, workingRecipe]
  );

  const savePositions = useCallback(
    (currentNodes: CanvasNode[]) => {
      const validIds = new Set(recipeToGraph(workingRecipe).nodes.map((node) => node.id));
      const positions = currentNodes
        .filter((node) => validIds.has(node.id))
        .map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }));
      saveCandidate({
        ...workingRecipe,
        view: { ...workingRecipe.view, canvas: { nodes: positions } },
      });
    },
    [saveCandidate, workingRecipe]
  );

  const autoLayout = useCallback(() => {
    const positions = layoutRecipeGraph(recipeToGraph(workingRecipe));
    const byId = new Map(positions.map((position) => [position.id, position]));
    const nextNodes = nodes.map((node) => ({
      ...node,
      position: byId.get(node.id) ?? node.position,
    }));
    setNodes(nextNodes);
    savePositions(nextNodes);
    window.setTimeout(() => void fitView({ padding: 0.16, duration: 180 }), 0);
  }, [fitView, nodes, savePositions, workingRecipe]);

  const deleteSelected = useCallback(() => {
    const selectedNodes = nodes.filter((node) => node.selected);
    const nodeIds = selectedNodes
      .filter((node) => !node.id.startsWith('draft-'))
      .map((node) => node.id);
    const draftIds = new Set(
      selectedNodes.filter((node) => node.id.startsWith('draft-')).map((node) => node.id)
    );
    if (draftIds.size > 0) {
      setDrafts((current) => current.filter((draft) => !draftIds.has(draft.id)));
    }
    if (nodeIds.length === 0) {
      setMessage('');
      return;
    }
    setMessage(onDeleteNodes(nodeIds) ?? '');
  }, [nodes, onDeleteNodes]);

  const selectedCount = nodes.filter((node) => node.selected).length;

  const addDraftAt = useCallback(
    (type: RecipeStepType, position: { x: number; y: number }) => {
      if (preserveViewport) {
        preserveViewportRef.current = true;
      }
      setDrafts((current) => [
        ...current,
        { id: `draft-${Date.now()}-${current.length}`, type, position },
      ]);
    },
    [preserveViewport]
  );

  const addSourceAt = useCallback(
    (position: { x: number; y: number }) => {
      let index = workingRecipe.sources.length + 1;
      const ids = new Set([
        ...workingRecipe.sources.map((source) => source.id),
        ...workingRecipe.steps.map((step) => step.id),
      ]);
      while (ids.has(`input${index}`)) {
        index += 1;
      }
      const id = `input${index}`;
      const positions = [
        ...(workingRecipe.view.canvas?.nodes ?? []),
        { id, x: position.x, y: position.y },
      ];
      const candidate = {
        ...workingRecipe,
        sources: [...workingRecipe.sources, { id, name: `INPUT_${index}`, width: 32 }],
        view: { ...workingRecipe.view, canvas: { nodes: positions } },
      };
      if (preserveViewport) {
        preserveViewportRef.current = true;
      }
      if (saveCandidate(candidate)) {
        onInspectValue(id, 'source');
      }
    },
    [onInspectValue, preserveViewport, saveCandidate, workingRecipe]
  );

  useEffect(() => {
    if (!addCommand || handledCommandRef.current === addCommand.id) {
      return;
    }
    handledCommandRef.current = addCommand.id;
    const position = { x: 180, y: 120 + (addCommand.id % 5) * 36 };
    if (addCommand.kind === 'source') {
      addSourceAt(position);
    } else if (addCommand.kind === 'operation') {
      addDraftAt(addCommand.value as RecipeStepType, position);
    }
  }, [addCommand, addDraftAt, addSourceAt]);

  return (
    <div
      className="di-canvas-shell"
      onContextMenu={(event) => event.preventDefault()}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(event) => {
        event.preventDefault();
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const operation = event.dataTransfer.getData(
          DATA_INSPECTOR_OPERATION_MIME
        ) as RecipeStepType;
        const nodeKind = event.dataTransfer.getData(DATA_INSPECTOR_NODE_MIME);
        if (operation) {
          addDraftAt(operation, position);
        } else if (nodeKind === 'source') {
          addSourceAt(position);
        }
      }}
      onKeyDown={(event) => {
        if (
          (event.key === 'Delete' || event.key === 'Backspace') &&
          !(event.target instanceof HTMLInputElement)
        ) {
          event.preventDefault();
          deleteSelected();
        }
      }}
    >
      <div className="di-canvas-toolbar">
        <div className="di-representation-switch" aria-label="Value representation" role="group">
          {(['hex', 'binary', 'decimal'] as const).map((representation) => (
            <button
              aria-pressed={valueRepresentation === representation}
              key={representation}
              onClick={() => onValueRepresentationChange(representation)}
              data-tooltip={`Show values as ${representation}`}
              type="button"
            >
              {representation[0].toUpperCase() + representation.slice(1)}
            </button>
          ))}
        </div>
        <button
          aria-label="Delete selected components"
          className="di-canvas-delete"
          disabled={selectedCount === 0}
          onClick={deleteSelected}
          data-tooltip="Delete selected components (Delete)"
        >
          <span className="codicon codicon-trash" aria-hidden="true" />
        </button>
        <button
          aria-label="Auto-layout"
          data-tooltip="Arrange nodes left to right"
          onClick={autoLayout}
        >
          <span className="codicon codicon-layout" aria-hidden="true" />
        </button>
        <button aria-label="Zoom out" data-tooltip="Zoom out" onClick={() => void zoomOut()}>
          <span className="codicon codicon-zoom-out" aria-hidden="true" />
        </button>
        <button aria-label="Zoom in" data-tooltip="Zoom in" onClick={() => void zoomIn()}>
          <span className="codicon codicon-zoom-in" aria-hidden="true" />
        </button>
        <button
          aria-label="Fit canvas"
          onClick={() => void fitView({ padding: 0.16, duration: 180 })}
          data-tooltip="Fit all components"
        >
          <span className="codicon codicon-screen-normal" aria-hidden="true" />
        </button>
        <button
          aria-label={showMap ? 'Hide minimap' : 'Show minimap'}
          aria-pressed={showMap}
          onClick={() => setShowMap((current) => !current)}
          data-tooltip={showMap ? 'Hide minimap' : 'Show minimap'}
        >
          <span className="codicon codicon-map" aria-hidden="true" />
        </button>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ padding: 0.16 }}
        minZoom={0.25}
        maxZoom={1.8}
        connectionRadius={30}
        multiSelectionKeyCode="Shift"
        selectionOnDrag
        onNodesChange={(changes: NodeChange<CanvasNode>[]) =>
          setNodes((current) => applyNodeChanges(changes, current))
        }
        onEdgesChange={(changes: EdgeChange[]) =>
          setEdges((current) => applyEdgeChanges(changes, current))
        }
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStop={(_, movedNode) => {
          if (movedNode.id.startsWith('draft-')) {
            setDrafts((current) =>
              current.map((draft) =>
                draft.id === movedNode.id ? { ...draft, position: movedNode.position } : draft
              )
            );
            return;
          }
          const currentNodes = nodes.map((node) =>
            node.id === movedNode.id ? { ...node, position: movedNode.position } : node
          );
          setNodes(currentNodes);
          savePositions(currentNodes);
        }}
        onNodeClick={(_, node) => onInspectValue(node.id, node.type as 'source' | 'step')}
        onConnectStart={() => setMessage('')}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
        {showMap && <MiniMap pannable zoomable nodeStrokeWidth={3} />}
      </ReactFlow>
      {message && (
        <div className="di-canvas-message" role="status">
          {message}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {message}
      </span>
    </div>
  );
}

export function TransformCanvas(props: TransformCanvasProps) {
  return (
    <ReactFlowProvider>
      <TransformCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
