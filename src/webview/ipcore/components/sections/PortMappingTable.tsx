import React from 'react';
import { InlineEditField } from './InlineEditField';

interface BusPort {
  name: string;
  width?: number;
  direction?: string;
  presence?: string;
}

interface BusInterface {
  name: string;
  type: string;
  mode: string;
  physicalPrefix?: string;
  portWidthOverrides?: Record<string, number>;
  portNameOverrides?: Record<string, string>;
}

interface PortMappingTableProps {
  index: number;
  bus: BusInterface;
  ports: BusPort[];
  busLibrary?: Record<string, { ports?: BusPort[] }>;
  isSelected: boolean;
  selectedPortIndex: number;
  selectedColumn: 'name' | 'width';
  editingPortName: { busIndex: number; portName: string } | null;
  draftPortName: string;
  editingPortWidth: { busIndex: number; portName: string } | null;
  draftPortWidth: string;
  containerRef: React.RefObject<HTMLDivElement>;
  setSelectedIndex: (index: number) => void;
  setSelectedPortIndex: (index: number) => void;
  setDraftPortName: (value: string) => void;
  setDraftPortWidth: (value: string) => void;
  getPortSuffix: (bus: BusInterface, portName: string) => string;
  startEditPortName: (busIndex: number, portName: string, currentSuffix: string) => void;
  savePortName: (busIndex: number, portName: string) => void;
  cancelEditPortName: () => void;
  startEditPortWidth: (busIndex: number, portName: string, currentWidth: number) => void;
  savePortWidth: (busIndex: number, portName: string, defaultWidth: number) => void;
  cancelEditPortWidth: () => void;
}

const TEXT_STYLES = {
  label: { opacity: 0.6 },
  value: { fontFamily: 'var(--vscode-editor-font-family, monospace)' },
  muted: { opacity: 0.7 },
};

