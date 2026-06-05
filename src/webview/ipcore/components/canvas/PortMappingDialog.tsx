import React from 'react';
import type { IpCore } from '../../../types/ipCore';

interface PortMappingDialogProps {
  ipCore: IpCore;
  portIndex: number;
  busIndex: number;
  onConfirm: () => void;
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
    width: 320,
    zIndex: 30,
    boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    fontSize: 12,
  },
  title: {
    fontWeight: 600,
    marginBottom: 8,
  },
  body: {
    opacity: 0.85,
    lineHeight: 1.5,
    marginBottom: 12,
  },
  footer: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
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
    color: 'var(--vscode-foreground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: 2,
    padding: '4px 10px',
    cursor: 'pointer',
    fontSize: 12,
  },
};

export const PortMappingDialog: React.FC<PortMappingDialogProps> = ({
  ipCore,
  portIndex,
  busIndex,
  onConfirm,
  onCancel,
}) => {
  const port = ipCore.ports?.[portIndex];
  const bus = ipCore.busInterfaces?.[busIndex];

  if (!port || !bus) {
    return null;
  }

  return (
    <div style={STYLE.overlay}>
      <div style={STYLE.title}>Remove from standalone ports?</div>
      <div style={STYLE.body}>
        Port <strong>{port.name}</strong> matches the prefix{' '}
        <code style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>
          {bus.physicalPrefix}
        </code>{' '}
        of bus interface <strong>{bus.name}</strong>.
        <br />
        <br />
        Removing it from the standalone ports list will let the bus interface manage this signal.
        The port will continue to appear in the generated HDL.
      </div>
      <div style={STYLE.footer}>
        <button style={STYLE.btnSecondary} onClick={onCancel}>
          Cancel
        </button>
        <button style={STYLE.btnPrimary} onClick={onConfirm}>
          Remove port
        </button>
      </div>
    </div>
  );
};
