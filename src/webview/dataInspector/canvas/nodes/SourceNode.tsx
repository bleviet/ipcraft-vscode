import React from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

export interface SourceNodeData extends Record<string, unknown> {
  name: string;
  badge: string;
  width: number;
  value: string;
}

export type SourceFlowNode = Node<SourceNodeData, 'source'>;

export function SourceNode({ data, selected }: NodeProps<SourceFlowNode>) {
  return (
    <article className={`di-flow-node di-flow-source ${selected ? 'is-selected' : ''}`}>
      <header>
        <span className="di-flow-source-badge">{data.badge}</span>
        <span>
          <small>Source</small>
          <strong>{data.name}</strong>
        </span>
        <b>{data.width}b</b>
      </header>
      <code>{data.value}</code>
      <Handle type="source" position={Position.Right} id="value" aria-label="Source value" />
    </article>
  );
}
