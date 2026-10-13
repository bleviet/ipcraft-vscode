import React, { createContext, useContext, useEffect, useState } from 'react';
import type { VersionContext } from '../../shared/versioning/versionContext';

const DEFAULT_VALUE: VersionContext = { status: 'none' };

const VersionContextContext = createContext<VersionContext>(DEFAULT_VALUE);

function isVersionContextMessage(
  data: unknown
): data is { type: 'versionContext'; context: VersionContext } {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'versionContext' &&
    typeof (data as { context?: unknown }).context === 'object' &&
    (data as { context?: unknown }).context !== null
  );
}

/**
 * Holds the version context the extension host resolves for the open memory map (its owning IP
 * core's version scheme and version). The host sends it as a `versionContext` notification.
 */
export function VersionContextProvider({ children }: { children: React.ReactNode }) {
  const [context, setContext] = useState<VersionContext>(DEFAULT_VALUE);

  useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (isVersionContextMessage(event.data)) {
        setContext(event.data.context);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  return (
    <VersionContextContext.Provider value={context}>{children}</VersionContextContext.Provider>
  );
}

/** Falls back to `{ status: 'none' }` when rendered outside a provider (e.g. in unit tests). */
export function useVersionContext(): VersionContext {
  return useContext(VersionContextContext);
}
