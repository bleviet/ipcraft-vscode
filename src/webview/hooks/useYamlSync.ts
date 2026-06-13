import { useCallback, useEffect, useRef } from 'react';
import { createRevisionState, shouldApplyUpdate, buildUpdateMessage } from '../sync/revisionFilter';

const SEND_DEBOUNCE_MS = 50;

/**
 * VSCode API wrapper type
 */
interface VsCodeApi {
  postMessage: (message: Record<string, unknown>) => void;
}

/**
 * Message from the extension host
 */
interface ExtensionMessage {
  type: string;
  text?: string;
  fileName?: string;
  [key: string]: unknown;
}

/**
 * Hook for synchronizing with VSCode extension via message passing
 */
export function useYamlSync(
  vscode: VsCodeApi | undefined,
  onUpdate: (text: string, fileName?: string) => void
) {
  const revision = useRef(createRevisionState());
  const pendingText = useRef<string | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Flush any pending debounced send on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        if (pendingText.current !== null && vscode) {
          vscode.postMessage(buildUpdateMessage(revision.current, pendingText.current));
          pendingText.current = null;
        }
      }
    };
  }, [vscode]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<ExtensionMessage>) => {
      const message = event.data;
      if (!message || typeof message !== 'object' || message.type !== 'update') {
        return;
      }

      const apply = shouldApplyUpdate(revision.current, {
        docVersion: message.docVersion as number | undefined,
        sourceEditId: message.sourceEditId as number | undefined,
        forceResync: message.forceResync === true,
      });

      if (apply && message.text !== undefined) {
        onUpdateRef.current(message.text, message.fileName);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []); // Run only once

  /**
   * Send updated YAML text to the extension, debounced to coalesce rapid edits.
   * Multiple in-flight edits trigger false stale-base rejections; debouncing
   * ensures only the latest edit is in-flight at any time.
   */
  const sendUpdate = useCallback(
    (text: string) => {
      pendingText.current = text;
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }
      debounceTimer.current = setTimeout(() => {
        debounceTimer.current = null;
        const t = pendingText.current;
        pendingText.current = null;
        if (t !== null && vscode) {
          vscode.postMessage(buildUpdateMessage(revision.current, t));
        }
      }, SEND_DEBOUNCE_MS);
    },
    [vscode]
  );

  /**
   * Send a command to the extension
   */
  const sendCommand = useCallback(
    (command: string, payload?: Record<string, unknown>) => {
      vscode?.postMessage({ type: 'command', command, ...payload });
    },
    [vscode]
  );

  return {
    sendUpdate,
    sendCommand,
  };
}
