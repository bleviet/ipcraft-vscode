import { useCallback, useEffect, useState } from 'react';
import type {
  SystemDiagramToExtensionMessage,
  SystemDiagramToWebviewMessage,
} from '../../../shared/messages/systemDiagram';
import { vscode } from '../../vscode';
import { reduceDiagramMessage, type SystemDiagramState } from '../messageState';

function post(message: SystemDiagramToExtensionMessage): void {
  vscode?.postMessage(message);
}

export function useSystemDiagramMessages(): {
  state: SystemDiagramState;
  revealSource: (line: number) => void;
} {
  const [state, setState] = useState<SystemDiagramState>({ status: 'loading' });

  useEffect(() => {
    const onMessage = (event: MessageEvent<SystemDiagramToWebviewMessage>) => {
      const message = event.data;
      if (message?.type) {
        setState((state) => reduceDiagramMessage(state, message));
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const revealSource = useCallback((line: number) => post({ type: 'revealSource', line }), []);
  return { state, revealSource };
}
