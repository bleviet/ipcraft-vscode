import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { IpCore, Port } from '../../../types/ipCore';
import type { GroupAsStandardOptions } from '../../hooks/useGroupPorts';
import {
  inferPortAssignments,
  inferPrefixAndMode,
  portSuffix,
  type SignalAssignment,
} from '../../utils/protocolMatcher';
import { lookupBusDef } from '../../data/busDefinitions';

interface GroupingMappingStepProps {
  ipCore: IpCore;
  busType: string;
  busLabel: string;
  selectedPortIndices: number[];
  onConfirm: (opts: GroupAsStandardOptions) => void;
  onCancel: () => void;
}

const STYLE = {
  panel: {
    position: 'absolute' as const,
    top: 8,
    right: 12,
    width: 380,
    maxHeight: 'calc(100% - 24px)',
    overflowY: 'auto' as const,
    background: 'var(--vscode-editor-background)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'var(--vscode-font-family)',
    zIndex: 20,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  header: {
    padding: '8px 12px',
    fontWeight: 600,
    borderBottom: '1px solid var(--vscode-panel-border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  field: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '4px 12px',
  },
  label: {
    opacity: 0.7,
    width: 110,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border, var(--vscode-panel-border))',
    borderRadius: 2,
    padding: '2px 6px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 12,
  },
  select: {
    flex: 1,
    background: 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
    borderRadius: 2,
    padding: '2px 4px',
    fontSize: 12,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 11,
  },
  thCell: {
    padding: '4px 8px',
    textAlign: 'left' as const,
    opacity: 0.6,
    fontWeight: 600,
    background: 'var(--vscode-editor-background)',
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

export const GroupingMappingStep: React.FC<GroupingMappingStepProps> = ({
  ipCore,
  busType,
  busLabel,
  selectedPortIndices,
  onConfirm,
  onCancel,
}) => {
  const selectedPorts: Port[] = useMemo(
    () => selectedPortIndices.map((i) => ipCore.ports?.[i]).filter(Boolean) as Port[],
    [ipCore.ports, selectedPortIndices]
  );

  const portsAsInput = useMemo(
    () => selectedPorts.map((p) => ({ name: p.name, direction: p.direction })),
    [selectedPorts]
  );

  const inferred = useMemo(
    () => inferPrefixAndMode(portsAsInput, busType),
    [portsAsInput, busType]
  );

  const [interfaceName, setInterfaceName] = useState(() => {
    const lower = busType.split('.')[2] ?? 'interface';
    return lower.replace(/_/g, '_').toLowerCase();
  });
  const [prefix, setPrefix] = useState(inferred?.prefix ?? '');
  const [mode, setMode] = useState<'slave' | 'master'>(inferred?.mode ?? 'slave');
  const [assignments, setAssignments] = useState<SignalAssignment[]>([]);
  const [staleWarning, setStaleWarning] = useState(false);

  const [associatedClock, setAssociatedClock] = useState<string>(ipCore.clocks?.[0]?.name ?? '');
  const [associatedReset, setAssociatedReset] = useState<string>(ipCore.resets?.[0]?.name ?? '');

  const recomputeAssignments = useCallback(
    (currentPrefix: string, currentMode: 'slave' | 'master') => {
      const current = selectedPortIndices.map((i) => ipCore.ports?.[i]).filter(Boolean) as Port[];

      if (current.length !== selectedPortIndices.length) {
        setStaleWarning(true);
      }

      setAssignments(
        inferPortAssignments(
          current.map((p) => ({ name: p.name, direction: p.direction })),
          busType,
          currentMode,
          currentPrefix
        )
      );
    },
    [busType, selectedPortIndices, ipCore.ports]
  );

  // Initial compute — intentionally runs only on mount
  useEffect(() => {
    recomputeAssignments(prefix, mode);
    // The empty dep array is intentional: we only want to auto-assign on mount.
    // Subsequent prefix/mode changes are handled by handlePrefixChange/handleModeChange.
    // Port staleness is handled by the separate effect below.
  }, []); // mount-only

  // Re-evaluate when source file changes (ipCore.ports changes)
  useEffect(() => {
    const current = selectedPortIndices.map((i) => ipCore.ports?.[i]).filter(Boolean);
    if (current.length !== selectedPortIndices.length) {
      setStaleWarning(true);
    }
    recomputeAssignments(prefix, mode);
    // We intentionally omit prefix/mode from deps here — those are handled by
    // the dedicated handlers. We only want to react to external port list changes.
  }, [ipCore.ports]); // port-staleness guard

  const handlePrefixChange = (newPrefix: string) => {
    setPrefix(newPrefix);
    recomputeAssignments(newPrefix, mode);
  };

  const handleModeChange = (newMode: 'slave' | 'master') => {
    setMode(newMode);
    recomputeAssignments(prefix, newMode);
  };

  const handleAssignmentChange = (logicalName: string, portName: string | null) => {
    setAssignments((prev) =>
      prev.map((a) => {
        if (a.logicalName !== logicalName) {
          return a;
        }
        const port = portName ? (selectedPorts.find((p) => p.name === portName) ?? null) : null;
        const suffix = port ? portSuffix(port.name, prefix) : '';
        const hasSuffixMismatch = port !== null && suffix !== logicalName.toLowerCase();
        return { ...a, assignedPort: port, hasSuffixMismatch };
      })
    );
  };

  const requiredUnassigned = assignments.some((a) => a.presence === 'required' && !a.assignedPort);

  const portDefs = lookupBusDef(busType);
  const hasAnyAssignableSignals = (portDefs?.filter((d) => !d.role).length ?? 0) > 0;

  const handleConfirm = () => {
    const portNameOverrides: Record<string, string> = {};
    const useOptionalPorts: string[] = [];
    const assignedPortIndices: number[] = [];

    for (const a of assignments) {
      if (!a.assignedPort) {
        continue;
      }
      const idx = (ipCore.ports ?? []).findIndex((p) => p.name === a.assignedPort!.name);
      if (idx >= 0) {
        assignedPortIndices.push(idx);
      }
      if (a.hasSuffixMismatch) {
        portNameOverrides[a.logicalName] = portSuffix(a.assignedPort.name, prefix);
      }
      if (a.presence === 'optional') {
        useOptionalPorts.push(a.logicalName);
      }
    }

    onConfirm({
      portIndices: assignedPortIndices,
      busType,
      mode,
      physicalPrefix: prefix,
      interfaceName,
      portNameOverrides: Object.keys(portNameOverrides).length > 0 ? portNameOverrides : undefined,
      useOptionalPorts: useOptionalPorts.length > 0 ? useOptionalPorts : undefined,
      associatedClock: associatedClock || null,
      associatedReset: associatedReset || null,
    });
  };

  const clocks = ipCore.clocks ?? [];
  const resets = ipCore.resets ?? [];

  return (
    <div style={STYLE.panel}>
      <div style={STYLE.header}>
        <span>Group as {busLabel}</span>
        <button
          style={{ ...STYLE.btnSecondary, border: 'none', padding: '2px 6px' }}
          onClick={onCancel}
        >
          ✕
        </button>
      </div>

      {staleWarning && (
        <div
          style={{
            padding: '6px 12px',
            background: 'var(--vscode-inputValidation-warningBackground)',
            color: 'var(--vscode-inputValidation-warningForeground)',
            fontSize: 11,
          }}
        >
          ⚠ Source file was updated. Assignments have been re-evaluated.
        </div>
      )}

      <div style={{ padding: '6px 0' }}>
        <div style={STYLE.field}>
          <span style={STYLE.label}>Interface name</span>
          <input
            style={STYLE.input}
            value={interfaceName}
            onChange={(e) => setInterfaceName(e.target.value)}
          />
        </div>
        <div style={STYLE.field}>
          <span style={STYLE.label}>Prefix</span>
          <input
            style={STYLE.input}
            value={prefix}
            onChange={(e) => handlePrefixChange(e.target.value)}
            placeholder="e.g. s_axi_"
          />
        </div>
        <div style={STYLE.field}>
          <span style={STYLE.label}>Mode</span>
          <select
            style={STYLE.select}
            value={mode}
            onChange={(e) => handleModeChange(e.target.value as 'slave' | 'master')}
          >
            <option value="slave">Slave</option>
            <option value="master">Master</option>
          </select>
        </div>
        {clocks.length > 0 && (
          <div style={STYLE.field}>
            <span style={STYLE.label}>Clock</span>
            <select
              style={STYLE.select}
              value={associatedClock}
              onChange={(e) => setAssociatedClock(e.target.value)}
            >
              <option value="">— None —</option>
              {clocks.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {resets.length > 0 && (
          <div style={STYLE.field}>
            <span style={STYLE.label}>Reset</span>
            <select
              style={STYLE.select}
              value={associatedReset}
              onChange={(e) => setAssociatedReset(e.target.value)}
            >
              <option value="">— None —</option>
              {resets.map((r) => (
                <option key={r.name} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {hasAnyAssignableSignals && (
        <div style={{ overflowX: 'auto' as const }}>
          <table style={STYLE.table}>
            <thead>
              <tr>
                <th style={STYLE.thCell}>Logical</th>
                <th style={STYLE.thCell}>Assigned Port</th>
                <th style={STYLE.thCell}>Dir</th>
                <th style={STYLE.thCell}>Req</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const assignedElsewhere = new Set(
                  assignments.map((a) => a.assignedPort?.name).filter(Boolean) as string[]
                );
                return assignments.map((a) => {
                  const isError = a.presence === 'required' && !a.assignedPort;
                  const isMismatch = a.hasSuffixMismatch;
                  return (
                    <tr
                      key={a.logicalName}
                      style={{
                        background: isError
                          ? 'color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #5a1d1d) 30%, transparent)'
                          : 'transparent',
                      }}
                    >
                      <td
                        style={{
                          ...STYLE.tdCell,
                          fontFamily: 'var(--vscode-editor-font-family, monospace)',
                        }}
                      >
                        {a.logicalName}
                      </td>
                      <td style={STYLE.tdCell}>
                        <select
                          style={{
                            ...STYLE.select,
                            flex: undefined,
                            width: '100%',
                            color: isMismatch ? 'var(--vscode-charts-yellow)' : undefined,
                          }}
                          value={a.assignedPort?.name ?? ''}
                          onChange={(e) =>
                            handleAssignmentChange(a.logicalName, e.target.value || null)
                          }
                        >
                          <option value="">— unassigned —</option>
                          {selectedPorts
                            .filter((p) => {
                              // Exclude ports already claimed by another logical signal
                              if (
                                p.name !== a.assignedPort?.name &&
                                assignedElsewhere.has(p.name)
                              ) {
                                return false;
                              }
                              if (!a.expectedDir) {
                                return true;
                              }
                              // Direction guard: exclude direction-mismatched ports entirely
                              return p.direction === 'inout' || p.direction === a.expectedDir;
                            })
                            .map((p) => (
                              <option key={p.name} value={p.name}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                        {isMismatch && (
                          <span
                            style={{ marginLeft: 4, opacity: 0.7 }}
                            title="Suffix mismatch — portNameOverride will be generated"
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td style={{ ...STYLE.tdCell, opacity: 0.7 }}>{a.expectedDir ?? '—'}</td>
                      <td style={{ ...STYLE.tdCell, opacity: 0.7 }}>
                        {a.presence === 'required' ? '✓' : ''}
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
        </div>
      )}

      <div style={STYLE.footer}>
        <button style={STYLE.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={{
            ...STYLE.btnPrimary,
            opacity: requiredUnassigned || !interfaceName ? 0.5 : 1,
            cursor: requiredUnassigned || !interfaceName ? 'not-allowed' : 'pointer',
          }}
          disabled={requiredUnassigned || !interfaceName}
          onClick={handleConfirm}
        >
          Confirm ✓
        </button>
      </div>
    </div>
  );
};
