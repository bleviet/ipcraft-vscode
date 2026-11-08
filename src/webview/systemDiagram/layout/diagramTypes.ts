/** Node and edge shapes handed from the ELK layout to the React Flow components. */

import type {
  NetCategory,
  PinDirection,
  PinDirectionSource,
  SystemInstance,
  SystemPin,
} from '../../../domain/systemGraph';
import type { BundleMember } from './edgeBundling';
import type { NodeDomains } from '../clocks/domainView';
import type { EdgeMarks } from '../clocks/edgeView';
import type { PinMarks } from '../clocks/nodeView';
import type { PinHoverTarget } from '../model';
import type { NodeReview } from '../unconnectedPins';
import type { NetBadge } from './netBadges';

export type PinSide = 'west' | 'east';

/** The nodes and edges (by id) an isolated view keeps. */
export interface IsolationSubset {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  /** Present on a traced path: its node ids from start to end, laid out left to right. */
  order?: readonly string[];
}

export interface PinRow {
  name: string;
  isInterface: boolean;
  side: PinSide;
  direction: PinDirection;
  directionSource: PinDirectionSource;
  category?: NetCategory;
  netName?: string;
  /** Every net the pin sits on, in graph order. */
  netNames: string[];
  definedBy?: SystemPin['definedBy'];
  /** Present on a pin of a clock or reset net; drawn in place of the wires of those nets. */
  badge?: NetBadge;
  interfaceType?: string;
  signalType?: SystemPin['signalType'];
  /** Display text: `name`, or its middle-ellipsized form when the column is too narrow. */
  label: string;
  /** No net touches the pin (a clock or reset net hidden behind a badge still counts). */
  unconnected: boolean;
  /** Present on the row of a numbered pin array: the folded row, or the header of an open one. */
  group?: PinGroupRow;
}

/** What a group row stands for; `id` is its row name, port name and handle id. */
export interface PinGroupRow {
  id: string;
  /** The whole label, e.g. `M00..M27_AXI [28]`; `PinRow.label` may be its ellipsized form. */
  label: string;
  open: boolean;
  members: PinRow[];
}

/** Display state the canvas adds to the nodes of a hierarchy-capable block (instance or frame). */
export interface InstanceUiData {
  /** Pins on the selected net; their labels are drawn bold. */
  highlightedPins?: ReadonlySet<string>;
  dimmed?: boolean;
  /** Present only while the unconnected-pin review is on. */
  review?: NodeReview;
  /** Present only while the domain decorations are on (Clocks and resets on, review off). */
  domains?: NodeDomains;
  /** Pin marks by pin name (domain colors, frequency labels, crossing ends). */
  pinMarks?: PinMarks;
  /** Nets of the selected clock or reset tree; badges on these nets are drawn selected. */
  selectedNetIds?: ReadonlySet<string>;
  /** Name of the pin whose marker gets the focus halo. */
  focusedPin?: string;
  /** 1-based position on the traced path, shown as a badge; present only while a trace is shown. */
  hopIndex?: number;
  /** Set on the node being pulsed after a search step; a new value restarts the pulse. */
  flashToken?: number;
  onFlashEnd?: (token: number) => void;
  /** User-assigned highlight color CSS value, when highlights are active on the canvas. */
  highlightColor?: string;
  onSelectNet?: (netId: string, additive?: boolean) => void;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
  /** Expands or collapses the hierarchy block `instancePath` in place. */
  onToggleExpand?: (instancePath: string) => void;
  /** Folds or expands the numbered pin array `groupId` of the block `instancePath`. */
  onTogglePinGroup?: (instancePath: string, groupId: string) => void;
}

export interface ArchPill {
  category: NetCategory;
  count: number;
  /** `28× AXI` */
  label: string;
}

/** What a card shows besides its header. */
export interface ArchSummary {
  /** At most three, most connected pins first. */
  pills: ArchPill[];
  /** Categories beyond the shown pills (`+N`). */
  more: number;
  /** `a → b → c +2`; absent for a block without inner instances. */
  preview?: string;
}

export interface InstanceNodeData extends Record<string, unknown>, InstanceUiData {
  instance: SystemInstance;
  cellCount: number;
  width: number;
  westWidth: number;
  eastWidth: number;
  west: PinRow[];
  east: PinRow[];
  /** Present on an Arch card: it has no pin rows (`west` and `east` are empty). */
  arch?: ArchSummary;
}

/** Pin row of an expanded block; `y` is the pin centre below the frame top. */
export type FramePinRow = PinRow & { y: number };

/** An expanded hierarchy block: a frame around its inner level, its pins on the border. */
export interface FrameNodeData extends Record<string, unknown>, InstanceUiData {
  instance: SystemInstance;
  cellCount: number;
  west: FramePinRow[];
  east: FramePinRow[];
}

export interface BoundaryNodeData extends Record<string, unknown> {
  pin: SystemPin;
  width: number;
  label: string;
  side: PinSide;
  category?: NetCategory;
  netName?: string;
  netNames: string[];
  badge?: NetBadge;
  dimmed?: boolean;
  /** 1-based position on the traced path, shown as a badge; present only while a trace is shown. */
  hopIndex?: number;
  /** Present only while the unconnected-pin review is on. */
  review?: NodeReview;
  /** Pin marks by pin name (domain colors, frequency labels, crossing ends). */
  pinMarks?: PinMarks;
  /** Nets of the selected clock or reset tree; the badge is drawn selected when it holds one. */
  selectedNetIds?: ReadonlySet<string>;
  /** Name of the pin when its marker gets the focus halo. */
  focusedPin?: string;
  /** User-assigned highlight color CSS value, when highlights are active on the canvas. */
  highlightColor?: string;
  onSelectNet?: (netId: string, additive?: boolean) => void;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
}

interface FlowNodeBase {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  draggable: false;
  /** Stacking order; a frame sits below the nodes and wires it contains. */
  zIndex?: number;
}

export type DiagramFlowNode =
  | (FlowNodeBase & { type: 'instance'; data: InstanceNodeData })
  | (FlowNodeBase & { type: 'boundary'; data: BoundaryNodeData })
  | (FlowNodeBase & { type: 'frame'; data: FrameNodeData });

/** What a bundled edge stands for: its member connections and the comb branches joining them to the trunk. */
export interface EdgeBundle {
  /** Also the edge id; the key of the Unbundle gesture. */
  key: string;
  /** Badge text, e.g. `×12 AXI`. */
  label: string;
  members: BundleMember[];
  /** Absolute polylines, one per member pin that is not on the trunk. */
  branches: { x: number; y: number }[][];
}

export interface ElkEdgeData extends Record<string, unknown>, EdgeMarks {
  points: { x: number; y: number }[];
  netId: string;
  category: NetCategory;
  isInterface: boolean;
  /** Present on a bundled edge: `netId` is then its first member's net; see `edgeNetIds`. */
  bundle?: EdgeBundle;
  /** User-assigned highlight color CSS value, when highlights are active on the canvas. */
  highlightColor?: string;
}

export interface DiagramFlowEdge {
  id: string;
  type: 'elk';
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  data: ElkEdgeData;
}
