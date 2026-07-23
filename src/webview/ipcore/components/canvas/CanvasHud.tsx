import React from 'react';
import type { IpCore } from '../../../types/ipCore';
import type { LayoutPort } from './canvasLayout';
import { CanvasSelectionActions } from './CanvasSelectionActions';
import type { BatchUpdate } from '../../hooks/useGroupPorts';
import type { SuggestionChip } from '../../hooks/useProtocolSuggestions';
import type { CanvasSearchMatches } from './IpBlockDiagram';

interface MarqueeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CanvasHudProps {
  ipCore: IpCore;
  ports: LayoutPort[];
  marqueeRect: MarqueeRect | null;
  hoveredId: string | null;
  showZoomIndicator: boolean;
  zoom: number;
  multiSelectedIds?: Set<string>;
  batchUpdate?: BatchUpdate;
  onDismissSelection?: () => void;
  onExitSelectMode: () => void;
  suggestionChips?: SuggestionChip[];
  onDismissSuggestion?: (chipId: string) => void;
  showSearch: boolean;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onCloseSearch: () => void;
  matchedIds: CanvasSearchMatches | null;
  searchInputRef: React.RefObject<HTMLInputElement>;
  showHelp: boolean;
  onToggleHelp: () => void;
}

/**
 * The HUD layer of the canvas: marquee rectangle, hover tooltip, zoom
 * indicator, multi-select toolbar, protocol suggestion chips, the port
 * search bar, and the keyboard-shortcut help popover. Sits outside the SVG
 * transform, pinned to the container viewport.
 */
