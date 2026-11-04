import type { SystemGraph } from '../../domain/systemGraph';
import type { SystemDiagramToWebviewMessage } from '../../shared/messages/systemDiagram';

/** Why the latest document text could not be shown, while the last good graph stays up. */
export type DiagramProblem =
  | { kind: 'error'; message: string }
  | { kind: 'notRecognized'; fileName: string };

export type SystemDiagramState =
  | { status: 'loading' }
  | { status: 'graph'; graph: SystemGraph; problem?: DiagramProblem }
  | { status: 'notRecognized'; fileName: string }
  | { status: 'error'; message: string };

/**
 * Once a graph has been shown, a bad message only adds a problem to it so the
 * workbench (and everything the user set up in it) stays mounted; the next
 * graph replaces it and clears the problem.
 */
export function reduceDiagramMessage(
  state: SystemDiagramState,
  message: SystemDiagramToWebviewMessage
): SystemDiagramState {
  switch (message.type) {
    case 'graph':
      return { status: 'graph', graph: message.graph };
    case 'notRecognized':
      return state.status === 'graph'
        ? { ...state, problem: { kind: 'notRecognized', fileName: message.fileName } }
        : { status: 'notRecognized', fileName: message.fileName };
    case 'error':
      return state.status === 'graph'
        ? { ...state, problem: { kind: 'error', message: message.message } }
        : { status: 'error', message: message.message };
  }
}
