import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

interface DebugModeContextValue {
  debugMode: boolean;
  toggleDebugMode: () => void;
}

const DEFAULT_VALUE: DebugModeContextValue = {
  debugMode: false,
  toggleDebugMode: () => undefined,
};

const DebugModeContext = createContext<DebugModeContextValue>(DEFAULT_VALUE);

/**
 * Provides a single document-wide "Debug Mode" flag: while on, register
 * value exploration (bit clicks / typed values in the bit-field visualizer
 * and fields table) stays local to the webview and is never written back to
 * the .mm.yml file. See https://github.com/bleviet/ipcraft-vscode/issues/39.
 */
export function DebugModeProvider({ children }: { children: React.ReactNode }) {
  const [debugMode, setDebugMode] = useState(false);
  const toggleDebugMode = useCallback(() => setDebugMode((prev) => !prev), []);
  const value = useMemo(() => ({ debugMode, toggleDebugMode }), [debugMode, toggleDebugMode]);

  return <DebugModeContext.Provider value={value}>{children}</DebugModeContext.Provider>;
}

/** Falls back to `{ debugMode: false }` when rendered outside a provider (e.g. in unit tests). */
export function useDebugMode(): DebugModeContextValue {
  return useContext(DebugModeContext);
}
