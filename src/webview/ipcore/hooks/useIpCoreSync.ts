import { useCallback, useEffect, useRef } from 'react';
import { vscode } from '../../vscode';
import {
  createRevisionState,
  shouldApplyUpdate,
  buildUpdateMessage,
} from '../../sync/revisionFilter';

/**
 * Hook for syncing IP Core data with VS Code extension
 */
export function useIpCoreSync(rawYaml: string) {
  const revision = useRef(createRevisionState());

  /**
   * Send update to extension
   */
  const sendUpdate = useCallback((yamlText: string) => {
    if (vscode) {
      vscode.postMessage(buildUpdateMessage(revision.current, yamlText));
    }
  }, []);

  const rawYamlRef = useRef(rawYaml);
  rawYamlRef.current = rawYaml;
  const sendUpdateRef = useRef(sendUpdate);
  sendUpdateRef.current = sendUpdate;

  // Flush on visibility change
  useEffect(() => {
    const flushIfHidden = () => {
      if (document.visibilityState === 'hidden' && rawYamlRef.current) {
        sendUpdateRef.current(rawYamlRef.current);
      }
    };
    document.addEventListener('visibilitychange', flushIfHidden);
    return () => {
      document.removeEventListener('visibilitychange', flushIfHidden);
    };
  }, []);

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (rawYamlRef.current) {
        sendUpdateRef.current(rawYamlRef.current);
      }
    };
  }, []);

  /**
   * Auto-send updates when YAML changes
   * Debounced to avoid excessive messages
   */
  useEffect(() => {
    if (!rawYaml) {
      return;
    }

    const timeoutId = setTimeout(() => {
      sendUpdate(rawYaml);
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
  }, [rawYaml, sendUpdate]);

  // Intercept stale updates and self-echos in the capture phase, before the
  // app's `update` handler (which re-parses the YAML) sees them.
  useEffect(() => {
    const handleMessageCapture = (event: MessageEvent) => {
      const message = event.data as
        | { type?: unknown; docVersion?: unknown; sourceEditId?: unknown; forceResync?: unknown }
        | null
        | undefined;
      if (
        !message ||
        typeof message !== 'object' ||
        typeof message.type !== 'string' ||
        message.type !== 'update'
      ) {
        return;
      }

      const apply = shouldApplyUpdate(revision.current, {
        docVersion: typeof message.docVersion === 'number' ? message.docVersion : undefined,
        sourceEditId: typeof message.sourceEditId === 'number' ? message.sourceEditId : undefined,
        forceResync: message.forceResync === true,
      });

      if (!apply) {
        // Stale echo or echo of our own latest edit — stop it reaching the
        // app's update handler so the canvas does not re-parse.
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener('message', handleMessageCapture, true);
    return () => window.removeEventListener('message', handleMessageCapture, true);
  }, []);

  return { sendUpdate };
}
