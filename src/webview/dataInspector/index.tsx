import React from 'react';
import { createRoot } from 'react-dom/client';
import { DataInspectorApp } from './DataInspectorApp';
import '@vscode/codicons/dist/codicon.css';
import './dataInspector.css';
import '@xyflow/react/dist/style.css';

const root = document.getElementById('data-inspector-root');
if (root) {
  createRoot(root).render(<DataInspectorApp />);
}
