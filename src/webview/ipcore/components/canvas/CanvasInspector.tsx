import React from 'react';
import type { IpCore } from '../../../types/ipCore';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { CanvasElement } from '../../hooks/useCanvasSelection';
import { MetadataEditor } from '../sections/MetadataEditor';
import { ClocksTable } from '../sections/ClocksTable';
import { ResetsTable } from '../sections/ResetsTable';
import { PortsTable } from '../sections/PortsTable';
import { BusInterfacesEditor } from '../sections/BusInterfacesEditor';

interface CanvasInspectorProps {
  selected: CanvasElement | null;
  ipCore: IpCore;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
  onClose: () => void;
}

/**
 * Context-aware inspector panel for the canvas view.
 *
 * When a port or bus interface is selected on the canvas, this panel slides in
 * and shows the appropriate editor for that element type. Reuses the existing
 * section editors (ClocksTable, PortsTable, BusInterfacesEditor, etc.).
 */
export const CanvasInspector: React.FC<CanvasInspectorProps> = ({
  selected,
  ipCore,
  imports = {},
  onUpdate,
  onClose,
}) => {
  if (!selected) {
    return null;
  }

  return (
    <div
      className="canvas-inspector"
      style={{
        width: 360,
        minWidth: 300,
        maxWidth: 480,
        borderLeft: '1px solid var(--vscode-panel-border)',
        background: 'var(--vscode-sideBar-background)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Inspector header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--vscode-panel-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--vscode-editorWidget-background)',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--vscode-descriptionForeground)',
              fontWeight: 700,
            }}
          >
            {inspectorTitle(selected)}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--vscode-foreground)',
              marginTop: 2,
            }}
          >
            {inspectorSubtitle(selected, ipCore)}
          </div>
        </div>
        <button
          onClick={onClose}
          title="Close inspector"
          aria-label="Close inspector"
          type="button"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--vscode-descriptionForeground)',
            padding: 4,
          }}
        >
          <span className="codicon codicon-close"></span>
        </button>
      </div>

      {/* Inspector content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {renderInspectorContent(selected, ipCore, imports, onUpdate)}
      </div>
    </div>
  );
};

function inspectorTitle(element: CanvasElement): string {
  switch (element.kind) {
    case 'clock':
      return 'Clock';
    case 'reset':
      return 'Reset';
    case 'port':
      return 'Port';
    case 'busInterface':
      return 'Bus Interface';
    case 'body':
      return 'IP Core';
  }
}

function inspectorSubtitle(element: CanvasElement, ipCore: IpCore): string {
  switch (element.kind) {
    case 'clock': {
      const clk = ipCore.clocks?.[element.index];
      return clk?.name ?? '';
    }
    case 'reset': {
      const rst = ipCore.resets?.[element.index];
      return rst?.name ?? '';
    }
    case 'port': {
      const p = ipCore.ports?.[element.index];
      return p?.name ?? '';
    }
    case 'busInterface': {
      const bus = ipCore.busInterfaces?.[element.index];
      return bus?.name ?? '';
    }
    case 'body':
      return ipCore.vlnv.name;
  }
}

function renderInspectorContent(
  element: CanvasElement,
  ipCore: IpCore,
  imports: { busLibrary?: unknown; memoryMaps?: unknown[] },
  onUpdate: YamlUpdateHandler
): React.ReactNode {
  switch (element.kind) {
    case 'body':
      return <MetadataEditor ipCore={ipCore} onUpdate={onUpdate} />;

    case 'clock':
      return (
        <ClocksTable
          clocks={ipCore.clocks ?? []}
          busInterfaces={ipCore.busInterfaces ?? []}
          onUpdate={onUpdate}
        />
      );

    case 'reset':
      return (
        <ResetsTable
          resets={ipCore.resets ?? []}
          busInterfaces={ipCore.busInterfaces ?? []}
          onUpdate={onUpdate}
        />
      );

    case 'port':
      return (
        <PortsTable
          ports={ipCore.ports ?? []}
          onUpdate={onUpdate}
          parameters={(ipCore.parameters ?? []) as Array<{ name: string; dataType?: string }>}
        />
      );

    case 'busInterface':
      return (
        <BusInterfacesEditor
          busInterfaces={ipCore.busInterfaces ?? []}
          busLibrary={imports.busLibrary}
          imports={imports}
          clocks={ipCore.clocks ?? []}
          resets={ipCore.resets ?? []}
          parameters={ipCore.parameters ?? []}
          onUpdate={onUpdate}
        />
      );

    default:
      return <div style={{ padding: 16 }}>No inspector available</div>;
  }
}
