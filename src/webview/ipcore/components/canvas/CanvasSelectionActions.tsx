import React, { useState, useMemo } from 'react';
import type { IpCore } from '../../../types/ipCore';
import type { CanvasMultiSelection } from '../../hooks/useCanvasSelection';
import type { BatchUpdate } from '../../hooks/useGroupPorts';
import { useGroupPorts } from '../../hooks/useGroupPorts';
import { matchPorts, getAllProtocols, type ProtocolMatch } from '../../utils/protocolMatcher';
import { GroupingMappingStep } from './GroupingMappingStep';

interface CanvasSelectionActionsProps {
  multiSelection: CanvasMultiSelection;
  ipCore: IpCore;
  batchUpdate: BatchUpdate;
  onDismiss: () => void;
}

const SCORE_THRESHOLD = 0.6;

const STYLE = {
  toolbar: {
    position: 'absolute' as const,
    top: 8,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--vscode-editor-background)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 12,
    whiteSpace: 'nowrap' as const,
    zIndex: 20,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  },
  badge: {
    opacity: 0.7,
    fontSize: 11,
  },
  btn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 2,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 11,
  },
  btnSecondary: {
    background: 'transparent',
    color: 'var(--vscode-foreground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 2,
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 11,
  },
  sep: {
    width: 1,
    height: 16,
    background: 'var(--vscode-panel-border)',
    flexShrink: 0,
  },
  select: {
    background: 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
    borderRadius: 2,
    padding: '3px 4px',
    fontSize: 11,
    cursor: 'pointer',
  },
};

export const CanvasSelectionActions: React.FC<CanvasSelectionActionsProps> = ({
  multiSelection,
  ipCore,
  batchUpdate,
  onDismiss,
}) => {
  const groupPorts = useGroupPorts(ipCore, batchUpdate);

  const [mappingStep, setMappingStep] = useState<{
    busType: string;
    busLabel: string;
  } | null>(null);

  const selectedPortIndices = useMemo(() => {
    const indices: number[] = [];
    for (const el of multiSelection.all.values()) {
      if (el.kind === 'port' || el.kind === 'interrupt') {
        indices.push(el.index);
      }
    }
    return indices;
  }, [multiSelection]);

  const selectedPorts = useMemo(
    () =>
      selectedPortIndices.map((i) => ipCore.ports?.[i]).filter(Boolean) as Array<{
        name: string;
        direction: 'in' | 'out' | 'inout';
      }>,
    [selectedPortIndices, ipCore.ports]
  );

  const suggestions = useMemo((): ProtocolMatch[] => {
    if (selectedPorts.length === 0) {
      return [];
    }
    return matchPorts(selectedPorts).filter((m) => m.score >= SCORE_THRESHOLD);
  }, [selectedPorts]);

  const allProtocols = useMemo(() => getAllProtocols(), []);

  const suggestedTypes = useMemo(() => new Set(suggestions.map((m) => m.busType)), [suggestions]);

  const handleGroupAsConduit = () => {
    const existingNames = (ipCore.busInterfaces ?? []).map((b) => b.name);
    let name = 'custom_if';
    let n = 0;
    while (existingNames.includes(name)) {
      name = `custom_if_${n++}`;
    }
    groupPorts.groupAsConduit({
      portIndices: selectedPortIndices,
      interfaceName: name,
      physicalPrefix: `${name}_`,
    });
    onDismiss();
  };

  const handleGroupAsProtocol = (match: ProtocolMatch) => {
    setMappingStep({ busType: match.busType, busLabel: match.label });
  };

  const count = multiSelection.all.size;

  if (mappingStep) {
    return (
      <GroupingMappingStep
        ipCore={ipCore}
        busType={mappingStep.busType}
        busLabel={mappingStep.busLabel}
        selectedPortIndices={selectedPortIndices}
        onConfirm={(opts) => {
          groupPorts.groupAsStandard(opts);
          setMappingStep(null);
          onDismiss();
        }}
        onCancel={() => setMappingStep(null)}
      />
    );
  }

  return (
    <div style={STYLE.toolbar}>
      <span style={STYLE.badge}>
        {count} port{count !== 1 ? 's' : ''} selected
      </span>
      <div style={STYLE.sep} />
      <button style={STYLE.btn} onClick={handleGroupAsConduit}>
        Group as Conduit
      </button>
      {suggestions.map((m) => (
        <button
          key={m.busType}
          style={STYLE.btn}
          title={`Match score: ${Math.round(m.score * 100)}% — ${m.inferredMode}`}
          onClick={() => handleGroupAsProtocol(m)}
        >
          Group as {m.label}
        </button>
      ))}
      <select
        style={STYLE.select}
        defaultValue=""
        onChange={(e) => {
          const chosen = allProtocols.find((p) => p.busType === e.target.value);
          if (chosen && !suggestedTypes.has(chosen.busType)) {
            setMappingStep({ busType: chosen.busType, busLabel: chosen.label });
          } else if (chosen) {
            const suggestion = suggestions.find((s) => s.busType === chosen.busType);
            if (suggestion) {
              handleGroupAsProtocol(suggestion);
            }
          }
          e.target.value = '';
        }}
      >
        <option value="" disabled>
          Group as Standard…
        </option>
        {allProtocols.map((p) => (
          <option key={p.busType} value={p.busType}>
            {p.label}
            {suggestedTypes.has(p.busType) ? ' ✓' : ''}
          </option>
        ))}
      </select>
      <div style={STYLE.sep} />
      <button
        style={STYLE.btnSecondary}
        onClick={onDismiss}
        aria-label="Dismiss selection actions"
        title="Dismiss selection actions (Escape)"
      >
        ✕
      </button>
    </div>
  );
};
