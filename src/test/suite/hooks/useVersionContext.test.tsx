import React from 'react';
import { act, render, renderHook } from '@testing-library/react';
import {
  useVersionContext,
  VersionContextProvider,
} from '../../../webview/hooks/useVersionContext';
import type { VersionContext } from '../../../shared/versioning/versionContext';

const resolved: VersionContext = {
  status: 'resolved',
  versionScheme: 'major.minor',
  version: '1.2',
  ipCorePath: 'ip/a.ip.yml',
};

const post = (data: unknown): void => {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
};

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <VersionContextProvider>{children}</VersionContextProvider>
);

describe('useVersionContext', () => {
  it('defaults to none outside a provider', () => {
    const { result } = renderHook(() => useVersionContext());
    expect(result.current).toEqual({ status: 'none' });
  });

  it('starts as none inside a provider', () => {
    const { result } = renderHook(() => useVersionContext(), { wrapper });
    expect(result.current).toEqual({ status: 'none' });
  });

  it('stores the latest versionContext message', () => {
    const { result } = renderHook(() => useVersionContext(), { wrapper });
    post({ type: 'versionContext', context: resolved });
    expect(result.current).toEqual(resolved);

    const ambiguous: VersionContext = { status: 'ambiguous', candidates: ['a.ip.yml', 'b.ip.yml'] };
    post({ type: 'versionContext', context: ambiguous });
    expect(result.current).toEqual(ambiguous);
  });

  it('ignores other message types and malformed payloads', () => {
    const { result } = renderHook(() => useVersionContext(), { wrapper });
    post({ type: 'versionContext', context: resolved });
    post({ type: 'update', text: 'x', context: { status: 'none' } });
    post({ type: 'versionContext' });
    post({ type: 'versionContext', context: null });
    post('versionContext');
    post(null);
    expect(result.current).toEqual(resolved);
  });

  it('removes its listener on unmount', () => {
    const remove = jest.spyOn(window, 'removeEventListener');
    const { unmount } = render(<VersionContextProvider>{null}</VersionContextProvider>);
    unmount();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
  });
});
