import React, { RefObject, useEffect, useRef } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { IpCore } from '../../../types/ipCore';
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
  ipCore: IpCore | null;
  imports?: { busLibrary?: unknown; memoryMaps?: unknown[] };
  onUpdate: YamlUpdateHandler;
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
  const ip = ipCore as IpCore;

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

  if (!ip) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-500">
        <p>No IP core loaded</p>
      </div>
    );
  }

  const renderSection = () => {
    switch (selectedSection) {
      case 'metadata':
        return <MetadataEditor ipCore={ip} onUpdate={onUpdate} />;
      case 'clocks':
        return (
          <ClocksTable
            clocks={ip.clocks ?? []}
            busInterfaces={ip.busInterfaces ?? []}
            onUpdate={onUpdate}
          />
        );
      case 'resets':
        return (
          <ResetsTable
            resets={ip.resets ?? []}
            busInterfaces={ip.busInterfaces ?? []}
            onUpdate={onUpdate}
          />
        );
      case 'ports':
        return <PortsTable ports={ip.ports ?? []} onUpdate={onUpdate} />;
      case 'busInterfaces':
        return (
          <BusInterfacesEditor
            busInterfaces={ip.busInterfaces ?? []}
            busLibrary={imports.busLibrary}
            imports={imports}
            clocks={ip.clocks ?? []}
            resets={ip.resets ?? []}
            onUpdate={onUpdate}
            highlight={highlight}
          />
        );
      case 'memoryMaps':
        return (
          <MemoryMapsEditor memoryMaps={ip.memoryMaps} imports={imports} onUpdate={onUpdate} />
        );
      case 'parameters':
        return <ParametersTable parameters={ip.parameters ?? []} onUpdate={onUpdate} />;
      case 'fileSets':
        return <FileSetsEditor fileSets={ip.fileSets ?? []} onUpdate={onUpdate} />;
      case 'generate':
        return <GeneratorPanel ipCore={ip} />;
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
