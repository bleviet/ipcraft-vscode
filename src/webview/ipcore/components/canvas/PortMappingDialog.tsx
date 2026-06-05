import React, { useState } from 'react';
import type { IpCore } from '../../../types/ipCore';

export interface SignalOption {
  name: string;
  direction?: 'in' | 'out';
  presence: 'required' | 'optional';
  /** Expected physical name (prefix + suffix) shown as a hint */
  physicalName: string;
}

interface PortMappingDialogProps {
  ipCore: IpCore;
  portIndex: number;
  busIndex: number;
  /** True when the target is a custom/conduit interface */
  isCustom: boolean;
  /** Protocol signals available for standard interfaces (empty for conduit) */
  signals: SignalOption[];
  /** onConfirm receives the selected signal name for standard interfaces */
  onConfirm: (selectedSignal?: string) => void;
  onCancel: () => void;
}

const STYLE = {
  overlay: {
    position: 'absolute' as const,
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    background: 'var(--vscode-editor-background)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 4,
    padding: 16,
    width: 360,
    zIndex: 30,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    fontSize: 12,
  },
  title: { fontWeight: 600, marginBottom: 8 },
  body: { opacity: 0.85, lineHeight: 1.5, marginBottom: 12 },
  label: { display: 'block', marginBottom: 4, opacity: 0.7 },
  select: {
    width: '100%',
    background: 'var(--vscode-dropdown-background)',
    color: 'var(--vscode-dropdown-foreground)',
    border: '1px solid var(--vscode-dropdown-border)',
    borderRadius: 2,
    padding: '4px 6px',
    fontSize: 12,
    marginBottom: 12,
  },
  hint: { opacity: 0.55, fontSize: 11, marginBottom: 12 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 8 },
  btnPrimary: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 2,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
  btnPrimaryDisabled: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: 2,
    padding: '4px 10px',
    cursor: 'not-allowed',
    fontSize: 12,
    opacity: 0.4,
  },
  btnSecondary: {
    background: 'transparent',
    color: 'var(--vscode-foreground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 2,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
};

const mono = { fontFamily: 'var(--vscode-editor-font-family, monospace)' };

export const PortMappingDialog: React.FC<PortMappingDialogProps> = ({
  ipCore,
  portIndex,
  busIndex,
  isCustom,
  signals,
  onConfirm,
  onCancel,
}) => {
  const [selectedSignal, setSelectedSignal] = useState('');

  const port = ipCore.ports?.[portIndex];
  const bus = ipCore.busInterfaces?.[busIndex];

  if (!port || !bus) {
    return null;
  }

  if (isCustom) {
    return (
      <div style={STYLE.overlay}>
        <div style={STYLE.title}>Add signal to custom interface?</div>
        <div style={STYLE.body}>
          Port <strong>{port.name}</strong> will be moved into custom interface{' '}
          <strong>{bus.name}</strong> as a conduit signal, keeping its current name{' '}
          <code style={mono}>{port.name}</code> and direction{' '}
          <code style={mono}>{port.direction}</code>.
        </div>
        <div style={STYLE.footer}>
          <button style={STYLE.btnSecondary} onClick={onCancel}>
            Cancel
          </button>
          <button style={STYLE.btnPrimary} onClick={() => onConfirm()}>
            Add to interface
          </button>
        </div>
      </div>
    );
  }

  // Standard protocol interface — require signal selection
  const prefix = (bus as { physicalPrefix?: string }).physicalPrefix ?? '';
  const overrideSuffix =
    prefix.length > 0 && port.name.startsWith(prefix) ? port.name.slice(prefix.length) : port.name;
  // The resulting physical name is always prefix + overrideSuffix (same for all signals).
  const resultingPhysical = `${prefix}${overrideSuffix}`;

  const canConfirm = selectedSignal !== '';

  return (
    <div style={STYLE.overlay}>
      <div style={STYLE.title}>Assign port to bus signal</div>
      <div style={STYLE.body}>
        Map <strong>{port.name}</strong> to a signal in bus interface <strong>{bus.name}</strong>.
        The port will be removed from the standalone list and tracked as an override within the
        interface.
      </div>

      <label style={STYLE.label}>Signal in {bus.name}</label>
      <select
        style={STYLE.select}
        value={selectedSignal}
        onChange={(e) => setSelectedSignal(e.target.value)}
      >
        <option value="">— select a signal —</option>
        {signals.map((sig) => (
          <option key={sig.name} value={sig.name}>
            {sig.name}
            {sig.direction ? ` [${sig.direction}]` : ''}
            {sig.presence === 'optional' ? ' (optional)' : ''}
            {' — '}
            {sig.physicalName}
          </option>
        ))}
      </select>

      {selectedSignal && (
        <div style={STYLE.hint}>
          Physical name after assignment: <code style={mono}>{resultingPhysical}</code>
        </div>
      )}

      <div style={STYLE.footer}>
        <button style={STYLE.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button
          style={canConfirm ? STYLE.btnPrimary : STYLE.btnPrimaryDisabled}
          disabled={!canConfirm}
          onClick={() => canConfirm && onConfirm(selectedSignal)}
        >
          Assign to interface
        </button>
      </div>
    </div>
  );
};
