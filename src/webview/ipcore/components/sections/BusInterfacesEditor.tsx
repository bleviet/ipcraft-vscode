import React, { useEffect, useRef } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { useBusInterfaceEditing } from '../../hooks/useBusInterfaceEditing';
import { BusInterfaceCard } from './BusInterfaceCard';

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
  associatedClock?: string;
  associatedReset?: string;
  memoryMapRef?: string;
  useOptionalPorts?: string[];
  portWidthOverrides?: Record<string, number>;
  portNameOverrides?: Record<string, string>;
  array?: {
    count: number;
    indexStart?: number;
    namingPattern?: string;
    physicalPrefixPattern?: string;
  };
}

interface Clock {
  name: string;
  physicalPort?: string;
  frequency?: string;
  direction?: string;
}

interface Reset {
  name: string;
  physicalPort?: string;
  polarity?: string;
  direction?: string;
}

interface BusInterfacesEditorProps {
  busInterfaces: unknown[];
  busLibrary?: unknown;
  clocks?: unknown[];
  resets?: unknown[];
  onUpdate: YamlUpdateHandler;
  highlight?: { entityName: string; field: string };
  imports?: { memoryMaps?: unknown[] };
}

const TEXT_STYLES = {
  muted: { opacity: 0.7 },
};

function getEffectivePorts(
  bus: BusInterface,
  busLibrary: Record<string, { ports?: BusPort[] }> | undefined
): BusPort[] {
  if (!busLibrary || !bus.type || !busLibrary[bus.type]) {
    return [];
  }

  const libraryDef = busLibrary[bus.type];
  const libraryPorts = libraryDef.ports ?? [];
  const optionalPorts = bus.useOptionalPorts ?? [];
  const widthOverrides = bus.portWidthOverrides ?? {};

  return libraryPorts
    .filter((port) => {
      if (port.presence === 'required') {
        return true;
      }
      if (port.presence === 'optional' && optionalPorts.includes(port.name)) {
        return true;
      }
      return false;
    })
    .map((port) => ({
      ...port,
      width: widthOverrides[port.name] ?? port.width,
      direction:
        bus.mode === 'slave' && port.direction
          ? port.direction === 'in'
            ? 'out'
            : port.direction === 'out'
              ? 'in'
              : port.direction
          : port.direction,
    }));
}

