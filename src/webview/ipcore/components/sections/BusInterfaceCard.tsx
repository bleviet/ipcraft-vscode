import React from 'react';
import { InlineEditField } from './InlineEditField';
import { PortMappingTable } from './PortMappingTable';

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
}

interface Reset {
  name: string;
  physicalPort?: string;
  polarity?: string;
}

type ArrayField = 'count' | 'indexStart' | 'namingPattern' | 'physicalPrefixPattern';
type BusField = 'name' | 'type' | 'mode';

interface BusInterfaceCardProps {
  index: number;
  bus: BusInterface;
  isSelected: boolean;
  expanded: boolean;
  ports: BusPort[];
  clocks: Clock[];
  resets: Reset[];
  busLibrary?: Record<string, { ports?: BusPort[] }>;
  imports?: { memoryMaps?: unknown[] };
  highlight?: { entityName: string; field: string };
  selectedPortIndex: number;
  selectedColumn: 'name' | 'width';
  editingPrefix: number | null;
  draftPrefix: string;
  editingPortName: { busIndex: number; portName: string } | null;
  draftPortName: string;
  editingPortWidth: { busIndex: number; portName: string } | null;
  draftPortWidth: string;
  editingArrayField: { busIndex: number; field: ArrayField } | null;
  draftArrayValue: string;
  editingBusField: { busIndex: number; field: BusField } | null;
  draftBusValue: string;
  containerRef: React.RefObject<HTMLDivElement>;
  setSelectedIndex: (index: number) => void;
  setSelectedPortIndex: (index: number) => void;
  setDraftPrefix: (value: string) => void;
  setDraftPortName: (value: string) => void;
  setDraftPortWidth: (value: string) => void;
  setDraftArrayValue: (value: string) => void;
  setDraftBusValue: (value: string) => void;
  toggleExpand: (index: number) => void;
  removeBusInterface: (index: number) => void;
  startEditBusField: (busIndex: number, field: BusField, currentValue: string) => void;
  saveBusField: (busIndex: number, overrideValue?: string) => void;
  cancelEditBusField: () => void;
  startEditPrefix: (index: number, currentPrefix: string) => void;
  savePrefix: (index: number) => void;
  cancelEditPrefix: () => void;
  updateAssociation: (
    busIndex: number,
    field: 'associatedClock' | 'associatedReset',
    value: string
  ) => void;
  getOptionalPorts: (bus: BusInterface) => BusPort[];
  toggleOptionalPort: (busIndex: number, portName: string, currentlyEnabled: boolean) => void;
  onUpdate: (path: (string | number)[], value: unknown) => void;
  toggleArray: (busIndex: number, hasArray: boolean) => void;
  startEditArrayField: (busIndex: number, field: ArrayField, currentValue: string | number) => void;
  saveArrayField: (busIndex: number) => void;
  cancelEditArrayField: () => void;
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

export const BusInterfaceCard: React.FC<BusInterfaceCardProps> = ({
  index,
  bus,
  isSelected,
  expanded,
  ports,
  clocks,
  resets,
  busLibrary,
  imports,
  highlight,
  selectedPortIndex,
  selectedColumn,
  editingPrefix,
  draftPrefix,
  editingPortName,
  draftPortName,
  editingPortWidth,
  draftPortWidth,
  editingArrayField,
  draftArrayValue,
  editingBusField,
  draftBusValue,
  containerRef,
  setSelectedIndex,
  setSelectedPortIndex,
  setDraftPrefix,
  setDraftPortName,
  setDraftPortWidth,
  setDraftArrayValue,
  setDraftBusValue,
  toggleExpand,
  removeBusInterface,
  startEditBusField,
  saveBusField,
  cancelEditBusField,
  startEditPrefix,
  savePrefix,
  cancelEditPrefix,
  updateAssociation,
  getOptionalPorts,
  toggleOptionalPort,
  onUpdate,
  toggleArray,
  startEditArrayField,
  saveArrayField,
  cancelEditArrayField,
  getPortSuffix,
  startEditPortName,
  savePortName,
  cancelEditPortName,
  startEditPortWidth,
  savePortWidth,
  cancelEditPortWidth,
}) => {
  const getClockInfo = (clockName: string) => clocks.find((c) => c.name === clockName);
  const getResetInfo = (resetName: string) => resets.find((r) => r.name === resetName);
  const clockInfo = bus.associatedClock ? getClockInfo(bus.associatedClock) : null;
  const resetInfo = bus.associatedReset ? getResetInfo(bus.associatedReset) : null;

  return (
    <div
      data-bus-index={index}
      className="rounded overflow-hidden"
      style={{ border: '1px solid var(--vscode-panel-border)' }}
    >
      <div
        onClick={() => {
          setSelectedIndex(index);
          containerRef.current?.focus();
        }}
        onDoubleClick={() => toggleExpand(index)}
        className="flex items-center gap-3 px-4 py-3 cursor-pointer group"
        style={{
          background: isSelected
            ? 'var(--vscode-list-activeSelectionBackground)'
            : 'var(--vscode-editor-background)',
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleExpand(index);
          }}
          className="p-0.5"
        >
          <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`}></span>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {editingBusField?.busIndex === index && editingBusField?.field === 'name' ? (
              <InlineEditField
                value={draftBusValue}
                onChange={setDraftBusValue}
                onSave={() => saveBusField(index)}
                onCancel={cancelEditBusField}
                width="200px"
                inputClassName="px-1 py-0.5 rounded text-sm font-semibold"
              />
            ) : (
              <span
                className="text-sm font-semibold cursor-pointer hover:underline decoration-dotted"
                style={TEXT_STYLES.value}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditBusField(index, 'name', bus.name);
                }}
                title="Click to edit name"
              >
                {bus.name}
              </span>
            )}

            {editingBusField?.busIndex === index && editingBusField?.field === 'type' ? (
              <select
                value={draftBusValue}
                onChange={(e) => saveBusField(index, e.target.value)}
                className="px-1 py-0.5 rounded text-xs"
                style={{
                  background: 'var(--vscode-input-background)',
                  border: '1px solid var(--vscode-input-border)',
                  color: 'var(--vscode-input-foreground)',
                  outline: 'none',
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    cancelEditBusField();
                  }
                }}
                onBlur={() => cancelEditBusField()}
                autoFocus
              >
                {busLibrary &&
                  Object.keys(busLibrary).map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
              </select>
            ) : (
              <span
                className="px-1.5 py-0.5 rounded text-xs cursor-pointer hover:opacity-80"
                style={{
                  background: 'var(--vscode-badge-background)',
                  color: 'var(--vscode-badge-foreground)',
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditBusField(index, 'type', bus.type);
                }}
                title="Click to change type"
              >
                {bus.type}
              </span>
            )}

            {editingBusField?.busIndex === index && editingBusField?.field === 'mode' ? (
              <select
                value={draftBusValue}
                onChange={(e) => saveBusField(index, e.target.value)}
                className="px-1 py-0.5 rounded text-xs"
                style={{
                  background: 'var(--vscode-input-background)',
                  border: '1px solid var(--vscode-input-border)',
                  color: 'var(--vscode-input-foreground)',
                  outline: 'none',
                }}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Escape') {
                    cancelEditBusField();
                  }
                }}
                onBlur={() => cancelEditBusField()}
                autoFocus
              >
                <option value="master">master</option>
                <option value="slave">slave</option>
                <option value="monitor">monitor</option>
              </select>
            ) : (
              <span
                className="text-sm cursor-pointer hover:underline decoration-dotted"
                style={TEXT_STYLES.muted}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditBusField(index, 'mode', bus.mode);
                }}
                title="Click to change mode"
              >
                {bus.mode}
              </span>
            )}

            {bus.array && (
              <span
                className="text-xs px-1 rounded"
                style={{
                  background: 'var(--vscode-badge-background)',
                  color: 'var(--vscode-badge-foreground)',
                }}
              >
                [{bus.array.count}]
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 mt-1 text-sm" style={TEXT_STYLES.muted}>
            {bus.associatedClock && (
              <span
                title={`Port: ${clockInfo?.physicalPort ?? 'N/A'}\nFrequency: ${clockInfo?.frequency ?? 'N/A'}`}
                style={{ cursor: 'help' }}
              >
                <span style={TEXT_STYLES.label}>Clock:</span>{' '}
                <span style={TEXT_STYLES.value}>{bus.associatedClock}</span>
                {clockInfo?.frequency && (
                  <span style={TEXT_STYLES.muted}> ({clockInfo.frequency})</span>
                )}
              </span>
            )}
            {bus.associatedReset && (
              <span
                title={`Port: ${resetInfo?.physicalPort ?? 'N/A'}\nPolarity: ${resetInfo?.polarity ?? 'N/A'}`}
                style={{ cursor: 'help' }}
              >
                <span style={TEXT_STYLES.label}>Reset:</span>{' '}
                <span style={TEXT_STYLES.value}>{bus.associatedReset}</span>
                {resetInfo?.polarity && (
                  <span style={TEXT_STYLES.muted}> ({resetInfo.polarity})</span>
                )}
              </span>
            )}
            <span>{ports.length} ports</span>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            removeBusInterface(index);
          }}
          className="p-1 rounded opacity-60 hover:opacity-100 hover:bg-vscode-toolbar-hoverBackground transition-opacity"
          title="Delete Bus Interface"
          style={{ color: 'var(--vscode-list-errorForeground)' }}
        >
          <span className="codicon codicon-trash"></span>
        </button>
      </div>

      {expanded && (
        <div
          style={{
            borderTop: '1px solid var(--vscode-panel-border)',
          }}
        >
          <div
            className="px-4 py-2 flex items-center gap-3 text-sm"
            style={{ background: 'var(--vscode-editor-background)' }}
          >
            <span style={{ ...TEXT_STYLES.label, minWidth: '50px' }}>Prefix:</span>
            {editingPrefix === index ? (
              <InlineEditField
                value={draftPrefix}
                onChange={setDraftPrefix}
                onSave={() => savePrefix(index)}
                onCancel={cancelEditPrefix}
                placeholder="e.g., s_axi_"
                fullWidth
                inputClassName="px-2 py-1 rounded flex-1"
                inputStyle={TEXT_STYLES.value}
                containerClassName="flex items-center gap-2 flex-1"
              />
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <span style={TEXT_STYLES.value}>
                  {bus.physicalPrefix ?? <span style={TEXT_STYLES.muted}>not set</span>}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    startEditPrefix(index, bus.physicalPrefix ?? '');
                  }}
                  className="p-1 rounded"
                  title="Edit prefix"
                >
                  <span className="codicon codicon-edit" style={{ fontSize: '12px' }}></span>
                </button>
              </div>
            )}
          </div>

          <div
            className="px-4 py-2 text-sm grid grid-cols-2 gap-4"
            style={{
              background: 'var(--vscode-editor-background)',
              borderTop: '1px solid var(--vscode-panel-border)',
            }}
          >
            <div className="flex items-center gap-2">
              <span style={{ ...TEXT_STYLES.label, minWidth: '60px' }}>Clock:</span>
              <select
                value={bus.associatedClock ?? ''}
                onChange={(e) => updateAssociation(index, 'associatedClock', e.target.value)}
                className="px-2 py-1 rounded flex-1"
                style={{
                  background: 'var(--vscode-input-background)',
                  border:
                    highlight?.entityName === bus.name && highlight?.field === 'associatedClock'
                      ? '1px solid var(--vscode-inputValidation-errorBorder)'
                      : '1px solid var(--vscode-input-border)',
                  color: 'var(--vscode-input-foreground)',
                  outline: 'none',
                  fontSize: 'inherit',
                  boxShadow:
                    highlight?.entityName === bus.name && highlight?.field === 'associatedClock'
                      ? '0 0 0 1px var(--vscode-inputValidation-errorBorder)'
                      : 'none',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">None</option>
                {clocks.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {c.frequency ? ` (${c.frequency})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span style={{ ...TEXT_STYLES.label, minWidth: '60px' }}>Reset:</span>
              <select
                value={bus.associatedReset ?? ''}
                onChange={(e) => updateAssociation(index, 'associatedReset', e.target.value)}
                className="px-2 py-1 rounded flex-1"
                style={{
                  background: 'var(--vscode-input-background)',
                  border:
                    highlight?.entityName === bus.name && highlight?.field === 'associatedReset'
                      ? '1px solid var(--vscode-inputValidation-errorBorder)'
                      : '1px solid var(--vscode-input-border)',
                  color: 'var(--vscode-input-foreground)',
                  outline: 'none',
                  fontSize: 'inherit',
                  boxShadow:
                    highlight?.entityName === bus.name && highlight?.field === 'associatedReset'
                      ? '0 0 0 1px var(--vscode-inputValidation-errorBorder)'
                      : 'none',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <option value="">None</option>
                {resets.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name}
                    {r.polarity ? ` (${r.polarity})` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(() => {
            const optionalPorts = getOptionalPorts(bus);
            if (optionalPorts.length === 0) {
              return null;
            }
            const enabledPorts = bus.useOptionalPorts ?? [];
            return (
              <div
                className="px-4 py-2 text-sm"
                style={{
                  background: 'var(--vscode-editor-background)',
                  borderTop: '1px solid var(--vscode-panel-border)',
                }}
              >
                <div className="font-medium mb-2" style={TEXT_STYLES.label}>
                  Optional Ports
                </div>
                <div className="flex flex-wrap gap-3">
                  {optionalPorts.map((port) => {
                    const isEnabled = enabledPorts.includes(port.name);
                    return (
                      <label
                        key={port.name}
                        className="flex items-center gap-1.5 cursor-pointer"
                        title={`Width: ${port.width ?? 1}, Dir: ${port.direction ?? 'N/A'}`}
                      >
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={() => toggleOptionalPort(index, port.name, isEnabled)}
                          onClick={(e) => e.stopPropagation()}
                          style={{ accentColor: 'var(--vscode-focusBorder)' }}
                        />
                        <span
                          style={{
                            ...TEXT_STYLES.value,
                            color: isEnabled
                              ? undefined
                              : 'var(--vscode-input-placeholderForeground)',
                          }}
                        >
                          {port.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div
            className="px-4 py-2 text-sm"
            style={{
              background: 'var(--vscode-editor-background)',
              borderTop: '1px solid var(--vscode-panel-border)',
            }}
          >
            <div className="flex items-center gap-2">
              <span style={TEXT_STYLES.label}>Memory Map:</span>
              <div className="flex-1">
                {(() => {
                  const availableMaps = imports?.memoryMaps ?? [];
                  const isFilePath =
                    bus.memoryMapRef &&
                    (bus.memoryMapRef.endsWith('.yml') || bus.memoryMapRef.endsWith('.yaml'));

                  return (
                    <div className="flex items-center gap-2">
                      <select
                        value={bus.memoryMapRef ?? ''}
                        onChange={(e) =>
                          onUpdate(
                            ['busInterfaces', index, 'memoryMapRef'],
                            e.target.value || undefined
                          )
                        }
                        className="flex-1 px-1 py-0.5 rounded"
                        style={{
                          ...TEXT_STYLES.value,
                          background: 'var(--vscode-input-background)',
                          border: '1px solid var(--vscode-input-border)',
                          color: 'var(--vscode-input-foreground)',
                          outline: 'none',
                          fontSize: 'inherit',
                          boxShadow:
                            highlight?.entityName === bus.name &&
                            highlight?.field === 'memoryMapRef'
                              ? '0 0 0 1px var(--vscode-inputValidation-errorBorder)'
                              : 'none',
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <option value="">None</option>

                        {availableMaps.length > 0 && (
                          <optgroup label="Detected Maps">
                            {(availableMaps as { name?: string }[]).map((map, i: number) => (
                              <option key={map.name ?? i} value={map.name}>
                                {map.name}
                              </option>
                            ))}
                          </optgroup>
                        )}

                        {bus.memoryMapRef &&
                          !(availableMaps as { name?: string }[]).find(
                            (m) => m.name === bus.memoryMapRef
                          ) && (
                            <option value={bus.memoryMapRef}>
                              {bus.memoryMapRef}{' '}
                              {isFilePath ? '(File Path - Deprecated)' : '(Unknown)'}
                            </option>
                          )}
                      </select>
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>

          <div
            className="px-4 py-2 text-sm"
            style={{
              background: 'var(--vscode-editor-background)',
              borderTop: '1px solid var(--vscode-panel-border)',
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium" style={TEXT_STYLES.label}>
                Array Configuration
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleArray(index, !!bus.array);
                }}
                className="px-2 py-0.5 rounded text-xs"
                style={{
                  background: 'var(--vscode-button-secondaryBackground)',
                  color: 'var(--vscode-button-secondaryForeground)',
                }}
              >
                {bus.array ? 'Remove Array' : 'Add Array'}
              </button>
            </div>
            {bus.array && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div className="flex items-center gap-2">
                  <span style={TEXT_STYLES.label}>Count:</span>
                  {editingArrayField?.busIndex === index && editingArrayField?.field === 'count' ? (
                    <InlineEditField
                      type="number"
                      value={draftArrayValue}
                      onChange={setDraftArrayValue}
                      onSave={() => saveArrayField(index)}
                      onCancel={cancelEditArrayField}
                      min="1"
                      width="50px"
                      inputStyle={TEXT_STYLES.value}
                    />
                  ) : (
                    <span
                      onClick={() => startEditArrayField(index, 'count', bus.array?.count ?? 1)}
                      className="cursor-pointer"
                      style={{
                        ...TEXT_STYLES.value,
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                      }}
                      title="Click to edit"
                    >
                      {bus.array.count}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span style={TEXT_STYLES.label}>Index Start:</span>
                  {editingArrayField?.busIndex === index &&
                  editingArrayField?.field === 'indexStart' ? (
                    <InlineEditField
                      type="number"
                      value={draftArrayValue}
                      onChange={setDraftArrayValue}
                      onSave={() => saveArrayField(index)}
                      onCancel={cancelEditArrayField}
                      min="0"
                      width="50px"
                      inputStyle={TEXT_STYLES.value}
                    />
                  ) : (
                    <span
                      onClick={() =>
                        startEditArrayField(index, 'indexStart', bus.array?.indexStart ?? 0)
                      }
                      className="cursor-pointer"
                      style={{
                        ...TEXT_STYLES.value,
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                      }}
                      title="Click to edit"
                    >
                      {bus.array.indexStart ?? 0}
                    </span>
                  )}
                </div>

                <div className="col-span-2 flex items-center gap-2">
                  <span style={TEXT_STYLES.label}>Naming Pattern:</span>
                  {editingArrayField?.busIndex === index &&
                  editingArrayField?.field === 'namingPattern' ? (
                    <InlineEditField
                      value={draftArrayValue}
                      onChange={setDraftArrayValue}
                      onSave={() => saveArrayField(index)}
                      onCancel={cancelEditArrayField}
                      placeholder="e.g., NAME_{index}"
                      fullWidth
                      inputClassName="px-1 py-0.5 rounded flex-1"
                      inputStyle={TEXT_STYLES.value}
                      containerClassName="flex items-center gap-1 flex-1"
                    />
                  ) : (
                    <span
                      onClick={() =>
                        startEditArrayField(index, 'namingPattern', bus.array?.namingPattern ?? '')
                      }
                      className="cursor-pointer"
                      style={{
                        ...TEXT_STYLES.value,
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                        color: bus.array.namingPattern
                          ? undefined
                          : 'var(--vscode-input-placeholderForeground)',
                      }}
                      title="Click to edit"
                    >
                      {bus.array.namingPattern ?? 'not set'}
                    </span>
                  )}
                </div>

                <div className="col-span-2 flex items-center gap-2">
                  <span style={TEXT_STYLES.label}>Prefix Pattern:</span>
                  {editingArrayField?.busIndex === index &&
                  editingArrayField?.field === 'physicalPrefixPattern' ? (
                    <InlineEditField
                      value={draftArrayValue}
                      onChange={setDraftArrayValue}
                      onSave={() => saveArrayField(index)}
                      onCancel={cancelEditArrayField}
                      placeholder="e.g., prefix_{index}_"
                      fullWidth
                      inputClassName="px-1 py-0.5 rounded flex-1"
                      inputStyle={TEXT_STYLES.value}
                      containerClassName="flex items-center gap-1 flex-1"
                    />
                  ) : (
                    <span
                      onClick={() =>
                        startEditArrayField(
                          index,
                          'physicalPrefixPattern',
                          bus.array?.physicalPrefixPattern ?? ''
                        )
                      }
                      className="cursor-pointer"
                      style={{
                        ...TEXT_STYLES.value,
                        textDecoration: 'underline',
                        textDecorationStyle: 'dotted',
                        color: bus.array.physicalPrefixPattern
                          ? undefined
                          : 'var(--vscode-input-placeholderForeground)',
                      }}
                      title="Click to edit"
                    >
                      {bus.array.physicalPrefixPattern ?? 'not set'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <PortMappingTable
            index={index}
            bus={bus}
            ports={ports}
            busLibrary={busLibrary}
            isSelected={isSelected}
            selectedPortIndex={selectedPortIndex}
            selectedColumn={selectedColumn}
            editingPortName={editingPortName}
            draftPortName={draftPortName}
            editingPortWidth={editingPortWidth}
            draftPortWidth={draftPortWidth}
            containerRef={containerRef}
            setSelectedIndex={setSelectedIndex}
            setSelectedPortIndex={setSelectedPortIndex}
            setDraftPortName={setDraftPortName}
            setDraftPortWidth={setDraftPortWidth}
            getPortSuffix={getPortSuffix}
            startEditPortName={startEditPortName}
            savePortName={savePortName}
            cancelEditPortName={cancelEditPortName}
            startEditPortWidth={startEditPortWidth}
            savePortWidth={savePortWidth}
            cancelEditPortWidth={cancelEditPortWidth}
          />
        </div>
      )}
    </div>
  );
};
