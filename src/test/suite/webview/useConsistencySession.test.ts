import { act, renderHook } from '@testing-library/react';
import {
  useConsistencySession,
  type ConsistencyResultMessage,
} from '../../../webview/ipcore/hooks/useConsistencySession';
import type { ConsistencyFinding } from '../../../webview/ipcore/types/consistency';

const finding: ConsistencyFinding = {
  kind: 'extra-port',
  message: "'o_status' exists in core.vhd but is not declared in the .ip.yml.",
  ipYmlPath: ['ports'],
  hdlFile: 'core.vhd',
  hdlEntity: 'core',
  severity: 'amber',
  source: 'hdl',
};

function receive(message: ConsistencyResultMessage) {
  const showToast = jest.fn();
  const { result } = renderHook(() => useConsistencySession({ showToast }));
  act(() => result.current.handleConsistencyResultMessage(message));
  return { revealRequest: result.current.findingsRevealRequest, showToast };
}

describe('useConsistencySession reveal request', () => {
  it('asks to reveal the findings of a manual check', () => {
    const { revealRequest, showToast } = receive({ findings: [finding] });
    expect(revealRequest).toBe(1);
    expect(showToast).not.toHaveBeenCalled();
  });

  it('only toasts a manual check that finds nothing', () => {
    const { revealRequest, showToast } = receive({ findings: [] });
    expect(revealRequest).toBe(0);
    expect(showToast).toHaveBeenCalledWith(
      'IPCraft: consistent with every checked implementation source.'
    );
  });

  it('only toasts a manual check that failed', () => {
    const { revealRequest, showToast } = receive({ error: 'no HDL found' });
    expect(revealRequest).toBe(0);
    expect(showToast).toHaveBeenCalledWith('Consistency check failed: no HDL found');
  });

  it('stays silent for a background check, even with findings', () => {
    const { revealRequest, showToast } = receive({ auto: true, findings: [finding] });
    expect(revealRequest).toBe(0);
    expect(showToast).not.toHaveBeenCalled();
  });
});
