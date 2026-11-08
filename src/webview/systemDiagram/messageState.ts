import type { SystemGraph } from '../../domain/systemGraph';
import type {
  HighlightMap,
  SystemDiagramToWebviewMessage,
} from '../../shared/messages/systemDiagram';
import { pruneHighlights } from './highlights';

/** Why the latest document text could not be shown, while the last good graph stays up. */
export type DiagramProblem = { kind: 'error'; message: string } | { kind: 'notRecognized' };

export type SystemDiagramState =
  | { status: 'loading' }
  | { status: 'graph'; graph: SystemGraph; highlights?: HighlightMap; problem?: DiagramProblem }
  | { status: 'notRecognized'; fileName: string }
  | { status: 'error'; message: string };

/** The messages that change what the viewer shows; export messages leave the state alone. */
export type DiagramContentMessage = Exclude<
  SystemDiagramToWebviewMessage,
  { type: 'exportOptions' | 'openExport' }
>;

/**
 * Once a graph has been shown, a bad message only adds a problem to it so the
 * workbench (and everything the user set up in it) stays mounted; the next
 * graph replaces it and clears the problem.
 */
export function reduceDiagramMessage(
  state: SystemDiagramState,
  message: DiagramContentMessage
): SystemDiagramState {
  switch (message.type) {
    case 'graph': {
      const highlights =
        message.highlights !== undefined
          ? pruneHighlights(message.graph, message.highlights)
          : state.status === 'graph'
            ? pruneHighlights(message.graph, state.highlights)
            : {};
      return {
        status: 'graph',
        graph: message.graph,
        ...(Object.keys(highlights).length > 0 && { highlights }),
      };
    }
    case 'notRecognized':
      return state.status === 'graph'
        ? { ...state, problem: { kind: 'notRecognized' } }
        : { status: 'notRecognized', fileName: message.fileName };
    case 'error':
      return state.status === 'graph'
        ? { ...state, problem: { kind: 'error', message: message.message } }
        : { status: 'error', message: message.message };
  }
}
