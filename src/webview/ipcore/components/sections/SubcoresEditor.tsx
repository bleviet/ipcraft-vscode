import React, { useEffect } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { vscode } from '../../../vscode';

type SubcoreEntry = string | { vlnv: string; path?: string };

interface SubcoresEditorProps {
  subcores: SubcoreEntry[];
  onUpdate: YamlUpdateHandler;
}

function getVlnv(entry: SubcoreEntry): string {
  return typeof entry === 'string' ? entry : entry.vlnv;
}

function getPath(entry: SubcoreEntry): string | undefined {
  return typeof entry === 'string' ? undefined : entry.path;
}

/**
 * Editor for IP Core subcores (dependency declarations).
 */
export const SubcoresEditor: React.FC<SubcoresEditorProps> = ({ subcores, onUpdate }) => {
  // Listen for subcoreAdded message from the extension host
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const message = event.data as { type?: string; vlnv?: string };
      if (message.type === 'subcoreAdded' && message.vlnv) {
        const newVlnv = message.vlnv;
        const updated = [...(subcores ?? []), newVlnv];
        onUpdate(['subcores'], updated);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [subcores, onUpdate]);

  const handleDelete = (index: number) => {
    const updated = subcores.filter((_, i) => i !== index);
    onUpdate(['subcores'], updated.length > 0 ? updated : undefined);
  };

  const handleOpenFile = (filePath: string) => {
    vscode?.postMessage({ type: 'openFile', path: filePath });
  };

  const handleAddDependency = () => {
    vscode?.postMessage({ type: 'addSubcore' });
  };

  const isEmpty = !subcores || subcores.length === 0;

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">Dependencies</h2>

      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center p-8 rounded gap-4 text-center"
          style={{
            border: '2px dashed var(--vscode-panel-border)',
            color: 'var(--vscode-descriptionForeground)',
          }}
        >
          <span className="codicon codicon-extensions text-2xl opacity-50" />
          <p className="text-sm">No dependencies declared.</p>
          <button
            onClick={handleAddDependency}
            className="px-4 py-2 rounded text-sm flex items-center gap-2"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <span className="codicon codicon-add" />
            Add Dependency
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {subcores.map((entry, index) => {
            const vlnv = getVlnv(entry);
            const filePath = getPath(entry);
            return (
              <div
                key={index}
                className="flex items-start justify-between p-3 rounded"
                style={{
                  background: 'var(--vscode-editor-background)',
                  border: '1px solid var(--vscode-panel-border)',
                }}
              >
                <div className="flex flex-col min-w-0">
                  <span
                    className="text-sm font-mono truncate"
                    style={{ color: 'var(--vscode-editor-foreground)' }}
                  >
                    {vlnv}
                  </span>
                  {filePath && (
                    <span
                      className="text-xs mt-0.5 truncate"
                      style={{ color: 'var(--vscode-descriptionForeground)' }}
                    >
                      {filePath}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {filePath && (
                    <button
                      onClick={() => handleOpenFile(filePath)}
                      className="p-1.5 rounded opacity-70 hover:opacity-100"
                      title="Open file"
                    >
                      <span className="codicon codicon-go-to-file" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(index)}
                    className="p-1.5 rounded opacity-70 hover:opacity-100"
                    title="Remove dependency"
                  >
                    <span className="codicon codicon-close" />
                  </button>
                </div>
              </div>
            );
          })}
          <button
            onClick={handleAddDependency}
            className="mt-4 px-4 py-2 rounded text-sm flex items-center gap-2"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <span className="codicon codicon-add" />
            Add Dependency
          </button>
        </div>
      )}
    </div>
  );
};
