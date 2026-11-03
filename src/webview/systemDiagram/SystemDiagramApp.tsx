import React from 'react';
import { DiagramWorkbench } from './DiagramWorkbench';
import { useSystemDiagramMessages } from './hooks/useSystemDiagramMessages';

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-6" role="status">
      {message}
    </div>
  );
}

export function SystemDiagramApp() {
  const { state, revealSource } = useSystemDiagramMessages();
  switch (state.status) {
    case 'loading':
      return <EmptyState message="Reading the design..." />;
    case 'notRecognized':
      return <EmptyState message="This Tcl file is not a Vivado block design script." />;
    case 'error':
      return <EmptyState message={`Could not read the design: ${state.message}`} />;
    case 'graph':
      return <DiagramWorkbench graph={state.graph} revealSource={revealSource} />;
  }
}
