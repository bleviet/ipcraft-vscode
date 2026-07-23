import React from 'react';
import { EditorPanel } from './layout/EditorPanel';
import { LibraryPalette } from './canvas/LibraryPalette';
import { IpCoreToolbar, type IpCoreToolbarProps } from './IpCoreToolbar';
import { vscode } from '../../vscode';
import type { ValidationError } from '../hooks/useIpCoreState';

interface IpCoreShellProps {
  fileName: string;
  vlnv?: { vendor?: string; library?: string; name?: string } | null;
  toolbarProps: IpCoreToolbarProps;
  isPreview: boolean;
  duplicatePrefixes: string[];
  parseError: string | null;
  hasIpCore: boolean;
  busLibrary?: Record<string, unknown>;
  editorPanelProps: Omit<React.ComponentProps<typeof EditorPanel>, 'ipCore'> & {
    ipCore: React.ComponentProps<typeof EditorPanel>['ipCore'];
  };
  rightPanel: React.ReactNode;
  validationErrors: ValidationError[];
  toast: string | null;
}

/**
 * The IP Core editor's top-level chrome: header (file name/VLNV/toolbar),
 * preview and duplicate-prefix banners, the three-column main content area
 * (library palette / editor panel / right panel slot), the validation-errors
 * panel, and the toast notification. Extracted from IpCoreApp (issue #129)
 * so the app component composes controllers and renders this shell instead
 * of owning the full render tree itself.
 */
export const IpCoreShell: React.FC<IpCoreShellProps> = ({
  fileName,
  vlnv,
  toolbarProps,
  isPreview,
  duplicatePrefixes,
  parseError,
  hasIpCore,
  busLibrary,
  editorPanelProps,
  rightPanel,
  validationErrors,
  toast,
}) => {
  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: 'var(--vscode-editor-background)',
        color: 'var(--vscode-editor-foreground)',
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2"
        style={{
          borderBottom: '1px solid var(--vscode-panel-border)',
          background: 'var(--vscode-sideBar-background)',
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold">{fileName || 'IP Core Editor'}</h1>
            {vlnv && (
              <span className="text-xs" style={{ opacity: 0.7 }}>
                {vlnv.vendor} / {vlnv.library} / {vlnv.name}
              </span>
            )}
          </div>
          <IpCoreToolbar {...toolbarProps} />
        </div>
      </div>

      {/* Preview banner */}
      {isPreview && (
        <div
          className="flex items-center gap-2 px-4"
          style={{
            minHeight: '28px',
            background: 'var(--vscode-inputValidation-infoBackground)',
            borderBottom: '1px solid var(--vscode-inputValidation-infoBorder)',
            color: 'var(--vscode-foreground)',
            fontSize: '12px',
          }}
        >
          <span className="codicon codicon-eye" style={{ flexShrink: 0 }} />
          <span style={{ opacity: 0.85 }}>
            Preview — edits are in-memory and not saved to source
          </span>
          <button
            type="button"
            className="canvas-view-toggle"
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => vscode?.postMessage({ type: 'saveAsIpYml' })}
            title="Write parsed result to .ip.yml and open in the full editor"
          >
            <span className="codicon codicon-save" />
            <span>Save as .ip.yml</span>
          </button>
        </div>
      )}

      {/* Duplicate physicalPrefix warning banner */}
      {duplicatePrefixes.length > 0 && (
        <div
          className="flex items-start gap-2 px-4 py-2"
          role="alert"
          style={{
            background: 'var(--vscode-inputValidation-warningBackground)',
            borderBottom: '1px solid var(--vscode-inputValidation-warningBorder)',
            color:
              'var(--vscode-inputValidation-warningForeground, var(--vscode-editor-foreground))',
            fontSize: '12px',
          }}
        >
          <span className="codicon codicon-warning" style={{ flexShrink: 0, marginTop: '1px' }} />
          <span>
            <strong>Duplicate physicalPrefix detected:</strong>{' '}
            {duplicatePrefixes.map((p) => `"${p}"`).join(', ')} — multiple bus interfaces share this
            prefix, which will produce conflicting port names in generated HDL. Click an affected
            interface to correct its prefix.
          </span>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {parseError ? (
          <div className="flex-1 flex items-center justify-center">
            <div
              className="px-4 py-3 rounded max-w-2xl"
              style={{
                background: 'var(--vscode-inputValidation-errorBackground)',
                border: '1px solid var(--vscode-inputValidation-errorBorder)',
                color: 'var(--vscode-errorForeground)',
              }}
            >
              <p className="font-semibold mb-2">Parse Error</p>
              <p className="text-sm">{parseError}</p>
            </div>
          </div>
        ) : !hasIpCore ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p style={{ color: 'var(--vscode-descriptionForeground)' }}>No IP core loaded</p>
              <p
                className="text-xs mt-2"
                style={{
                  color: 'var(--vscode-descriptionForeground)',
                  opacity: 0.6,
                }}
              >
                Waiting for data from extension...
              </p>
            </div>
          </div>
        ) : (
          <>
            <LibraryPalette busLibrary={busLibrary} />
            <EditorPanel {...editorPanelProps} />
            {rightPanel}
          </>
        )}
      </div>

      {/* Validation errors panel */}
      {validationErrors.length > 0 && (
        <div
          className="p-2"
          style={{
            borderTop: '1px solid var(--vscode-panel-border)',
            background: 'var(--vscode-inputValidation-warningBackground)',
          }}
        >
          <p className="text-sm font-semibold mb-1">Reference Validation Errors:</p>
          <ul className="text-xs list-disc list-inside">
            {validationErrors.map((error, idx) => (
              <li key={idx}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: '24px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'var(--vscode-inputValidation-warningBackground)',
            border: '1px solid var(--vscode-inputValidation-warningBorder)',
            color: 'var(--vscode-foreground)',
            padding: '8px 14px',
            borderRadius: '6px',
            fontSize: '12px',
            maxWidth: '480px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span className="codicon codicon-warning" style={{ flexShrink: 0 }} />
          {toast}
        </div>
      )}
    </div>
  );
};
