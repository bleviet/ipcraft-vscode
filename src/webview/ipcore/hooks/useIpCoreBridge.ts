import { useCallback, useEffect, useRef } from 'react';
import { vscode } from '../../vscode';
import {
  createRevisionState,
  shouldApplyUpdate,
  buildUpdateMessage,
} from '../../sync/revisionFilter';
import type {
  ExtensionToWebviewMessage,
  IpCoreUpdateMessage,
  IpCoreStagingStartMessage,
  IpCoreStagingFileMergedMessage,
  IpCoreConsistencyResultMessage,
} from '../types/messages';

interface UseIpCoreBridgeOptions {
  rawYaml: string;
  onUpdate: (message: IpCoreUpdateMessage) => void;
  onStagingStart: (message: IpCoreStagingStartMessage) => void;
  onStagingFileMerged: (message: IpCoreStagingFileMergedMessage) => void;
  onConsistencyResult: (message: IpCoreConsistencyResultMessage) => void;
}

/**
 * The single boundary between the IP Core webview and the extension host.
 *
 * Replaces the previously split listeners — `useIpCoreSync`'s capture-phase
 * revision filter and `IpCoreApp`'s separate bubble-phase `message` handler —
 * with one `window.addEventListener('message', ...)` registration. Merging
 * them removes an ordering hazard: with two listeners on the same target,
 * `message` events (which target `window` directly, with no ancestor chain)
 * fire in registration order regardless of the `capture` flag, so correctness
 * depended on `useIpCoreSync` being mounted first. A single listener has no
 * such hazard.
 *
 * Preserves the exact revisioned sync protocol (V-3/V-4): only `update`
 * messages are subject to `shouldApplyUpdate`'s stale/self-echo/forceResync
 * check; staging and consistency messages pass straight through, matching
 * prior behavior. Do not change this filtering without also reviewing
 * `WebviewRouter` and `revisionFilter.ts`.
 */
export function useIpCoreBridge({
  rawYaml,
  onUpdate,
  onStagingStart,
  onStagingFileMerged,
  onConsistencyResult,
}: UseIpCoreBridgeOptions): { sendUpdate: (yamlText: string) => void } {
  const revision = useRef(createRevisionState());

  const sendUpdate = useCallback((yamlText: string) => {
    if (vscode) {
      vscode.postMessage(buildUpdateMessage(revision.current, yamlText));
    }
  }, []);

  const rawYamlRef = useRef(rawYaml);
  rawYamlRef.current = rawYaml;
  const sendUpdateRef = useRef(sendUpdate);
  sendUpdateRef.current = sendUpdate;

  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;
  const onStagingStartRef = useRef(onStagingStart);
  onStagingStartRef.current = onStagingStart;
  const onStagingFileMergedRef = useRef(onStagingFileMerged);
  onStagingFileMergedRef.current = onStagingFileMerged;
  const onConsistencyResultRef = useRef(onConsistencyResult);
  onConsistencyResultRef.current = onConsistencyResult;

  // Notify the extension that the webview is ready to receive the initial document.
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({ type: 'ready' });
    }
  }, []);

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

  // Auto-send updates when YAML changes, debounced to avoid excessive messages.
  useEffect(() => {
    if (!rawYaml) {
      return;
    }

    const timeoutId = setTimeout(() => {
      sendUpdate(rawYaml);
    }, 150); // 150ms debounce

    return () => clearTimeout(timeoutId);
  }, [rawYaml, sendUpdate]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data as ExtensionToWebviewMessage | null | undefined;
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
        return;
      }

      if (message.type === 'update') {
        const apply = shouldApplyUpdate(revision.current, {
          docVersion: typeof message.docVersion === 'number' ? message.docVersion : undefined,
          sourceEditId: typeof message.sourceEditId === 'number' ? message.sourceEditId : undefined,
          forceResync: message.forceResync === true,
        });
        if (!apply) {
          // Stale echo or echo of our own latest edit — drop it before it reaches
          // the app's update handler so the canvas does not re-parse.
          return;
        }
        onUpdateRef.current(message);
        return;
      }

      switch (message.type) {
        case 'stagingStart':
          onStagingStartRef.current(message);
          break;
        case 'stagingFileMerged':
          onStagingFileMergedRef.current(message);
          break;
        case 'consistencyResult':
          onConsistencyResultRef.current(message);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return { sendUpdate };
}