export const PortMappingTable: React.FC<PortMappingTableProps> = ({
  index,
  bus,
  ports,
  busLibrary,
  isSelected,
  selectedPortIndex,
  selectedColumn,
  editingPortName,
  draftPortName,
  editingPortWidth,
  draftPortWidth,
  containerRef,
  setSelectedIndex,
  setSelectedPortIndex,
  setDraftPortName,
  setDraftPortWidth,
  getPortSuffix,
  startEditPortName,
  savePortName,
  cancelEditPortName,
  startEditPortWidth,
  savePortWidth,
  cancelEditPortWidth,
}) => {
  if (ports.length === 0) {
    return (
      <div
        className="px-4 py-4 text-sm"
        style={{
          ...TEXT_STYLES.muted,
          borderTop: '1px solid var(--vscode-panel-border)',
        }}
      >
        {busLibrary ? 'No ports defined for this interface type.' : 'Bus library not loaded.'}
      </div>
    );
  }

  return (
    <table className="w-full text-sm" style={{ borderTop: '1px solid var(--vscode-panel-border)' }}>
      <thead>
        <tr style={{ background: 'var(--vscode-editor-background)' }}>
          <th className="px-4 py-2 text-left font-medium" style={TEXT_STYLES.label}>
            Logical Name
          </th>
          <th className="px-4 py-2 text-left font-medium" style={TEXT_STYLES.label}>
            Physical Name
          </th>
          <th className="px-4 py-2 text-left font-medium" style={TEXT_STYLES.label}>
            Width
          </th>
          <th className="px-4 py-2 text-left font-medium" style={TEXT_STYLES.label}>
            Dir
          </th>
          <th className="px-4 py-2 text-left font-medium" style={TEXT_STYLES.label}>
            Presence
          </th>
        </tr>
      </thead>
      <tbody>
        {ports.map((port, pIdx) => {
          const portSuffix = getPortSuffix(bus, port.name);
          const isEditingThisPortName =
            editingPortName?.busIndex === index && editingPortName?.portName === port.name;
          const isEditingThisPortWidth =
            editingPortWidth?.busIndex === index && editingPortWidth?.portName === port.name;
          const hasNameOverride = bus.portNameOverrides?.[port.name];
          const hasWidthOverride = bus.portWidthOverrides?.[port.name];
          const isSelectedRow = isSelected && selectedPortIndex === pIdx;
          const defaultWidth =
            busLibrary?.[bus.type]?.ports?.find((p) => p.name === port.name)?.width ?? 1;

          return (
            <tr
              key={pIdx}
              data-port-index={pIdx}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedIndex(index);
                setSelectedPortIndex(pIdx);
                containerRef.current?.focus();
              }}
              style={{
                borderTop: '1px solid var(--vscode-panel-border)',
                background: isSelectedRow
                  ? 'var(--vscode-list-activeSelectionBackground)'
                  : pIdx % 2 === 0
                    ? 'transparent'
                    : 'var(--vscode-editor-background)',
              }}
            >
              <td className="px-4 py-1.5" style={TEXT_STYLES.value}>
                {port.name}
              </td>
              <td
                className="px-4 py-1.5"
                style={{
                  outline:
                    isSelectedRow && selectedColumn === 'name' && !isEditingThisPortName
                      ? '1px solid var(--vscode-focusBorder)'
                      : undefined,
                  outlineOffset: '-1px',
                }}
              >
                {isEditingThisPortName ? (
                  <InlineEditField
                    value={draftPortName}
                    onChange={setDraftPortName}
                    onSave={() => savePortName(index, port.name)}
                    onCancel={cancelEditPortName}
                    width="80px"
                    inputStyle={TEXT_STYLES.value}
                    leadingContent={
                      <span
                        style={{
                          ...TEXT_STYLES.value,
                          ...TEXT_STYLES.muted,
                        }}
                      >
                        {bus.physicalPrefix ?? ''}
                      </span>
                    }
                  />
                ) : (
                  <span
                    onClick={() => startEditPortName(index, port.name, portSuffix)}
                    className="cursor-pointer"
                    title="Click to edit suffix (or press e)"
                  >
                    <span style={TEXT_STYLES.muted}>{bus.physicalPrefix ?? ''}</span>
                    <span
                      style={{
                        ...TEXT_STYLES.value,
                        color: hasNameOverride ? 'var(--vscode-textLink-foreground)' : undefined,
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                      }}
                    >
                      {portSuffix}
                    </span>
                  </span>
                )}
              </td>
              <td
                className="px-4 py-1.5"
                style={{
                  outline:
                    isSelectedRow && selectedColumn === 'width' && !isEditingThisPortWidth
                      ? '1px solid var(--vscode-focusBorder)'
                      : undefined,
                  outlineOffset: '-1px',
                }}
              >
                {isEditingThisPortWidth ? (
                  <InlineEditField
                    type="number"
                    value={draftPortWidth}
                    onChange={setDraftPortWidth}
                    onSave={() => savePortWidth(index, port.name, defaultWidth)}
                    onCancel={cancelEditPortWidth}
                    width="60px"
                    inputStyle={TEXT_STYLES.value}
                  />
                ) : (
                  <span
                    onClick={() => startEditPortWidth(index, port.name, port.width ?? 1)}
                    className="cursor-pointer"
                    style={{
                      color: hasWidthOverride ? 'var(--vscode-textLink-foreground)' : undefined,
                      textDecoration: 'underline',
                      textDecorationStyle: 'dotted',
                    }}
                    title="Click to edit width (or press e)"
                  >
                    {port.width ?? 1}
                  </span>
                )}
              </td>
              <td className="px-4 py-1.5">
                <span
                  style={{
                    color:
                      port.direction === 'in'
                        ? 'var(--vscode-charts-green)'
                        : port.direction === 'out'
                          ? 'var(--vscode-charts-blue)'
                          : undefined,
                  }}
                >
                  {port.direction ?? '—'}
                </span>
              </td>
              <td className="px-4 py-1.5" style={TEXT_STYLES.muted}>
                {port.presence}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
