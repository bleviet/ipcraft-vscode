import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { HighlightMap } from '../../shared/messages/systemDiagram';
import type { DiagramProblem } from './messageState';
import { WorkbenchLayout } from './WorkbenchLayout';

interface DiagramWorkbenchProps {
  graph: SystemGraph;
  highlights?: HighlightMap;
  problem?: DiagramProblem;
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
  onChangeHighlights?: (highlights: HighlightMap) => void;
}

export function DiagramWorkbench({
  graph,
  highlights,
  problem,
  revealSource,
  openDefinition,
  onChangeHighlights,
}: DiagramWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <WorkbenchLayout
        graph={graph}
        highlights={highlights}
        problem={problem}
        revealSource={revealSource}
        openDefinition={openDefinition}
        onChangeHighlights={onChangeHighlights}
      />
    </ReactFlowProvider>
  );
}
