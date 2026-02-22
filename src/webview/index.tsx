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
  type RegisterLayout = 'stacked' | 'side-by-side';
  const [registerLayout, setRegisterLayout] = useState<RegisterLayout>('side-by-side');
  const [blockLayout, setBlockLayout] = useState<RegisterLayout>('side-by-side');
  const [memoryMapLayout, setMemoryMapLayout] = useState<RegisterLayout>('side-by-side');
  const [arrayLayout, setArrayLayout] = useState<RegisterLayout>('side-by-side');

  const { memoryMap, rawTextRef, parseError, updateFromYaml, updateRawText } = useMemoryMapState();
  const {
    selectedId,
    selectedType,
    selectedObject,
    selectionMeta,
    selectionRef,
    handleSelect,
    goBack,
  } = useSelection();
  const { sendUpdate } = useYamlSync(vscode, updateFromYaml);

  useEffect(() => {
    vscode?.postMessage({ type: 'ready' });
  }, []);

  const toggleRegisterLayout = () => {
    const nextLayout: RegisterLayout = registerLayout === 'stacked' ? 'side-by-side' : 'stacked';
    setRegisterLayout(nextLayout);
  };

  const toggleBlockLayout = () => {
    const nextLayout: RegisterLayout = blockLayout === 'stacked' ? 'side-by-side' : 'stacked';
    setBlockLayout(nextLayout);
  };

  const toggleMemoryMapLayout = () => {
    const nextLayout: RegisterLayout = memoryMapLayout === 'stacked' ? 'side-by-side' : 'stacked';
    setMemoryMapLayout(nextLayout);
  };

  const toggleArrayLayout = () => {
    const nextLayout: RegisterLayout = arrayLayout === 'stacked' ? 'side-by-side' : 'stacked';
    setArrayLayout(nextLayout);
  };

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
    <main className="flex-1 flex overflow-hidden relative">
      <button
        className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button absolute top-2 left-2 z-[110]"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
      >
        <span className="codicon codicon-menu"></span>
      </button>

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
          registerLayout={registerLayout}
          toggleRegisterLayout={toggleRegisterLayout}
          blockLayout={blockLayout}
          toggleBlockLayout={toggleBlockLayout}
          memoryMapLayout={memoryMapLayout}
          toggleMemoryMapLayout={toggleMemoryMapLayout}
          arrayLayout={arrayLayout}
          toggleArrayLayout={toggleArrayLayout}
        />
      </section>
    </main>
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
