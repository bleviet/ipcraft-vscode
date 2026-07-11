import { useCallback, useEffect, useState } from 'react';

export type LiveRegisterStatus = 'idle' | 'reading' | 'value' | 'error';

export interface LiveRegisterState {
  status: LiveRegisterStatus;
  value?: number;
  error?: string;
  lastReadAt?: number;
}

interface VsCodeApi {
  postMessage: (message: Record<string, unknown>) => void;
}

interface LiveValuesMessage {
  type: string;
  values?: Record<string, number>;
  errors?: Record<string, string>;
}

/**
 * Listens for `liveValues` messages from the extension host and exposes
 * per-register read state, keyed by register name.
 *
 * Deliberately independent of revisionFilter.ts / useYamlSync: `liveValues`
 * is a distinct message `type` that the document-sync listener already
 * ignores (`message.type !== 'update'`), so a hardware read can never be
 * mistaken for a document change or perturb the revisioned sync protocol —
 * see WebviewRouter.postLiveValues, which never stamps `docVersion`.
 */
export function useLiveRegisterValues(vscode: VsCodeApi | undefined) {
  const [liveValues, setLiveValues] = useState<Record<string, LiveRegisterState>>({});

  useEffect(() => {
    const handleMessage = (event: MessageEvent<LiveValuesMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || message.type !== 'liveValues') {
        return;
      }
      setLiveValues((prev) => {
        const next = { ...prev };
        for (const [name, value] of Object.entries(message.values ?? {})) {
          next[name] = { status: 'value', value, lastReadAt: Date.now() };
        }
        for (const [name, error] of Object.entries(message.errors ?? {})) {
          next[name] = { status: 'error', error, lastReadAt: Date.now() };
        }
        return next;
      });
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const requestRead = useCallback(
    (name: string) => {
      setLiveValues((prev) => ({
        ...prev,
        [name]: { ...prev[name], status: 'reading' },
      }));
      vscode?.postMessage({ type: 'readRegister', name });
    },
    [vscode]
  );

  return { liveValues, requestRead };
}
