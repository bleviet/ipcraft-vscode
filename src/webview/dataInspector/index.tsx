import React from 'react';
import { createRoot } from 'react-dom/client';
import { DataInspectorApp } from './DataInspectorApp';
import './dataInspector.css';

const root = document.getElementById('data-inspector-root');
if (root) {
  createRoot(root).render(<DataInspectorApp />);
}
