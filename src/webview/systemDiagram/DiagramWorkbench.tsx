import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import { WorkbenchLayout } from './WorkbenchLayout';

interface DiagramWorkbenchProps {
  graph: SystemGraph;
  revealSource: (line: number) => void;
}

export function DiagramWorkbench({ graph, revealSource }: DiagramWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <WorkbenchLayout graph={graph} revealSource={revealSource} />
    </ReactFlowProvider>
  );
}