export const CanvasHud: React.FC<CanvasHudProps> = ({
  ipCore,
  ports,
  marqueeRect,
  hoveredId,
  showZoomIndicator,
  zoom,
  multiSelectedIds,
  batchUpdate,
  onDismissSelection,
  onExitSelectMode,
  suggestionChips,
  onDismissSuggestion,
  showSearch,
  searchQuery,
  onSearchQueryChange,
  onCloseSearch,
  matchedIds,
  searchInputRef,
  showHelp,
  onToggleHelp,
}) => {
  return (
    <>
      {/* Marquee selection rectangle */}
      {marqueeRect && (
        <div
          className="ip-canvas-marquee"
          style={{
            left: marqueeRect.left,
            top: marqueeRect.top,
            width: marqueeRect.width,
            height: marqueeRect.height,
          }}
        />
      )}

      {/* Hover tooltip */}
      {hoveredId && <PortTooltip portId={hoveredId} ports={ports} />}

      {/* Zoom level indicator — fades after 1.5 s */}
      {showZoomIndicator && (
        <div className="ip-canvas-zoom-indicator">{Math.round(zoom * 100)}%</div>
      )}

      {/* HUD layer — sits outside the SVG transform, pinned to container viewport */}
      <div className="ip-canvas-hud">
        {/* Multi-select toolbar */}
        {multiSelectedIds && multiSelectedIds.size >= 1 && batchUpdate && onDismissSelection && (
          <CanvasSelectionActions
            multiSelection={{ all: buildMultiSelectionMap(multiSelectedIds), isMulti: true }}
            ipCore={ipCore}
            batchUpdate={batchUpdate}
            onDismiss={onExitSelectMode}
          />
        )}

        {/* Protocol suggestion chips */}
        {suggestionChips && suggestionChips.length > 0 && (
          <div className="ip-canvas-suggestion-chips">
            {suggestionChips.map((chip) => (
              <div key={chip.id} className="ip-canvas-suggestion-chip">
                <span>
                  {chip.label} detected ({Math.round(chip.score * 100)}%)
                </span>
                <button
                  className="ip-canvas-suggestion-chip__group-btn"
                  onClick={() => {
                    if (!batchUpdate || !onDismissSuggestion) {
                      return;
                    }
                    // Accept suggestion — dismisses chip; user can also use multi-select
                    onDismissSuggestion(chip.id);
                  }}
                >
                  Group ▸
                </button>
                <button
                  className="ip-canvas-suggestion-chip__dismiss-btn"
                  onClick={() => onDismissSuggestion?.(chip.id)}
                  aria-label={`Dismiss ${chip.label} suggestion`}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Port search bar */}
        {showSearch && (
          <div className="ip-canvas-search">
            <span className="ip-canvas-search__icon">⌕</span>
            <input
              ref={searchInputRef}
              className="ip-canvas-search__input"
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search ports..."
            />
            {matchedIds !== null && (
              <span className="ip-canvas-search__count">
                {matchedIds.portIds.size} match{matchedIds.portIds.size !== 1 ? 'es' : ''}
              </span>
            )}
            <button
              className="ip-canvas-search__close"
              onClick={onCloseSearch}
              aria-label="Close port search"
              title="Close search (Escape)"
            >
              ✕
            </button>
          </div>
        )}

        {/* Help button + shortcut popover */}
        <div className="ip-canvas-help">
          <button
            className="ip-canvas-help__btn"
            onClick={onToggleHelp}
            title="Keyboard shortcuts & tips"
          >
            ?
          </button>
          {showHelp && (
            <div className="ip-canvas-help__popover">
              <div className="ip-canvas-help__title">Canvas shortcuts</div>
              <table className="ip-canvas-help__table">
                <tbody>
                  <tr>
                    <td className="ip-canvas-help__key">Shift + Click port</td>
                    <td>Add port to multi-selection</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Shift + Click again</td>
                    <td>Remove port from selection</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Escape</td>
                    <td>Clear selection</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Ctrl + Wheel</td>
                    <td>Zoom in / out</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Wheel</td>
                    <td>Pan view</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Middle drag</td>
                    <td>Pan view</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Space + drag</td>
                    <td>Pan view</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Drag on background</td>
                    <td>Select ports in region</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Ctrl + 0</td>
                    <td>Reset zoom &amp; position</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Double-click canvas</td>
                    <td>Reset zoom &amp; position</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Right-click port / bus</td>
                    <td>Rename</td>
                  </tr>
                  <tr>
                    <td className="ip-canvas-help__key">Ctrl + F</td>
                    <td>Search ports</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

function buildMultiSelectionMap(
  ids: Set<string>
): Map<string, { kind: 'port' | 'interrupt'; index: number; id: string }> {
  const map = new Map<string, { kind: 'port' | 'interrupt'; index: number; id: string }>();
  for (const id of ids) {
    const parts = id.split(':');
    if (parts.length !== 2) {
      continue;
    }
    const [kindRaw, indexStr] = parts;
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      continue;
    }
    if (kindRaw === 'port' || kindRaw === 'interrupt') {
      map.set(id, { kind: kindRaw, index, id });
    }
  }
  return map;
}

interface PortTooltipProps {
  portId: string;
  ports: LayoutPort[];
}

const PortTooltip: React.FC<PortTooltipProps> = ({ portId, ports }) => {
  const port = ports.find((p) => p.id === portId);
  if (!port) {
    return null;
  }

  const details: string[] = [port.label];
  if (port.kind === 'bus' && port.protocol) {
    details.push(`Protocol: ${port.protocol}`);
    if (port.mode) {
      details.push(`Mode: ${port.mode}`);
    }
    const bus = port.data as { associatedClock?: string | null; associatedReset?: string | null };
    if (bus.associatedClock) {
      details.push(`Clock: ${bus.associatedClock}`);
    }
    if (bus.associatedReset) {
      details.push(`Reset: ${bus.associatedReset}`);
    }
  }
  if (port.widthLabel) {
    details.push(`Width: ${port.widthLabel}`);
  }
  if (port.kind === 'clock') {
    const clk = port.data as { frequency?: string | null };
    if (clk.frequency) {
      details.push(`Freq: ${clk.frequency}`);
    }
  }
  if (port.kind === 'reset') {
    const rst = port.data as { polarity?: string };
    if (rst.polarity) {
      details.push(`Polarity: ${rst.polarity}`);
    }
  }
  if (port.kind === 'interrupt') {
    const irq = port.data as { sensitivity?: string; direction?: string };
    details.push(`Direction: ${irq.direction ?? 'out'}`);
    if (irq.sensitivity) {
      details.push(`Sensitivity: ${irq.sensitivity}`);
    }
  }

  return (
    <div className="ip-canvas-tooltip">
      {details.map((line, i) => (
        <div key={i} className={i === 0 ? 'ip-canvas-tooltip__title' : 'ip-canvas-tooltip__detail'}>
          {line}
        </div>
      ))}
    </div>
  );
};
