import { useState, useEffect } from 'react';
import { vscode } from '../vscode';
import type { HostMessage } from './types';

// Sends template source to the extension host for rendering (avoids unsafe-eval in webview CSP).
// The host renders via TemplateLoader.renderString() and posts back a previewResult message.
export function useTemplatePreview(source: string): { preview: string; error: string | null } {
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Debounced send
  useEffect(() => {
    if (!source) {
      setPreview('');
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      vscode?.postMessage({ type: 'renderPreview', source });
    }, 250);
    return () => clearTimeout(timer);
  }, [source]);

  // Receive result
  useEffect(() => {
    const handler = (event: MessageEvent<HostMessage>): void => {
      const msg = event.data;
      if (msg?.type === 'previewResult') {
        setPreview(msg.preview ?? '');
        setError(msg.error ?? null);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return { preview, error };
}
