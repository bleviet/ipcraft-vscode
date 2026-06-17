import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import Outline, { type OutlineHandle } from './components/OutlinePanel';
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
import { useLayoutToggle } from './hooks/useLayoutToggle';
import { insertElement, deleteElement } from './algorithms/MutationService';
import { recomputeRegisterLayout } from './algorithms/LayoutEngine';
import type { LayoutMemoryMap, LayoutRegister } from './algorithms/LayoutEngine';
import { YamlService } from './services/YamlService';
import { YamlPathResolver } from './services/YamlPathResolver';
import { serializeValue } from '../domain/serialize';

/** Effective register width (bits) of a block-like object. */
function blockRegWidth(block: Record<string, unknown> | undefined): number {
  const raw = block?.defaultRegWidth ?? block?.default_reg_width;
  return typeof raw === 'number' && raw > 0 ? raw : 32;
}
import '@vscode/codicons/dist/codicon.css';
import './index.css';

/**
 * Main application component
 */
const App = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const sidebarResizingRef = useRef(false);
  const registerLayout = useLayoutToggle();
  const blockLayout = useLayoutToggle();
  const memoryMapLayout = useLayoutToggle();
  const arrayLayout = useLayoutToggle();

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
    // Expose for testing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (window as any).__RENDER__ = (text: string) => {
      updateFromYaml(text);
    };
    vscode?.postMessage({ type: 'ready' });
  }, [updateFromYaml]);

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

  const handleRegisterAction = (
    blockIndex: number,
    regIndex: number,
    action: 'insertBefore' | 'insertAfter' | 'delete'
  ) => {
    const rootObj = YamlService.safeParse(rawTextRef.current);
    if (!rootObj) {
      return;
    }
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const mapObj =
      selectionRootPath.length > 0
        ? (YamlPathResolver.getAtPath(root, selectionRootPath) as LayoutMemoryMap)
        : (root as LayoutMemoryMap);

    let result;
    if (action === 'delete') {
      result = deleteElement(mapObj, 'register', regIndex, { blockIndex });
    } else {
      result = insertElement(
        mapObj,
        'register',
        action === 'insertBefore' ? 'before' : 'after',
        regIndex,
        { blockIndex }
      );
    }

    if (result.errors.length === 0) {
      // Write only the affected block's registers array so the rest of the
      // document keeps its formatting and comments.
      const blocks = (result.memoryMap.addressBlocks ??
        result.memoryMap.address_blocks ??
        []) as Record<string, unknown>[];
      const block = blocks[blockIndex];
      if (!block) {
        return;
      }
      const width = blockRegWidth(block);
      const regs = (Array.isArray(block.registers) ? block.registers : []) as Record<
        string,
        unknown
      >[];
      const sanitizedRegs = regs.map((r) => serializeValue(r, width) as Record<string, unknown>);
      const newText = YamlService.applyPathEdits(rawTextRef.current, [
        {
          path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'],
          value: sanitizedRegs,
        },
      ]);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
      }
    }
  };

  // Wraps handleUpdate for array-level structure changes (insert/delete/
  // reorder from BlockEditor or MemoryMapEditor). The structural edit, the
  // layout repack and schema sanitization are applied in a single pass
  // producing exactly one document update: sending two updates back-to-back
  // can corrupt the file when the second edit races the first one in the
  // extension host.
  const handleUpdateWithRepack = useCallback(
    (path: (string | number)[], value: unknown) => {
      const isBlocksWrite = path[0] === 'addressBlocks' && path.length === 1;
      const isRegistersWrite = path[0] === 'registers' && path.length === 1;
      const isNestedRegistersWrite =
        path.length === 3 &&
        path[0] === 'registers' &&
        typeof path[1] === 'number' &&
        path[2] === 'registers';

      if (!isRegistersWrite && !isNestedRegistersWrite && !isBlocksWrite) {
        handleUpdate(path, value);
        return;
      }

      const selection = selectionRef.current;
      if (!selection) {
        return;
      }
      const rootObj = YamlService.safeParse(rawTextRef.current);
      if (!rootObj) {
        return;
      }
      const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
      const fullPath = [...selectionRootPath, ...selection.path, ...path];

      let sanitizedValue: unknown;
      if (isRegistersWrite || isNestedRegistersWrite) {
        // Find the container whose registers are being edited.
        // For block registers, it's the block itself. For nested registers, it's the array register.
        const containerPath = isNestedRegistersWrite
          ? [...selectionRootPath, ...selection.path, path[0], path[1]]
          : [...selectionRootPath, ...selection.path];

        const container = YamlPathResolver.getAtPath(root, containerPath) as
          | Record<string, unknown>
          | undefined;

        const width = blockRegWidth(container);
        const laidOut = recomputeRegisterLayout((value ?? []) as LayoutRegister[], width);
        sanitizedValue = laidOut.map(
          (r) => serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
        );
      } else {
        // Block-level writes carry base addresses already computed by the
        // insertion service; just sanitize to schema keys.
        sanitizedValue = ((value ?? []) as Record<string, unknown>[]).map(
          (b) => serializeValue(b) as Record<string, unknown>
        );
      }

      const newText = YamlService.applyPathEdits(rawTextRef.current, [
        { path: fullPath, value: sanitizedValue },
      ]);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
      }
    },
    [handleUpdate, selectionRef, rawTextRef, updateRawText, sendUpdate]
  );

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
        style={{ width: sidebarWidth }}
      >
        <Outline
          ref={outlineRef}
          memoryMap={memoryMap}
          selectedId={selectedId}
          onSelect={handleSelect}
          onRename={handleOutlineRename}
          onRegisterAction={handleRegisterAction}
        />
        <div
          className="sidebar-resize-handle"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.preventDefault();
            sidebarResizingRef.current = true;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!sidebarResizingRef.current) {
              return;
            }
            setSidebarWidth(Math.min(600, Math.max(180, e.clientX)));
          }}
          onPointerUp={() => {
            sidebarResizingRef.current = false;
          }}
        />
      </aside>
      <section className="flex-1 overflow-hidden min-w-0">
        <DetailsPanel
          ref={detailsRef}
          selectedType={selectedType}
          selectedObject={selectedObject}
          selectionMeta={selectionMeta}
          onUpdate={handleUpdateWithRepack}
          onNavigateToRegister={navigateToRegister}
          onNavigateToBlock={navigateToBlock}
          registerLayout={registerLayout.layout}
          toggleRegisterLayout={registerLayout.toggle}
          blockLayout={blockLayout.layout}
          toggleBlockLayout={blockLayout.toggle}
          memoryMapLayout={memoryMapLayout.layout}
          toggleMemoryMapLayout={memoryMapLayout.toggle}
          arrayLayout={arrayLayout.layout}
          toggleArrayLayout={arrayLayout.toggle}
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
