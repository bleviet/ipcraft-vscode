import type { SystemGraph } from '../../domain/systemGraph';

export type HighlightColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'magenta';

export type HighlightMap = Record<string, HighlightColor>;

export type SystemDiagramToWebviewMessage =
  | { type: 'graph'; graph: SystemGraph; highlights?: HighlightMap }
  | { type: 'notRecognized'; fileName: string }
  | { type: 'error'; message: string };

export type SystemDiagramToExtensionMessage =
  | { type: 'ready' }
  | { type: 'revealSource'; line: number; uri?: string }
  | { type: 'openDefinition'; instance: string }
  | { type: 'setHighlights'; highlights: HighlightMap };
