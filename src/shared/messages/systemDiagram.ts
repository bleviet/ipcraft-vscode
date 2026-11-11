import type { SystemGraph } from '../../domain/systemGraph';
import type { ResourceReport, ResourceStage, ResourceVendor } from '../../domain/resourceUsage';
import type { FindingsDiff, SystemGraphDiff, UnionAdditions } from '../../domain/systemGraphDiff';
import type { ExportImageOptions, SystemExportView } from './imageExport';

export type HighlightColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'magenta';

export type HighlightMap = Record<string, HighlightColor>;

/**
 * Where the definitions of the blocks that a comparison used come from: the base revision for the
 * base and the workspace for the current side, the workspace for both, or none (not read: an
 * untrusted workspace, or an enrichment that failed).
 */
export type BaseDefinitions = 'revision' | 'workspace' | 'none';

/** A comparison of the open design (current) with another revision or file (base): the labels and the changes. */
export interface DiagramCompare {
  baseLabel: string;
  /** The workspace-relative path of the open design. */
  currentLabel: string;
  /** True when the base is a file, which can be opened as a diagram and compared the other way round. */
  canSwap: boolean;
  diff: SystemGraphDiff;
  /** The unconnected pins and the clock and reset crossings that differ, for the same two graphs as `diff`. */
  findings: FindingsDiff;
  baseDefinitions: BaseDefinitions;
  /** What only the base has (blocks, pins, ports, wires), drawn as ghosts; absent when there is none. */
  union?: UnionAdditions;
}

/** A report the user can show resource usage from: found near the design, or attached. */
export interface ResourceSourceOption {
  id: string;
  /** Short display, e.g. `Post-route (impl_1)`, `Per-IP OOC (4 of 5 IPs)`, `Fitter (spike.fit.rpt)`. */
  label: string;
  vendor: ResourceVendor;
  stage?: ResourceStage;
  origin: 'project' | 'attached';
  /** As written in the report header. */
  date?: string;
  /** Workspace-relative path; for an attached copy, the original file name. */
  fileName: string;
  usable: boolean;
  /** Why the report cannot be used; set when `usable` is false. */
  reason?: string;
  /** A Vivado checkpoint can be opened to write the report (or, for the OOC group, the missing ones). */
  extractable?: true;
  /** The per-IP OOC group: how many IPs have no report yet but a checkpoint to extract it from. */
  missing?: number;
}

/** The resource usage state of one diagram: the sources, the chosen one and its numbers. */
export interface DiagramResources {
  sources: ResourceSourceOption[];
  /** The id of the chosen source; absent when there is none. */
  selected?: string;
  /** The chosen source mapped onto the current graph; absent when it is refused or unreadable. */
  report?: ResourceReport;
  /** Workspace-relative folders discovery looked in. */
  searched: string[];
  notice?: {
    kind: 'refused' | 'rootMissing' | 'olderThanDesign' | 'reportDate';
    message: string;
  };
  /** The line that writes a hierarchical Vivado report, to add to a run or a CI script. */
  hierarchicalTcl: string;
  /** The id of the source a checkpoint extraction is running for. */
  extracting?: string;
  /** A second source mapped onto the same design, shown next to the chosen one in Details. */
  compare?: { id: string; report: ResourceReport };
}

export type SystemDiagramToWebviewMessage =
  /** `compare` is present while a comparison is on. */
  | { type: 'graph'; graph: SystemGraph; highlights?: HighlightMap; compare?: DiagramCompare }
  | { type: 'notRecognized'; fileName: string }
  | { type: 'error'; message: string }
  /** The options of the last export in this workspace. */
  | { type: 'exportOptions'; options: ExportImageOptions }
  /** The Export Diagram as Image command: open the export popover. */
  | { type: 'openExport' }
  /**
   * The resource sources and the numbers of the chosen one; follows a `graph` message. `show` is
   * set on the first message after the Attach Resource Report command: the webview turns
   * Resources on (the extension has loaded the reports, so it need not ask).
   */
  | { type: 'resources'; resources: DiagramResources; show?: true };

export type SystemDiagramToExtensionMessage =
  | { type: 'ready' }
  | { type: 'revealSource'; line: number; uri?: string }
  | { type: 'openDefinition'; instance: string }
  | { type: 'assignContainerTcl'; instance: string }
  | { type: 'setHighlights'; highlights: HighlightMap }
  | { type: 'exportImage'; options: ExportImageOptions; view: SystemExportView }
  /** Pick a revision or file to compare the open design with. */
  | { type: 'startCompare' }
  | { type: 'stopCompare' }
  /** Open the base file as a diagram and compare it with this document. */
  | { type: 'swapCompare' }
  /** Resources was turned on for the first time: find the reports. */
  | { type: 'loadResources' }
  | { type: 'selectResourceSource'; id: string }
  /** Pick report files to attach. */
  | { type: 'attachResourceReport' }
  /** Pick a folder to look for reports in. */
  | { type: 'chooseResourceFolder' }
  | { type: 'removeResourceSource'; id: string }
  /** Open the checkpoint of this source in Vivado and write its report. */
  | { type: 'extractResources'; id: string }
  /** Show another source next to the chosen one; no `id` clears it. */
  | { type: 'compareResourceSource'; id?: string }
  /** Which report path is the design, when several rows could be. */
  | { type: 'chooseResourceRoot'; root: string };
