import { useCallback, useEffect, useState } from 'react';
import type { SystemGraph } from '../../../domain/systemGraph';
import type {
  SystemDiagramToExtensionMessage,
  SystemDiagramToWebviewMessage,
} from '../../../shared/messages/systemDiagram';
import { vscode } from '../../vscode';

export type SystemDiagramState =
  | { status: 'loading' }
  | { status: 'graph'; graph: SystemGraph }
  | { status: 'notRecognized'; fileName: string }
  | { status: 'error'; message: string };

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
      switch (message?.type) {
        case 'graph':
          setState({ status: 'graph', graph: message.graph });
          break;
        case 'notRecognized':
          setState({ status: 'notRecognized', fileName: message.fileName });
          break;
        case 'error':
          setState({ status: 'error', message: message.message });
          break;
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'ready' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const revealSource = useCallback((line: number) => post({ type: 'revealSource', line }), []);
  return { state, revealSource };
}
