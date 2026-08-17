import React, { useState } from 'react';
import type { ConduitPort } from '../../../types/ipCore';
import { isAssociatedPort, type BusPortDef } from '../../utils/busLibrary';
import { portNameCandidates, type PortPolarity } from '../../../../shared/busContracts';
import type { MapConduitToBusOptions } from '../../hooks/useGroupPorts';

export type { MapConduitToBusOptions as MapConduitToBusResult } from '../../hooks/useGroupPorts';

interface MapConduitToBusDialogProps {
  busLabel: string;
  conduitPorts: ConduitPort[];
  libraryPortDefs: BusPortDef[];
  onConfirm: (result: MapConduitToBusOptions) => void;
  onCancel: () => void;
}

const STYLE = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  panel: {
    width: 420,
    maxHeight: '80vh',
    overflowY: 'auto' as const,
    background: 'var(--vscode-editor-background)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'var(--vscode-font-family)',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    padding: '8px 12px',
    fontWeight: 600,
    borderBottom: '1px solid var(--vscode-panel-border)',
  },
  body: { padding: '8px 12px' },
  field: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' },
  label: { opacity: 0.7, width: 90, flexShrink: 0 },
  select: {
    flex: 1,
    background: 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
    borderRadius: 2,
    padding: '2px 4px',
    fontSize: 12,
  },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11, marginTop: 8 },
  thCell: {
    padding: '4px 8px',
    textAlign: 'left' as const,
    opacity: 0.6,
    fontWeight: 600,
    borderBottom: '1px solid var(--vscode-panel-border)',
  },
  tdCell: {
    padding: '3px 8px',
    borderBottom: '1px solid color-mix(in srgb, var(--vscode-panel-border) 50%, transparent)',
    verticalAlign: 'middle' as const,
  },
  footer: {
    padding: '8px 12px',
    borderTop: '1px solid var(--vscode-panel-border)',
    display: 'flex',
    justifyContent: 'space-between',
  },
  btnPrimary: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 2,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  btnSecondary: {
    background: 'transparent',
    color: 'var(--vscode-button-secondaryForeground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 2,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
};

/** A logical port's expected direction from the chosen mode's perspective. */
function expectedDirection(def: BusPortDef, mode: 'slave' | 'master'): 'in' | 'out' | undefined {
  if (!def.direction) {
    return undefined;
  }
  if (mode === 'master') {
    return def.direction;
  }
  return def.direction === 'in' ? 'out' : 'in';
}

interface MappingAssignment {
  physicalPort: string;
  polarity?: PortPolarity;
}

/** Best-effort declared-role match (case-insensitive) to seed the editable mapping. */
function findAutoMatch(def: BusPortDef, candidates: ConduitPort[]): MappingAssignment | undefined {
  for (const role of portNameCandidates(def)) {
    const port = candidates.find((p) => p.name.toLowerCase() === role.suffix.toLowerCase());
    if (port) {
      return { physicalPort: port.name, ...(role.polarity ? { polarity: role.polarity } : {}) };
    }
  }
  return undefined;
}

/**
 * Lets the user map an already-authored conduit interface's physical signals onto a
 * newly-recognized library bus type's official logical ports (e.g. discovered via the
 * Vivado interface catalog scan), instead of silently guessing or losing the existing
 * port data. Produces portNameOverrides/useOptionalPorts — the same mechanism standard
 * bus interfaces already use — and the caller clears conduitPorts once confirmed.
 */
