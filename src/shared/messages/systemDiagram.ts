import type { SystemGraph } from '../../domain/systemGraph';
import type { SystemGraphDiff } from '../../domain/systemGraphDiff';
import type { ExportImageOptions, SystemExportView } from './imageExport';

export type HighlightColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'magenta';

export type HighlightMap = Record<string, HighlightColor>;

/** A comparison of the open design with another revision or file: its label and the changes. */
export interface DiagramCompare {
  baseLabel: string;
  diff: SystemGraphDiff;
}

export type SystemDiagramToWebviewMessage =
  /** `compare` is present while a comparison is on. */
  | { type: 'graph'; graph: SystemGraph; highlights?: HighlightMap; compare?: DiagramCompare }
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
  | { type: 'exportImage'; options: ExportImageOptions; view: SystemExportView }
  /** Pick a revision or file to compare the open design with. */
  | { type: 'startCompare' }
  | { type: 'stopCompare' };
