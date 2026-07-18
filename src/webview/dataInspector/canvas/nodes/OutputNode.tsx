import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export interface OutputNodeData extends Record<string, unknown> {
  name: string;
  widthText: string;
  value: string;
  error?: string;
}

export type OutputFlowNode = Node<OutputNodeData, 'output'>;

export function OutputNode({ data, selected }: NodeProps<OutputFlowNode>) {
  return (
    <article
      className={`di-flow-node di-flow-output ${selected ? 'is-selected' : ''} ${data.error ? 'is-error' : ''}`}
    >
      <Handle type="target" position={Position.Left} id="value" aria-label="Output value" />
      <header>
        <span>
          <small>Output</small>
          <strong>{data.name}</strong>
        </span>
        <b>{data.widthText}</b>
      </header>
      <code>{data.error ?? data.value}</code>
    </article>
  );
}
