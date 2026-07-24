import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { BitVector } from '../../../dataInspector/BitVector';
import { createEmptyRecipe, validateRecipeSemantics } from '../../../dataInspector/recipe';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import { TransformCanvas } from '../../../webview/dataInspector/canvas/TransformCanvas';

interface MockFlowNode {
  id: string;
  data: {
    draft?: boolean;
    step?: {
      inputId: string;
      operandId?: string;
    };
  };
}

interface MockReactFlowProps {
  children?: React.ReactNode;
  nodes: MockFlowNode[];
  onConnect: (connection: {
    source: string;
    target: string;
    targetHandle: 'input' | 'operand';
  }) => void;
}

let mockReactFlowProps: MockReactFlowProps | undefined;

jest.mock('@xyflow/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const reactFlowApi = {
    fitView: jest.fn(),
    screenToFlowPosition: (position: { x: number; y: number }) => position,
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
  };

  return {
    applyEdgeChanges: (_changes: unknown, edges: unknown) => edges,
    applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Handle: () => null,
    MarkerType: { ArrowClosed: 'arrowClosed' },
    MiniMap: () => null,
    Position: { Left: 'left', Right: 'right' },
    ReactFlow: (props: MockReactFlowProps) => {
      mockReactFlowProps = props;
      return React.createElement('div', null, props.children);
    },
    ReactFlowProvider: ({ children }: { children: React.ReactNode }) => children,
    useNodesInitialized: () => true,
    useReactFlow: () => reactFlowApi,
  };
});

describe('TransformCanvas draft promotion', () => {
  it('commits a fully wired draft even when its operand widths are invalid', async () => {
    const recipe = createEmptyRecipe('invalid-draft');
    recipe.sources = [
      { id: 'input', name: 'INPUT', width: 16 },
      { id: 'operand', name: 'OPERAND', width: 32 },
    ];
    const samples = new Map([
      ['input', BitVector.fromBigInt(BigInt(0), 16)],
      ['operand', BitVector.fromBigInt(BigInt(0), 32)],
    ]);
    const onRecipeChange = jest.fn<void, [IPCraftDataInspectorRecipe]>();

    render(
      <TransformCanvas
        recipe={recipe}
        samples={samples}
        valueRepresentation="hex"
        onValueRepresentationChange={jest.fn()}
        preserveViewport={false}
        onRecipeChange={onRecipeChange}
        onInspectValue={jest.fn()}
        onDeleteNodes={jest.fn()}
        addCommand={{ id: 1, kind: 'operation', value: 'xor' }}
      />
    );

    await waitFor(() =>
      expect(mockReactFlowProps?.nodes.some((node) => node.data.draft)).toBe(true)
    );
    const draftId = mockReactFlowProps!.nodes.find((node) => node.data.draft)!.id;

    act(() => {
      mockReactFlowProps!.onConnect({
        source: 'input',
        target: draftId,
        targetHandle: 'input',
      });
    });
    await waitFor(() =>
      expect(
        mockReactFlowProps?.nodes.find((node) => node.id === draftId)?.data.step?.inputId
      ).toBe('input')
    );

    act(() => {
      mockReactFlowProps!.onConnect({
        source: 'operand',
        target: draftId,
        targetHandle: 'operand',
      });
    });

    await waitFor(() => expect(onRecipeChange).toHaveBeenCalledTimes(1));
    const committed = onRecipeChange.mock.calls[0][0];
    expect(committed.steps).toEqual([
      expect.objectContaining({
        id: 'step1',
        type: 'xor',
        inputId: 'input',
        operandId: 'operand',
      }),
    ]);
    expect(validateRecipeSemantics(committed)).toContain(
      'Step step1 operands must have equal widths'
    );
    await waitFor(() => {
      expect(mockReactFlowProps?.nodes.some((node) => node.data.draft)).toBe(false);
      expect(mockReactFlowProps?.nodes.some((node) => node.id === 'step1')).toBe(true);
    });
  });
});
