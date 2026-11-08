import type { SystemGraph } from '../../domain/systemGraph';
import type { ExportImageOptions, SystemExportView } from './imageExport';

export type HighlightColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'magenta';

export type HighlightMap = Record<string, HighlightColor>;

export type SystemDiagramToWebviewMessage =
  | { type: 'graph'; graph: SystemGraph; highlights?: HighlightMap }
  | { type: 'notRecognized'; fileName: string }
  | { type: 'error'; message: string }
  /** The options of the last export in this workspace. */
  | { type: 'exportOptions'; options: ExportImageOptions }
  /** The Export Diagram as Image command: open the export popover. */
  | { type: 'openExport' };

export type SystemDiagramToExtensionMessage =
  | { type: 'ready' }
  | { type: 'revealSource'; line: number; uri?: string }
  | { type: 'openDefinition'; instance: string }
  | { type: 'setHighlights'; highlights: HighlightMap }
  | { type: 'exportImage'; options: ExportImageOptions; view: SystemExportView };