export const BusInterfacesEditor: React.FC<BusInterfacesEditorProps> = ({
  busInterfaces: rawBusInterfaces,
  busLibrary: rawBusLibrary,
  imports,
  clocks: rawClocks = [],
  resets: rawResets = [],
  onUpdate,
  highlight,
}) => {
  const busInterfaces = rawBusInterfaces as BusInterface[];
  const busLibrary = rawBusLibrary as Record<string, { ports?: BusPort[] }> | undefined;
  const clocks = rawClocks as Clock[];
  const resets = rawResets as Reset[];
  const containerRef = useRef<HTMLDivElement>(null);

  const editing = useBusInterfaceEditing({
    busInterfaces,
    busLibrary,
    onUpdate,
    containerRef,
    getEffectivePorts,
  });

  useEffect(() => {
    if (highlight?.entityName) {
      const index = busInterfaces.findIndex((b) => b.name === highlight.entityName);
      if (index !== -1) {
        editing.setSelectedIndex(index);
        editing.setExpandedIndexes((prev) => new Set(prev).add(index));
      }
    }
  }, [highlight, busInterfaces, editing]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-bus-index="${editing.selectedIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [editing.selectedIndex]);

  useEffect(() => {
    if (!editing.expandedIndexes.has(editing.selectedIndex)) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    requestAnimationFrame(() => {
      const busEl = container.querySelector(`[data-bus-index="${editing.selectedIndex}"]`);
      const portEl = busEl?.querySelector(`[data-port-index="${editing.selectedPortIndex}"]`);
      portEl?.scrollIntoView({ block: 'nearest' });
    });
  }, [editing.expandedIndexes, editing.selectedIndex, editing.selectedPortIndex]);

  return (
    <div ref={containerRef} className="p-6 space-y-4" tabIndex={0} style={{ outline: 'none' }}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">Bus Interfaces</h2>
          <p className="text-sm mt-1" style={TEXT_STYLES.muted}>
            {busInterfaces.length} interface(s) ·{' '}
            <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
              j/k navigate · Space expand · h/l column · e edit · 0 toggle all
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={editing.addBusInterface}
            className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <span className="codicon codicon-add"></span>
            Add Interface
          </button>
          <button
            onClick={editing.toggleExpandAll}
            className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
            style={{
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
            }}
          >
            <span
              className={`codicon codicon-${editing.expandAll ? 'collapse-all' : 'expand-all'}`}
            ></span>
            {editing.expandAll ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>

      {busInterfaces.length === 0 ? (
        <div
          className="p-8 text-center rounded text-sm"
          style={{
            background: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-panel-border)',
            ...TEXT_STYLES.muted,
          }}
        >
          No bus interfaces defined.
        </div>
      ) : (
        <div className="space-y-2">
          {busInterfaces.map((bus, index) => {
            const isSelected = editing.selectedIndex === index;
            const expanded = editing.expandedIndexes.has(index);
            const ports = getEffectivePorts(bus, busLibrary);

            return (
              <BusInterfaceCard
                key={index}
                index={index}
                bus={bus}
                isSelected={isSelected}
                expanded={expanded}
                ports={ports}
                clocks={clocks}
                resets={resets}
                busLibrary={busLibrary}
                imports={imports}
                highlight={highlight}
                selectedPortIndex={editing.selectedPortIndex}
                selectedColumn={editing.selectedColumn}
                editingPrefix={editing.editingPrefix}
                draftPrefix={editing.draftPrefix}
                editingPortName={editing.editingPortName}
                draftPortName={editing.draftPortName}
                editingPortWidth={editing.editingPortWidth}
                draftPortWidth={editing.draftPortWidth}
                editingArrayField={editing.editingArrayField}
                draftArrayValue={editing.draftArrayValue}
                editingBusField={editing.editingBusField}
                draftBusValue={editing.draftBusValue}
                containerRef={containerRef}
                setSelectedIndex={editing.setSelectedIndex}
                setSelectedPortIndex={editing.setSelectedPortIndex}
                setDraftPrefix={editing.setDraftPrefix}
                setDraftPortName={editing.setDraftPortName}
                setDraftPortWidth={editing.setDraftPortWidth}
                setDraftArrayValue={editing.setDraftArrayValue}
                setDraftBusValue={editing.setDraftBusValue}
                toggleExpand={editing.toggleExpand}
                removeBusInterface={editing.removeBusInterface}
                startEditBusField={editing.startEditBusField}
                saveBusField={editing.saveBusField}
                cancelEditBusField={editing.cancelEditBusField}
                startEditPrefix={editing.startEditPrefix}
                savePrefix={editing.savePrefix}
                cancelEditPrefix={editing.cancelEditPrefix}
                updateAssociation={editing.updateAssociation}
                getOptionalPorts={editing.getOptionalPorts}
                toggleOptionalPort={editing.toggleOptionalPort}
                onUpdate={onUpdate}
                toggleArray={editing.toggleArray}
                startEditArrayField={editing.startEditArrayField}
                saveArrayField={editing.saveArrayField}
                cancelEditArrayField={editing.cancelEditArrayField}
                getPortSuffix={editing.getPortSuffix}
                startEditPortName={editing.startEditPortName}
                savePortName={editing.savePortName}
                cancelEditPortName={editing.cancelEditPortName}
                startEditPortWidth={editing.startEditPortWidth}
                savePortWidth={editing.savePortWidth}
                cancelEditPortWidth={editing.cancelEditPortWidth}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
