import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { Step } from '../../../../domain/dataInspector.types';
import { isBinaryOperation, transformOperation } from '../../transform/operations';

export interface StepNodeData extends Record<string, unknown> {
  step: Step;
  value: string;
  widthText: string;
  error?: string;
  draft?: boolean;
}

export type StepFlowNode = Node<StepNodeData, 'step'>;

export function StepNode({ data, selected }: NodeProps<StepFlowNode>) {
  const operation = transformOperation(data.step.type);
  const inputLabel =
    data.step.type === 'concat' ? 'hi' : isBinaryOperation(data.step.type) ? 'a' : 'in';
  const operandLabel = data.step.type === 'concat' ? 'lo' : 'b';

  return (
    <article
      className={`di-flow-node di-flow-step ${selected ? 'is-selected' : ''} ${data.error ? 'is-error' : ''} ${data.draft ? 'is-draft' : ''}`}
    >
      <div className="di-flow-port di-flow-port-input" aria-hidden="true">
        {inputLabel}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        aria-label={`${inputLabel} input`}
      />
      {isBinaryOperation(data.step.type) && (
        <>
          <div className="di-flow-port di-flow-port-operand" aria-hidden="true">
            {operandLabel}
          </div>
          <Handle
            className="di-flow-operand-handle"
            type="target"
            position={Position.Left}
            id="operand"
            aria-label={`${operandLabel} input`}
          />
        </>
      )}
      <header>
        <b className="di-flow-symbol">{operation.symbol}</b>
        <span>
          <small>{data.draft ? 'Draft step' : data.step.id}</small>
          <strong>{operation.label}</strong>
        </span>
        <em>{data.widthText}</em>
      </header>
      <code>{data.error ?? data.value}</code>
      <Handle type="source" position={Position.Right} id="value" aria-label="Step value" />
    </article>
  );
}
