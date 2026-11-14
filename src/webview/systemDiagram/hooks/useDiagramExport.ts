import { useCallback, useEffect, useState } from 'react';
import { useStoreApi } from '@xyflow/react';
import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportImageOptions,
  type SystemExportView,
} from '../../../shared/messages/imageExport';
import { buildSystemExportView, visibleNodeIds, type SystemExportState } from '../exportView';
import { isGhostNode, NO_GHOSTS, type Ghosts } from '../layout/unionGraph';
import type { DiagramLayout } from './useElkLayout';

/** The host side of Export image: the remembered options, the open request, and the send. */
export interface ImageExportChannel {
  /** The options of the last export in this workspace, once the host sent them. */
  saved?: ExportImageOptions;
  /** Rises when the Export Diagram as Image command asks to open the popover. */
  openToken: number;
  send: (options: ExportImageOptions, view: SystemExportView) => void;
}

/**
 * The state of the system viewer's Export image button. Exporting reads the viewport and sends the
 * state; it never changes the view. The image shows the open design, so the `ghosts` of a
 * comparison that are drawn on the canvas are not among the blocks in view. Must run inside a
 * React Flow provider.
 */
export function useDiagramExport(
  channel: ImageExportChannel | undefined,
  layout: DiagramLayout | null,
  state: SystemExportState,
  ghosts: Ghosts = NO_GHOSTS
) {
  const store = useStoreApi();
  const [options, setOptions] = useState<ExportImageOptions>(
    channel?.saved ?? DEFAULT_EXPORT_OPTIONS
  );
  const saved = channel?.saved;
  useEffect(() => {
    if (saved) {
      setOptions(saved);
    }
  }, [saved]);

  const send = channel?.send;
  const exportImage = useCallback(
    (chosen: ExportImageOptions) => {
      if (!send) {
        return;
      }
      const { transform, width, height } = store.getState();
      const visible =
        chosen.area === 'view' && layout?.levelPath === state.levelPath
          ? visibleNodeIds(
              layout.nodes.filter((node) => !isGhostNode(ghosts, node.id)),
              { transform, width, height }
            )
          : undefined;
      send(chosen, buildSystemExportView(state, visible));
    },
    [send, store, layout, state, ghosts]
  );
  return { options, setOptions, openToken: channel?.openToken ?? 0, exportImage };
}
