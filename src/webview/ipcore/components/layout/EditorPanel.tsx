import React, { RefObject, useEffect, useRef } from 'react';
import { vscode } from '../../../vscode';
import { MetadataEditor } from '../sections/MetadataEditor';
import { ClocksTable } from '../sections/ClocksTable';
import { ResetsTable } from '../sections/ResetsTable';
import { PortsTable } from '../sections/PortsTable';
import { ParametersTable } from '../sections/ParametersTable';
import { FileSetsEditor } from '../sections/FileSetsEditor';
import { BusInterfacesEditor } from '../sections/BusInterfacesEditor';
import { MemoryMapsEditor } from '../sections/MemoryMapsEditor';
import { GeneratorPanel } from '../sections/GeneratorPanel';
import { Section } from '../../hooks/useNavigation';

interface EditorPanelProps {
  selectedSection: Section;
  ipCore: any;
  imports?: { busLibrary?: any; memoryMaps?: any[] };
  onUpdate: (path: Array<string | number>, value: any) => void;
  isFocused?: boolean;
  onFocus?: () => void;
  panelRef?: RefObject<HTMLDivElement>;
  highlight?: { entityName: string; field: string };
}

/**
 * Main editor panel that displays the selected section
 */
export const EditorPanel: React.FC<EditorPanelProps> = ({
  selectedSection,
  ipCore,
  imports = {},
  onUpdate,
  isFocused = false,
  onFocus,
  panelRef,
  highlight,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-focus the inner table container when panel receives focus
  useEffect(() => {
    if (isFocused && contentRef.current) {
      // Find and focus the first focusable element with tabIndex (table container)
      const focusableElement = contentRef.current.querySelector('[tabindex="0"]') as HTMLElement;
      if (focusableElement) {
        focusableElement.focus();
      }
    }
  }, [isFocused]);

  if (!ipCore) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No IP core loaded</p>
      </div>
    );
  }

  const renderSection = () => {
    switch (selectedSection) {
      case 'metadata':
        return <MetadataEditor ipCore={ipCore} onUpdate={onUpdate} />;
      case 'clocks':
        return (
          <ClocksTable
            clocks={ipCore.clocks || []}
            busInterfaces={ipCore.busInterfaces || []}
            onUpdate={onUpdate}
          />
        );
      case 'resets':
        return (
          <ResetsTable
            resets={ipCore.resets || []}
            busInterfaces={ipCore.busInterfaces || []}
            onUpdate={onUpdate}
          />
        );
      case 'ports':
        return <PortsTable ports={ipCore.ports || []} onUpdate={onUpdate} />;
      case 'busInterfaces':
        return (
          <BusInterfacesEditor
            busInterfaces={ipCore.busInterfaces || []}
            busLibrary={imports.busLibrary}
            imports={imports}
            clocks={ipCore.clocks || []}
            resets={ipCore.resets || []}
            onUpdate={onUpdate}
            highlight={highlight}
          />
        );
      case 'memoryMaps':
        return (
          <MemoryMapsEditor memoryMaps={ipCore.memoryMaps} imports={imports} onUpdate={onUpdate} />
        );
      case 'parameters':
        return <ParametersTable parameters={ipCore.parameters || []} onUpdate={onUpdate} />;
      case 'fileSets':
        return <FileSetsEditor fileSets={ipCore.fileSets || []} onUpdate={onUpdate} />;
      case 'generate':
        return <GeneratorPanel ipCore={ipCore} />;
      default:
        return <div>Unknown section</div>;
    }
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onClick={onFocus}
      className="flex-1 overflow-y-auto min-w-0 outline-none"
      style={{
        outline: isFocused ? '1px solid var(--vscode-focusBorder)' : 'none',
        outlineOffset: '-1px',
        opacity: isFocused ? 1 : 0.7,
        transition: 'opacity 0.2s',
      }}
    >
      <div ref={contentRef}>{renderSection()}</div>
    </div>
  );
};

// Placeholder section components (will be replaced as we build editors in Phase 2)
const ClocksSection: React.FC<any> = ({ clocks }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-2xl font-semibold">Clocks</h2>
    <p className="text-sm" style={{ opacity: 0.7 }}>
      Found {clocks.length} clock(s)
    </p>
    {clocks.map((clock: any, idx: number) => (
      <div
        key={idx}
        className="p-4 rounded shadow"
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <p className="font-semibold">{clock.name}</p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          Physical Port: {clock.physicalPort}
        </p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          Frequency: {clock.frequency || 'N/A'}
        </p>
      </div>
    ))}
  </div>
);

const ResetsSection: React.FC<any> = ({ resets }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-2xl font-semibold">Resets</h2>
    <p className="text-sm" style={{ opacity: 0.7 }}>
      Found {resets.length} reset(s)
    </p>
    {resets.map((reset: any, idx: number) => (
      <div
        key={idx}
        className="p-4 rounded shadow"
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <p className="font-semibold">{reset.name}</p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          Physical Port: {reset.physicalPort}
        </p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          Polarity: {reset.polarity}
        </p>
      </div>
    ))}
  </div>
);

const PortsSection: React.FC<any> = ({ ports }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-2xl font-semibold">Ports</h2>
    <p className="text-sm" style={{ opacity: 0.7 }}>
      Found {ports.length} port(s)
    </p>
  </div>
);

const BusInterfacesSection: React.FC<any> = ({ busInterfaces }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-2xl font-semibold">Bus Interfaces</h2>
    <p className="text-sm" style={{ opacity: 0.7 }}>
      Found {busInterfaces.length} bus interface(s)
    </p>
    {busInterfaces.map((bus: any, idx: number) => (
      <div
        key={idx}
        className="p-4 rounded shadow"
        style={{
          background: 'var(--vscode-editor-background)',
          border: '1px solid var(--vscode-panel-border)',
        }}
      >
        <p className="font-semibold">{bus.name}</p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          Type: {bus.type}
        </p>
        <p className="text-sm" style={{ opacity: 0.7 }}>
          Mode: {bus.mode}
        </p>
      </div>
    ))}
  </div>
);

const ParametersSection: React.FC<any> = ({ parameters }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-2xl font-semibold">Parameters</h2>
    <p className="text-sm" style={{ opacity: 0.7 }}>
      Found {parameters.length} parameter(s)
    </p>
  </div>
);

const FileSetsSection: React.FC<any> = ({ fileSets }) => (
  <div className="p-6 space-y-4">
    <h2 className="text-2xl font-semibold">File Sets</h2>
    <p className="text-sm" style={{ opacity: 0.7 }}>
      Found {fileSets.length} file set(s)
    </p>
  </div>
);