export const MapConduitToBusDialog: React.FC<MapConduitToBusDialogProps> = ({
  busLabel,
  conduitPorts,
  libraryPortDefs,
  onConfirm,
  onCancel,
}) => {
  const [mode, setMode] = useState<'slave' | 'master'>('slave');
  const assignableDefs = libraryPortDefs.filter((port) => !isAssociatedPort(port));

  const [assignments, setAssignments] = useState<Record<string, MappingAssignment>>(() => {
    const seeded: Record<string, MappingAssignment> = {};
    for (const def of assignableDefs) {
      const match = findAutoMatch(def, conduitPorts);
      if (match) {
        seeded[def.name] = match;
      }
    }
    return seeded;
  });

  const assignedElsewhere = new Set(
    Object.values(assignments)
      .map((assignment) => assignment.physicalPort)
      .filter(Boolean)
  );
  const requiredUnassigned = assignableDefs.some(
    (d) => d.presence === 'required' && !assignments[d.name]?.physicalPort
  );

  const handleConfirm = () => {
    const portNameOverrides: Record<string, string> = {};
    const portWidthOverrides: Record<string, number | string> = {};
    const portPolarityOverrides: Record<string, PortPolarity> = {};
    const useOptionalPorts: string[] = [];
    const assignedPortNames = new Set<string>();
    // Build a quick lookup from conduit port name to width
    const conduitWidthByName: Record<string, number | string> = {};
    for (const cp of conduitPorts) {
      if (cp.width !== undefined) {
        conduitWidthByName[cp.name] = cp.width;
      }
    }
    for (const def of assignableDefs) {
      const assignment = assignments[def.name];
      if (!assignment?.physicalPort) {
        continue;
      }
      assignedPortNames.add(assignment.physicalPort);
      const polarity = assignment.polarity ?? def.polarity?.default;
      const selectedRole = def.polarity && polarity ? def.polarity.roles[polarity] : def.name;
      if (assignment.physicalPort !== selectedRole) {
        portNameOverrides[def.name] = assignment.physicalPort;
      }
      if (def.polarity && polarity && polarity !== def.polarity.default) {
        portPolarityOverrides[def.name] = polarity;
      }
      if (def.presence === 'optional') {
        useOptionalPorts.push(def.name);
      }
      // Preserve the conduit port's width so it is not silently replaced by the
      // bus definition's default width after conduitPorts are cleared.
      const w = conduitWidthByName[assignment.physicalPort];
      if (w !== undefined) {
        portWidthOverrides[def.name] = w;
      }
    }
    onConfirm({
      mode,
      portNameOverrides,
      ...(Object.keys(portWidthOverrides).length > 0 ? { portWidthOverrides } : {}),
      ...(Object.keys(portPolarityOverrides).length > 0 ? { portPolarityOverrides } : {}),
      ...(conduitPorts.some((port) => !assignedPortNames.has(port.name))
        ? { unmappedConduitPorts: conduitPorts.filter((port) => !assignedPortNames.has(port.name)) }
        : {}),
      useOptionalPorts,
    });
  };

  return (
    <div style={STYLE.overlay} onClick={onCancel}>
      <div style={STYLE.panel} onClick={(e) => e.stopPropagation()}>
        <div style={STYLE.header}>Map signals to {busLabel}</div>
        <div style={STYLE.body}>
          <div style={STYLE.field}>
            <span style={STYLE.label}>Mode</span>
            <select
              style={STYLE.select}
              value={mode}
              onChange={(e) => setMode(e.target.value as 'slave' | 'master')}
            >
              <option value="slave">Slave</option>
              <option value="master">Master</option>
            </select>
          </div>

          {assignableDefs.length === 0 ? (
            <div style={{ opacity: 0.7, padding: '8px 0' }}>
              This interface has no signal-level ports to map.
            </div>
          ) : (
            <table style={STYLE.table}>
              <thead>
                <tr>
                  <th style={STYLE.thCell}>Logical</th>
                  <th style={STYLE.thCell}>Your signal</th>
                  <th style={STYLE.thCell}>Polarity</th>
                  <th style={STYLE.thCell}>Req</th>
                </tr>
              </thead>
              <tbody>
                {assignableDefs.map((def) => {
                  const expectedDir = expectedDirection(def, mode);
                  const assignment = assignments[def.name];
                  const current = assignment?.physicalPort ?? '';
                  const polarity = assignment?.polarity ?? def.polarity?.default;
                  const isError = def.presence === 'required' && !current;
                  return (
                    <tr key={def.name}>
                      <td
                        style={{
                          ...STYLE.tdCell,
                          fontFamily: 'var(--vscode-editor-font-family, monospace)',
                          color: isError
                            ? 'var(--vscode-inputValidation-errorForeground)'
                            : undefined,
                        }}
                      >
                        {def.name}
                      </td>
                      <td style={STYLE.tdCell}>
                        <select
                          style={{ ...STYLE.select, width: '100%' }}
                          value={current}
                          onChange={(e) =>
                            setAssignments((prev) => {
                              if (!e.target.value) {
                                const { [def.name]: _removed, ...remaining } = prev;
                                return remaining;
                              }
                              return {
                                ...prev,
                                [def.name]: {
                                  physicalPort: e.target.value,
                                  ...(def.polarity
                                    ? { polarity: polarity ?? def.polarity.default }
                                    : {}),
                                },
                              };
                            })
                          }
                        >
                          <option value="">— unassigned —</option>
                          {conduitPorts
                            .filter((p) => {
                              if (p.name !== current && assignedElsewhere.has(p.name)) {
                                return false;
                              }
                              if (!expectedDir) {
                                return true;
                              }
                              return p.direction === 'inout' || p.direction === expectedDir;
                            })
                            .map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </td>
                      <td style={STYLE.tdCell}>
                        {def.polarity ? (
                          <select
                            aria-label={`${def.name} polarity`}
                            style={{ ...STYLE.select, width: '100%' }}
                            value={polarity}
                            onChange={(e) =>
                              setAssignments((prev) => ({
                                ...prev,
                                [def.name]: {
                                  physicalPort: current,
                                  polarity: e.target.value as PortPolarity,
                                },
                              }))
                            }
                          >
                            <option value="activeHigh">Active high</option>
                            <option value="activeLow">Active low</option>
                          </select>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ ...STYLE.tdCell, opacity: 0.7 }}>
                        {def.presence === 'required' ? '✓' : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div style={STYLE.footer}>
          <button style={STYLE.btnSecondary} onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            style={{
              ...STYLE.btnPrimary,
              opacity: requiredUnassigned ? 0.5 : 1,
              cursor: requiredUnassigned ? 'not-allowed' : 'pointer',
            }}
            disabled={requiredUnassigned}
            onClick={handleConfirm}
            type="button"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};
