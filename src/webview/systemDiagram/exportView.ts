/** The view state the Export image message carries: pure, so the hook only gathers its inputs. */

import type { SystemExportView } from '../../shared/messages/imageExport';
import { nodeBounds } from './layout/diagramBounds';
import type { DiagramFlowNode } from './layout/elkLayout';

/** React Flow's pan and zoom (`transform`) and the canvas size in screen pixels. */
export interface CanvasViewport {
  transform: readonly [number, number, number];
  width: number;
  height: number;
}

/**
 * The nodes whose box (with its net badges) overlaps the canvas viewport. Frames of expanded
 * blocks count only when no other node is in view, so a crop follows the blocks on screen and
 * not the whole frame they sit in. Computed from positions: with `onlyRenderVisibleElements`
 * the mounted nodes are not a reliable list.
 */
export function visibleNodeIds(
  nodes: readonly DiagramFlowNode[],
  { transform: [tx, ty, zoom], width, height }: CanvasViewport
): string[] {
  const left = -tx / zoom;
  const top = -ty / zoom;
  const right = (width - tx) / zoom;
  const bottom = (height - ty) / zoom;
  const inView = nodes.filter((node) => {
    const box = nodeBounds(node);
    return box.x < right && box.x + box.width > left && box.y < bottom && box.y + box.height > top;
  });
  const blocks = inView.filter((node) => node.type !== 'frame');
  return (blocks.length > 0 ? blocks : inView).map((node) => node.id);
}

export interface SystemExportState {
  levelPath: string;
  expanded: ReadonlySet<string>;
  /** The isolated view; null when the whole level is shown. */
  isolation: { seedIds: readonly string[]; hops: number } | null;
  clocksOn: boolean;
  selectedNodeIds: readonly string[];
  /** A comparison is on and Marks is pressed. */
  marksOn: boolean;
  /** Version only is off: the marks leave out the blocks whose only change is the version. */
  ignoreVersionOnly?: boolean;
  /** The ghosts of what only the base has are drawn on the canvas (Marks and Show removed are on, and there are some). */
  ghostsOn?: boolean;
  /** The comparison has ghosts, so the layout is the union's even while they are hidden. */
  unionLayout?: boolean;
}

/** The message payload for the viewer's state; `visible` is set for the Current view area. */
export function buildSystemExportView(
  state: SystemExportState,
  visible?: readonly string[]
): SystemExportView {
  return {
    levelPath: state.levelPath,
    expanded: [...state.expanded],
    ...(state.isolation && {
      isolate: { nodeIds: [...state.isolation.seedIds], hops: state.isolation.hops },
    }),
    clocks: state.clocksOn,
    ...(state.unionLayout && { unionLayout: true }),
    selectedNodeIds: [...state.selectedNodeIds],
    ...(state.marksOn && {
      marks: true,
      ...(state.ignoreVersionOnly && { ignoreVersionOnly: true }),
      ...(state.ghostsOn && { ghosts: true }),
    }),
    ...(visible && { visibleNodeIds: [...visible] }),
  };
}
