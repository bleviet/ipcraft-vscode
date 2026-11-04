import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramProblem } from './messageState';
import { WorkbenchLayout } from './WorkbenchLayout';

interface DiagramWorkbenchProps {
  graph: SystemGraph;
  problem?: DiagramProblem;
  revealSource: (line: number) => void;
}

export function DiagramWorkbench({ graph, problem, revealSource }: DiagramWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <WorkbenchLayout graph={graph} problem={problem} revealSource={revealSource} />
    </ReactFlowProvider>
  );
}
