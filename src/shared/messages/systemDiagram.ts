import type { SystemGraph } from '../../domain/systemGraph';

export type SystemDiagramToWebviewMessage =
  | { type: 'graph'; graph: SystemGraph }
  | { type: 'notRecognized'; fileName: string }
  | { type: 'error'; message: string };

export type SystemDiagramToExtensionMessage =
  | { type: 'ready' }
  | { type: 'revealSource'; line: number; uri?: string }
  | { type: 'openDefinition'; instance: string };
