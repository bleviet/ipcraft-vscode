/** Node and edge shapes handed from the ELK layout to the React Flow components. */

import type {
  NetCategory,
  PinDirection,
  PinDirectionSource,
  SystemInstance,
  SystemPin,
} from '../../../domain/systemGraph';
import type { PinHoverTarget } from '../model';
import type { NodeReview } from '../unconnectedPins';
import type { NetBadge } from './netBadges';

export type PinSide = 'west' | 'east';

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
  /** Present when the pin's clock or reset net is hidden. */
  badge?: NetBadge;
  interfaceType?: string;
  signalType?: SystemPin['signalType'];
  /** Display text: `name`, or its middle-ellipsized form when the column is too narrow. */
  label: string;
  /** No net touches the pin (a clock or reset net hidden behind a badge still counts). */
  unconnected: boolean;
}

/** Display state the canvas adds to the nodes of a hierarchy-capable block (instance or frame). */
export interface InstanceUiData {
  /** Pins on the selected net; their labels are drawn bold. */
  highlightedPins?: ReadonlySet<string>;
  dimmed?: boolean;
  /** Present only while the unconnected-pin review is on. */
  review?: NodeReview;
  /** Name of the pin whose marker gets the focus halo. */
  focusedPin?: string;
  /** Set on the node being pulsed after a search step; a new value restarts the pulse. */
  flashToken?: number;
  onFlashEnd?: (token: number) => void;
  onSelectNet?: (netId: string) => void;
  onHoverPin?: (target: PinHoverTarget | null, anchor?: DOMRect) => void;
  /** Expands or collapses the hierarchy block `instancePath` in place. */
  onToggleExpand?: (instancePath: string) => void;
}

export interface InstanceNodeData extends Record<string, unknown>, InstanceUiData {
  instance: SystemInstance;
  cellCount: number;
  width: number;
  westWidth: number;
  eastWidth: number;
  west: PinRow[];
  east: PinRow[];
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
  /** Present only while the unconnected-pin review is on. */
  review?: NodeReview;
  /** Name of the pin when its marker gets the focus halo. */
  focusedPin?: string;
  onSelectNet?: (netId: string) => void;
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

export interface ElkEdgeData extends Record<string, unknown> {
  points: { x: number; y: number }[];
  netId: string;
  category: NetCategory;
  isInterface: boolean;
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
