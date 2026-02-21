import React, { useEffect, useRef, useState } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import Outline, { type OutlineHandle } from './components/Outline';
import DetailsPanel, { type DetailsPanelHandle } from './components/DetailsPanel';
import { vscode } from './vscode';
import { useMemoryMapState } from './hooks/useMemoryMapState';
import { useSelection } from './hooks/useSelection';
import { useYamlSync } from './hooks/useYamlSync';
import { useSelectionResolver } from './hooks/useSelectionResolver';
import { useSelectionLifecycle } from './hooks/useSelectionLifecycle';
import { useOutlineRename } from './hooks/useOutlineRename';
import { useDetailsNavigation } from './hooks/useDetailsNavigation';
import { useYamlUpdateHandler } from './hooks/useYamlUpdateHandler';
import './index.css';

/**
 * Main application component
 */
const App = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { memoryMap, rawTextRef, parseError, fileName, updateFromYaml, updateRawText } =
    useMemoryMapState();
  const {
    selectedId,
    selectedType,
    selectedObject,
    breadcrumbs,
    selectionMeta,
    selectionRef,
    handleSelect,
    goBack,
  } = useSelection();
  const { sendUpdate, sendCommand } = useYamlSync(vscode, updateFromYaml);

  useEffect(() => {
    vscode?.postMessage({ type: 'ready' });
  }, []);

  const outlineRef = useRef<OutlineHandle | null>(null);
  const detailsRef = useRef<DetailsPanelHandle | null>(null);

  const resolveFromSelection = useSelectionResolver(memoryMap);
  const handleOutlineRename = useOutlineRename({ rawTextRef, updateRawText, sendUpdate });
  const handleUpdate = useYamlUpdateHandler({
    selectionRef,
    rawTextRef,
    updateRawText,
    sendUpdate,
  });
  const { navigateToRegister, navigateToBlock } = useDetailsNavigation({
    memoryMap,
    selectedObject,
    selectionRef,
    handleSelect,
  });

  useSelectionLifecycle({
    memoryMap,
    selectionRef,
    handleSelect,
    resolveFromSelection,
  });

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [goBack]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const keyLower = (e.key || '').toLowerCase();
      if (!e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (keyLower !== 'h' && keyLower !== 'l') {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (keyLower === 'h') {
        outlineRef.current?.focus();
        return;
      }
      if (keyLower === 'l') {
        detailsRef.current?.focus();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  /**
   * Render error state
   */
  if (parseError) {
    return (
      <div className="flex items-center justify-center h-screen vscode-surface">
        <div className="text-center p-8">
          <span className="codicon codicon-error text-6xl mb-4 block opacity-50"></span>
          <h2 className="text-xl font-semibold mb-2">Parse Error</h2>
          <p className="text-sm opacity-75">{parseError}</p>
        </div>
      </div>
    );
  }

  /**
   * Render loading state
   */
  if (!memoryMap) {
    return (
      <div className="flex items-center justify-center h-screen vscode-surface">
        <div className="text-center">
          <span className="codicon codicon-loading codicon-modifier-spin text-4xl opacity-50"></span>
          <p className="mt-4 text-sm opacity-75">Loading memory map...</p>
        </div>
      </div>
    );
  }

  /**
   * Main UI
   */
  return (
    <>
      <header
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: '1px solid var(--vscode-panel-border)' }}
      >
        <div className="flex items-center gap-4 flex-1 overflow-hidden">
          {/* Mobile sidebar toggle */}
          <button
            className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle sidebar"
            aria-label="Toggle sidebar"
          >
            <span className="codicon codicon-menu"></span>
          </button>
          <h1 className="text-lg font-semibold shrink-0">FPGA Memory Map Editor</h1>
          <div className="flex items-center gap-1 text-sm opacity-75 overflow-hidden">
            <span className="codicon codicon-file text-[16px]"></span>
            <span className="truncate">{fileName || 'Untitled'}</span>
            {breadcrumbs.length > 1 && (
              <>
                <span className="codicon codicon-chevron-right text-[16px]"></span>
                <span
                  className="font-medium px-2 py-0.5 rounded vscode-surface-alt"
                  style={{ border: '1px solid var(--vscode-panel-border)' }}
                >
                  {breadcrumbs[breadcrumbs.length - 1]}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            onClick={() => sendCommand('save')}
            title="Save"
            aria-label="Save"
          >
            <span className="codicon codicon-save"></span>
          </button>
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            onClick={() => sendCommand('validate')}
            title="Validate"
            aria-label="Validate"
          >
            <span className="codicon codicon-check"></span>
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar backdrop for mobile */}
        {sidebarOpen && (
          <div className="sidebar-backdrop active" onClick={() => setSidebarOpen(false)} />
        )}
        <aside
          className={`sidebar flex flex-col shrink-0 overflow-y-auto ${sidebarOpen ? 'sidebar-open' : ''}`}
        >
          <Outline
            ref={outlineRef}
            memoryMap={memoryMap}
            selectedId={selectedId}
            onSelect={handleSelect}
            onRename={handleOutlineRename}
          />
        </aside>
        <section className="flex-1 overflow-hidden min-w-0">
          <DetailsPanel
            ref={detailsRef}
            selectedType={selectedType}
            selectedObject={selectedObject}
            selectionMeta={selectionMeta}
            onUpdate={handleUpdate}
            onNavigateToRegister={navigateToRegister}
            onNavigateToBlock={navigateToBlock}
          />
        </section>
      </main>
    </>
  );
};

/**
 * Error boundary for catching React errors
 */
class ErrorBoundary extends React.Component<
  { children: ReactNode },
  { error: unknown; info: unknown }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error, info: null };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ error, info });
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: 'var(--vscode-inputValidation-errorBackground, #fff0f0)',
            color: 'var(--vscode-errorForeground, #b91c1c)',
            padding: 32,
            fontFamily: 'var(--vscode-editor-font-family, monospace)',
          }}
        >
          <h2 style={{ fontWeight: 'bold' }}>UI Error</h2>
          <div>{(this.state.error as Error)?.message || String(this.state.error)}</div>
          {!!this.state.info && (
            <pre style={{ marginTop: 16, fontSize: 12 }}>
              {(this.state.info as { componentStack?: string })?.componentStack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Application bootstrap
 */
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
