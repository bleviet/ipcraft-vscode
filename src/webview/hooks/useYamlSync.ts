import { useCallback, useEffect, useRef } from 'react';
import { createRevisionState, shouldApplyUpdate, buildUpdateMessage } from '../sync/revisionFilter';

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

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

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
   * Send updated YAML text to the extension
   */
  const sendUpdate = useCallback(
    (text: string) => {
      vscode?.postMessage(buildUpdateMessage(revision.current, text));
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
