import React from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramCompare, HighlightMap } from '../../shared/messages/systemDiagram';
import type { DiagramProblem } from './messageState';
import type { ImageExportChannel } from './hooks/useDiagramExport';
import type { ResourceChannel } from './resources/useResourceChannel';
import { WorkbenchLayout } from './WorkbenchLayout';

interface DiagramWorkbenchProps {
  graph: SystemGraph;
  highlights?: HighlightMap;
  problem?: DiagramProblem;
  busy?: string;
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
  assignContainerTcl: (instance: string) => void;
  onChangeHighlights?: (highlights: HighlightMap) => void;
  imageExport?: ImageExportChannel;
  resourceChannel?: ResourceChannel;
  compare?: DiagramCompare;
  onStartCompare: () => void;
  onStopCompare: () => void;
  onSwapCompare: () => void;
}

export function DiagramWorkbench({
  graph,
  highlights,
  problem,
  busy,
  revealSource,
  openDefinition,
  assignContainerTcl,
  onChangeHighlights,
  imageExport,
  resourceChannel,
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
        busy={busy}
        revealSource={revealSource}
        openDefinition={openDefinition}
        assignContainerTcl={assignContainerTcl}
        onChangeHighlights={onChangeHighlights}
        imageExport={imageExport}
        resourceChannel={resourceChannel}
        compare={compare}
        onStartCompare={onStartCompare}
        onStopCompare={onStopCompare}
        onSwapCompare={onSwapCompare}
      />
    </ReactFlowProvider>
  );
}
