import React from 'react';
import { createRoot } from 'react-dom/client';
import { TemplateEditorApp } from './TemplateEditorApp';
import '@vscode/codicons/dist/codicon.css';
import '../index.css';

const rootEl = document.getElementById('template-editor-root');
if (rootEl) {
  createRoot(rootEl).render(<TemplateEditorApp />);
}
