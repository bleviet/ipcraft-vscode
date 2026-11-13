import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  HighlightMap,
  SystemDiagramToExtensionMessage,
  SystemDiagramToWebviewMessage,
} from '../../../shared/messages/systemDiagram';
import type { ExportImageOptions, SystemExportView } from '../../../shared/messages/imageExport';
import { vscode } from '../../vscode';
import { reduceDiagramMessage, type SystemDiagramState } from '../messageState';
import type { ImageExportChannel } from './useDiagramExport';

function post(message: SystemDiagramToExtensionMessage): void {
  vscode?.postMessage(message);
}

export function useSystemDiagramMessages(): {
  state: SystemDiagramState;
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
  setHighlights: (highlights: HighlightMap) => void;
  imageExport: ImageExportChannel;
  startCompare: () => void;
  stopCompare: () => void;
} {
  const [state, setState] = useState<SystemDiagramState>({ status: 'loading' });

  const [savedExport, setSavedExport] = useState<ExportImageOptions>();
  const [openToken, setOpenToken] = useState(0);

  useEffect(() => {
    const onMessage = (event: MessageEvent<SystemDiagramToWebviewMessage>) => {
      const message = event.data;
      if (message?.type === 'exportOptions') {
        setSavedExport(message.options);
      } else if (message?.type === 'openExport') {
        setOpenToken((token) => token + 1);
      } else if (message?.type) {
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
  const startCompare = useCallback(() => post({ type: 'startCompare' }), []);
  const stopCompare = useCallback(() => post({ type: 'stopCompare' }), []);
  const imageExport = useMemo<ImageExportChannel>(
    () => ({
      saved: savedExport,
      openToken,
      send: (options: ExportImageOptions, view: SystemExportView) =>
        post({ type: 'exportImage', options, view }),
    }),
    [savedExport, openToken]
  );
  return {
    state,
    revealSource,
    openDefinition,
    setHighlights,
    imageExport,
    startCompare,
    stopCompare,
  };
}
