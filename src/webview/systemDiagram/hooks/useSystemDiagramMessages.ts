import { useCallback, useEffect, useState } from 'react';
import type {
  HighlightMap,
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
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
  setHighlights: (highlights: HighlightMap) => void;
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

  const revealSource = useCallback(
    (line: number, uri?: string) => post({ type: 'revealSource', line, uri }),
    []
  );
  const openDefinition = useCallback(
    (instance: string) => post({ type: 'openDefinition', instance }),
    []
  );
  const setHighlights = useCallback((highlights: HighlightMap) => {
    setState((state) => (state.status === 'graph' ? { ...state, highlights } : state));
    post({ type: 'setHighlights', highlights });
  }, []);
  return { state, revealSource, openDefinition, setHighlights };
}
