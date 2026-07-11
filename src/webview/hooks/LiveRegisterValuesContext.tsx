import React, { createContext, useContext } from 'react';
import { useLiveRegisterValues, type LiveRegisterState } from './useLiveRegisterValues';
import { vscode } from '../vscode';

interface LiveRegisterValuesContextValue {
  liveValues: Record<string, LiveRegisterState>;
  requestRead: (name: string) => void;
}

const DEFAULT_VALUE: LiveRegisterValuesContextValue = {
  liveValues: {},
  requestRead: () => undefined,
};

const LiveRegisterValuesContext = createContext<LiveRegisterValuesContextValue>(DEFAULT_VALUE);

/**
 * Document-wide store of live hardware register values, sourced from the
 * `liveValues` message the extension host sends after a `readRegister`
 * request (see WebviewRouter.postLiveValues / LiveRegisterSession). One
 * instance for the whole webview so any editor at any level (register,
 * block, memory map) can eventually badge the same live state.
 */
export function LiveRegisterValuesProvider({ children }: { children: React.ReactNode }) {
  const value = useLiveRegisterValues(vscode);
  return (
    <LiveRegisterValuesContext.Provider value={value}>
      {children}
    </LiveRegisterValuesContext.Provider>
  );
}

/** Falls back to an empty, no-op store when rendered outside a provider (e.g. in unit tests). */
export function useLiveRegisterValuesContext(): LiveRegisterValuesContextValue {
  return useContext(LiveRegisterValuesContext);
}
