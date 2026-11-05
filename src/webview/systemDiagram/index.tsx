import React from 'react';
import { createRoot } from 'react-dom/client';
import { SystemDiagramApp } from './SystemDiagramApp';
import '@vscode/codicons/dist/codicon.css';
import './systemDiagram.css';
import '@xyflow/react/dist/style.css';

const root = document.getElementById('system-diagram-root');
if (root) {
  createRoot(root).render(<SystemDiagramApp />);
}
