import { renderHook, act } from '@testing-library/react';
import { useIpCoreBridge } from '../../../webview/ipcore/hooks/useIpCoreBridge';
import { vscode } from '../../../webview/vscode';
import type {
  IpCoreUpdateMessage,
  IpCoreStagingStartMessage,
  IpCoreStagingFileMergedMessage,
  IpCoreConsistencyResultMessage,
} from '../../../webview/ipcore/types/messages';

function dispatchMessage(data: unknown) {
  window.dispatchEvent(new MessageEvent('message', { data }));
}

function makeCallbacks() {
  return {
    onUpdate: jest.fn<void, [IpCoreUpdateMessage]>(),
    onStagingStart: jest.fn<void, [IpCoreStagingStartMessage]>(),
    onStagingFileMerged: jest.fn<void, [IpCoreStagingFileMergedMessage]>(),
    onConsistencyResult: jest.fn<void, [IpCoreConsistencyResultMessage]>(),
  };
}

describe('useIpCoreBridge', () => {
  beforeEach(() => {
    (vscode?.postMessage as jest.Mock | undefined)?.mockClear();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends a ready handshake on mount', () => {
    const callbacks = makeCallbacks();
    renderHook(() => useIpCoreBridge({ rawYaml: '', ...callbacks }));

    expect(vscode?.postMessage).toHaveBeenCalledWith({ type: 'ready' });
  });

  it('routes an accepted update message to onUpdate', () => {
    const callbacks = makeCallbacks();
    renderHook(() => useIpCoreBridge({ rawYaml: '', ...callbacks }));

    const message: IpCoreUpdateMessage = {
      type: 'update',
      text: 'a: 1\n',
      fileName: 'x.ip.yml',
      docVersion: 0,
    };
    act(() => dispatchMessage(message));

    expect(callbacks.onUpdate).toHaveBeenCalledWith(message);
  });

  it('drops a stale update (docVersion at or below the last seen version)', () => {
    const callbacks = makeCallbacks();
    renderHook(() => useIpCoreBridge({ rawYaml: '', ...callbacks }));

    act(() =>
      dispatchMessage({ type: 'update', text: 'a: 1\n', fileName: 'x.ip.yml', docVersion: 0 })
    );
    callbacks.onUpdate.mockClear();
    act(() =>
      dispatchMessage({ type: 'update', text: 'a: 2\n', fileName: 'x.ip.yml', docVersion: 0 })
    );

    expect(callbacks.onUpdate).not.toHaveBeenCalled();
  });

  it('drops an echo of the webview'.concat("'s own latest edit"), () => {
    const callbacks = makeCallbacks();
    const { result } = renderHook(() => useIpCoreBridge({ rawYaml: '', ...callbacks }));

    act(() => result.current.sendUpdate('a: 1\n'));

    act(() =>
      dispatchMessage({ type: 'update', text: 'a: 1\n', fileName: 'x.ip.yml', sourceEditId: 1 })
    );

    expect(callbacks.onUpdate).not.toHaveBeenCalled();
  });

  it('always applies a forceResync update even if it looks stale', () => {
    const callbacks = makeCallbacks();
    renderHook(() => useIpCoreBridge({ rawYaml: '', ...callbacks }));

    act(() =>
      dispatchMessage({ type: 'update', text: 'a: 1\n', fileName: 'x.ip.yml', docVersion: 5 })
    );
    callbacks.onUpdate.mockClear();

    const resync: IpCoreUpdateMessage = {
      type: 'update',
      text: 'a: 2\n',
      fileName: 'x.ip.yml',
      docVersion: 3,
      forceResync: true,
    };
    act(() => dispatchMessage(resync));

    expect(callbacks.onUpdate).toHaveBeenCalledWith(resync);
  });

  it('routes staging and consistency messages through without revision filtering', () => {
    const callbacks = makeCallbacks();
    renderHook(() => useIpCoreBridge({ rawYaml: '', ...callbacks }));

    const stagingStart: IpCoreStagingStartMessage = {
      type: 'stagingStart',
      files: [],
      rootLabel: 'x',
    };
    act(() => dispatchMessage(stagingStart));
    expect(callbacks.onStagingStart).toHaveBeenCalledWith(stagingStart);

    const stagingMerged: IpCoreStagingFileMergedMessage = {
      type: 'stagingFileMerged',
      relativePath: 'a.vhd',
    };
    act(() => dispatchMessage(stagingMerged));
    expect(callbacks.onStagingFileMerged).toHaveBeenCalledWith(stagingMerged);

    const consistencyResult: IpCoreConsistencyResultMessage = {
      type: 'consistencyResult',
      findings: [],
    };
    act(() => dispatchMessage(consistencyResult));
    expect(callbacks.onConsistencyResult).toHaveBeenCalledWith(consistencyResult);
  });

  it('debounces outbound updates when rawYaml changes', () => {
    const callbacks = makeCallbacks();
    const { rerender } = renderHook(({ rawYaml }) => useIpCoreBridge({ rawYaml, ...callbacks }), {
      initialProps: { rawYaml: 'a: 1\n' },
    });
    (vscode?.postMessage as jest.Mock | undefined)?.mockClear();

    rerender({ rawYaml: 'a: 2\n' });
    expect(vscode?.postMessage).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(150);
    });

    expect(vscode?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'update', text: 'a: 2\n' })
    );
  });

  it('flushes the current rawYaml on unmount', () => {
    const callbacks = makeCallbacks();
    const { unmount } = renderHook(() => useIpCoreBridge({ rawYaml: 'a: 1\n', ...callbacks }));
    (vscode?.postMessage as jest.Mock | undefined)?.mockClear();

    unmount();

    expect(vscode?.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'update', text: 'a: 1\n' })
    );
  });
});
