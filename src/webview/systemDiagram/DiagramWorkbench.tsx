import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramCompare, HighlightMap } from '../../shared/messages/systemDiagram';
import type { DiagramProblem } from './messageState';
import type { ImageExportChannel } from './hooks/useDiagramExport';
import { WorkbenchLayout } from './WorkbenchLayout';

interface DiagramWorkbenchProps {
  graph: SystemGraph;
  highlights?: HighlightMap;
  problem?: DiagramProblem;
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
  onChangeHighlights?: (highlights: HighlightMap) => void;
  imageExport?: ImageExportChannel;
  compare?: DiagramCompare;
  onStartCompare: () => void;
  onStopCompare: () => void;
  onSwapCompare: () => void;
}

export function DiagramWorkbench({
  graph,
  highlights,
  problem,
  revealSource,
  openDefinition,
  onChangeHighlights,
  imageExport,
  compare,
  onStartCompare,
  onStopCompare,
  onSwapCompare,
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
        imageExport={imageExport}
        compare={compare}
        onStartCompare={onStartCompare}
        onStopCompare={onStopCompare}
        onSwapCompare={onSwapCompare}
      />
    </ReactFlowProvider>
  );
}
