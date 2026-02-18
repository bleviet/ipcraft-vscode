import { useEffect } from 'react';
import { vscode } from '../../vscode';

/**
 * Hook for syncing IP Core data with VS Code extension
 */
export function useIpCoreSync(rawYaml: string) {
  /**
   * Send update to extension
   */
  const sendUpdate = (yamlText: string) => {
    if (vscode) {
      vscode.postMessage({
        type: 'update',
        text: yamlText,
      });
    }
  };

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
    }, 500); // 500ms debounce

    return () => clearTimeout(timeoutId);
  }, [rawYaml]);

  return { sendUpdate };
}
