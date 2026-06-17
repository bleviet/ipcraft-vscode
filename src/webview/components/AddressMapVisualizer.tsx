import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { calculateBlockSize } from '../utils/blockSize';

export interface VisualizerAddressBlock {
  name?: string;
  baseAddress?: number | string;
  base_address?: number | string;
  offset?: number | string;
  size?: number | string;
  range?: number | string;
  usage?: string;
  registers?: Array<{
    __kind?: string;
    count?: number | string;
    stride?: number | string;
  }>;
}

interface AddressMapVisualizerProps {
  blocks: VisualizerAddressBlock[];
  hoveredBlockIndex?: number | null;
  setHoveredBlockIndex?: (idx: number | null) => void;
  onBlockClick?: (blockIndex: number) => void;
  onInsertAtGap?: (gapIndex: number) => void;
  onDeleteBlock?: (idx: number) => void;
  layout?: 'horizontal' | 'vertical';
}

function getBlockColor(idx: number) {
  return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  if (bytes < 1048576) {
    const kb = bytes / 1024;
    return `${Number.isInteger(kb) ? kb : kb.toFixed(1)}KB`;
  }
  const mb = bytes / 1048576;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

// ---------------------------------------------------------------------------
// Segment types
// ---------------------------------------------------------------------------

interface BlockSegment {
  type: 'block';
  idx: number;
  start: number;
  end: number;
  size: number;
  name: string;
  color: string;
  usage: string;
}
interface GapSegment {
  type: 'gap';
  start: number;
  end: number;
  size: number;
}
type Segment = BlockSegment | GapSegment;

// Minimum display percentage per segment — prevents tiny blocks from disappearing.
const MIN_DISPLAY_PCT = 3.5;

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const AddressMapVisualizerInner: React.FC<AddressMapVisualizerProps> = ({
  blocks,
  hoveredBlockIndex = null,
  setHoveredBlockIndex = (_idx: number | null) => undefined,
  onBlockClick,
  onInsertAtGap,
  onDeleteBlock,
  layout = 'horizontal',
}) => {
  const [insertHoverGap, setInsertHoverGap] = useState<number | null>(null);
  const [insertBarScrollY, setInsertBarScrollY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockIndex: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const insertClearRef = useRef<number | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const scheduleInsertClear = () => {
    if (insertClearRef.current) {
      clearTimeout(insertClearRef.current);
    }
    insertClearRef.current = window.setTimeout(() => {
      setInsertHoverGap(null);
      setInsertBarScrollY(null);
    }, 150);
  };

  const cancelInsertClear = () => {
    if (insertClearRef.current) {
      clearTimeout(insertClearRef.current);
      insertClearRef.current = null;
    }
  };

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onInsertAtGap) {
      return;
    }
    cancelInsertClear();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-viz-row]'));
    if (rows.length === 0) {
      return;
    }
    const THRESHOLD = 12;
    const mouseY = e.clientY;
    for (let i = 0; i <= rows.length; i++) {
      const gapViewportY =
        i === 0 ? rows[0].getBoundingClientRect().top : rows[i - 1].getBoundingClientRect().bottom;
      if (Math.abs(mouseY - gapViewportY) < THRESHOLD) {
        const containerEl = containerRef.current;
        if (containerEl) {
          const cRect = containerEl.getBoundingClientRect();
          setInsertHoverGap(i);
          setInsertBarScrollY(gapViewportY - cRect.top + containerEl.scrollTop);
        }
        return;
      }
    }
    scheduleInsertClear();
  };

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setContextMenu(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  // ---------------------------------------------------------------------------
  // Derived data for all layouts
  // ---------------------------------------------------------------------------

  const groups = useMemo(() => {
    return blocks.map((block, idx) => {
      const base = block.baseAddress ?? block.base_address ?? block.offset ?? 0;
      const size = calculateBlockSize(block);
      return {
        idx,
        name: block.name ?? `Block ${idx}`,
        start: Number(base),
        end: Number(base) + Number(size) - 1,
        size,
        color: getBlockColor(idx),
        usage: block.usage ?? 'register',
      };
    });
  }, [blocks]);

  // ---------------------------------------------------------------------------
  // Proportional bar data (horizontal layout)
  // ---------------------------------------------------------------------------

  const sortedGroups = useMemo(() => [...groups].sort((a, b) => a.start - b.start), [groups]);

  const { segments, totalEnd, overlapSet } = useMemo(() => {
    if (sortedGroups.length === 0) {
      return { segments: [] as Segment[], totalEnd: 0, overlapSet: new Set<number>() };
    }

    // Detect pairwise overlaps
    const overlapSet = new Set<number>();
    for (let i = 0; i < sortedGroups.length; i++) {
      for (let j = i + 1; j < sortedGroups.length; j++) {
        if (
          sortedGroups[i].start <= sortedGroups[j].end &&
          sortedGroups[i].end >= sortedGroups[j].start
        ) {
          overlapSet.add(sortedGroups[i].idx);
          overlapSet.add(sortedGroups[j].idx);
        }
      }
    }

    const maxEnd = Math.max(...sortedGroups.map((g) => g.end + 1));

    const segs: Segment[] = [];
    let cursor = 0;
    for (const g of sortedGroups) {
      if (g.start > cursor) {
        segs.push({ type: 'gap', start: cursor, end: g.start - 1, size: g.start - cursor });
      }
      segs.push({
        type: 'block',
        idx: g.idx,
        start: g.start,
        end: g.end,
        size: g.size,
        name: g.name,
        color: g.color,
        usage: g.usage,
      });
      cursor = Math.max(cursor, g.end + 1);
    }

    return { segments: segs, totalEnd: maxEnd, overlapSet };
  }, [sortedGroups]);

  // Display widths: proportional with minimum floor, normalized to sum to 100 %.
  const displayPcts = useMemo(() => {
    if (segments.length === 0 || totalEnd === 0) {
      return [] as number[];
    }
    const natural = segments.map((s) => (s.size / totalEnd) * 100);
    const clamped = natural.map((p) => Math.max(p, MIN_DISPLAY_PCT));
    const sum = clamped.reduce((a, b) => a + b, 0);
    return clamped.map((p) => (p / sum) * 100);
  }, [segments, totalEnd]);

  // ---------------------------------------------------------------------------
  // Vertical list layout (side-by-side mode)
  // ---------------------------------------------------------------------------

  if (layout === 'vertical') {
    return (
      <div
        ref={containerRef}
        className="flex flex-col w-full relative"
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={scheduleInsertClear}
      >
        {groups.map((group) => {
          const isHovered = hoveredBlockIndex === group.idx;
          return (
            <div
              key={group.idx}
              data-viz-row
              className={`flex items-center gap-3 px-3 py-2 border-b vscode-border select-none transition-colors ${
                isHovered ? 'vscode-row-hover' : ''
              }`}
              style={{ cursor: onBlockClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHoveredBlockIndex(group.idx)}
              onMouseLeave={() => setHoveredBlockIndex(null)}
              onClick={() => onBlockClick?.(group.idx)}
              onContextMenu={(e) => {
                if (!onInsertAtGap && !onDeleteBlock) {
                  return;
                }
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, blockIndex: group.idx });
              }}
            >
              <div
                className="w-3 shrink-0 self-stretch rounded-sm"
                style={{
                  backgroundColor: FIELD_COLORS[group.color],
                  filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm truncate">{group.name}</span>
                  <span className="ipcraft-pattern-label text-[10px] font-mono shrink-0">
                    {group.usage === 'memory' ? 'MEM' : 'REG'}
                  </span>
                </div>
                <div className="text-[11px] vscode-muted font-mono">
                  {toHex(group.start)}
                  <span className="mx-1 opacity-50">→</span>
                  {toHex(group.end)}
                  <span className="ml-2 opacity-60">{formatSize(group.size)}</span>
                </div>
              </div>
            </div>
          );
        })}
        {onInsertAtGap && insertHoverGap !== null && insertBarScrollY !== null && (
          <div
            className="absolute left-0 right-0 z-20 flex items-center px-3 pointer-events-none"
            style={{ top: insertBarScrollY, transform: 'translateY(-50%)' }}
            onMouseEnter={cancelInsertClear}
            onMouseLeave={scheduleInsertClear}
          >
            <div
              className="flex-1 h-[2px] rounded-full"
              style={{ background: 'linear-gradient(to right, #f97316, #f43f5e)' }}
            />
            <button
              className="pointer-events-auto w-5 h-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center hover:scale-110 transition-transform shadow mx-1 flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
              title={`Insert block at position ${insertHoverGap}`}
              onClick={(e) => {
                e.stopPropagation();
                onInsertAtGap(insertHoverGap);
                setInsertHoverGap(null);
                setInsertBarScrollY(null);
              }}
            >
              +
            </button>
            <div
              className="flex-1 h-[2px] rounded-full"
              style={{ background: 'linear-gradient(to left, #f97316, #f43f5e)' }}
            />
          </div>
        )}
        {contextMenu && (onInsertAtGap ?? onDeleteBlock) && (
          <div
            ref={contextMenuRef}
            className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {onInsertAtGap && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                onClick={() => {
                  onInsertAtGap(contextMenu.blockIndex);
                  setContextMenu(null);
                }}
              >
                <span className="codicon codicon-arrow-up text-xs" />
                Insert Above
              </button>
            )}
            {onInsertAtGap && (
              <button
                className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                onClick={() => {
                  onInsertAtGap(contextMenu.blockIndex + 1);
                  setContextMenu(null);
                }}
              >
                <span className="codicon codicon-arrow-down text-xs" />
                Insert Below
              </button>
            )}
            {onDeleteBlock && (
              <>
                <div className="border-t vscode-border my-0.5" />
                <button
                  className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  style={{ color: 'var(--vscode-errorForeground)' }}
                  onClick={() => {
                    onDeleteBlock(contextMenu.blockIndex);
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-trash text-xs" />
                  Delete
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Proportional columns (stacked / horizontal layout)
  // ---------------------------------------------------------------------------

  if (blocks.length === 0) {
    return (
      <div className="w-full px-4 py-6 text-center vscode-muted text-sm select-none">
        No address blocks defined.
      </div>
    );
  }

  const separatorShadow = 'inset 0 0 0 1px var(--vscode-panel-border)';

  return (
    <div className="w-full select-none">
      {/* Overlap warning */}
      {overlapSet.size > 0 && (
        <div
          className="mx-4 mt-2 text-xs px-2 py-1 rounded flex items-center gap-1.5"
          style={{
            background: 'color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent)',
            color: 'var(--vscode-errorForeground)',
            border: '1px solid color-mix(in srgb, var(--vscode-errorForeground) 30%, transparent)',
          }}
        >
          <span className="codicon codicon-warning text-[11px]" />
          Address space overlap detected
        </div>
      )}

      {/* Proportional columns */}
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {segments.map((seg, i) => {
            const width = `${displayPcts[i]}%`;

            // Gap column — hatched, non-interactive
            if (seg.type === 'gap') {
              return (
                <div
                  key={`gap-${seg.start}`}
                  className="relative self-stretch flex flex-col items-center justify-center overflow-hidden"
                  style={{ width }}
                  title={`Unallocated: ${toHex(seg.start)} → ${toHex(seg.end)} (${formatSize(seg.size)})`}
                >
                  <div
                    className="w-full flex-1 rounded-sm"
                    style={{
                      background: 'var(--vscode-editor-background)',
                      backgroundImage:
                        'repeating-linear-gradient(-45deg, var(--vscode-editorWidget-border, var(--vscode-panel-border)) 0, var(--vscode-editorWidget-border, var(--vscode-panel-border)) 1px, transparent 0, transparent 50%)',
                      backgroundSize: '7px 7px',
                      opacity: 0.6,
                      minHeight: '80px',
                    }}
                  />
                  {displayPcts[i] > 6 && (
                    <div className="text-center text-[10px] vscode-muted font-mono mt-1 opacity-70 leading-tight">
                      {formatSize(seg.size)}
                    </div>
                  )}
                </div>
              );
            }

            // Block column
            const isHovered = hoveredBlockIndex === seg.idx;
            const isOverlap = overlapSet.has(seg.idx);

            return (
              <div
                key={`block-${seg.idx}`}
                className={`relative flex flex-col items-center justify-end select-none ${isHovered ? 'z-10' : ''}`}
                style={{ width, cursor: onBlockClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoveredBlockIndex(seg.idx)}
                onMouseLeave={() => setHoveredBlockIndex(null)}
                onClick={() => onBlockClick?.(seg.idx)}
              >
                {/* Floating label — only on hover to avoid overlap with proportional widths */}
                {isHovered && (
                  <div
                    className="absolute -top-12 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded border shadow-lg text-xs whitespace-nowrap z-20 pointer-events-none"
                    style={{
                      background: 'var(--vscode-editorWidget-background)',
                      color: 'var(--vscode-foreground)',
                      borderColor: 'var(--vscode-panel-border)',
                    }}
                  >
                    <span className="font-bold">{seg.name}</span>
                    <span className="ml-2 vscode-muted font-mono text-[10px]">
                      [{toHex(seg.start)}:{toHex(seg.end)}]
                    </span>
                    <div className="text-[10px] vscode-muted font-mono">
                      {formatSize(seg.size)} · {seg.usage}
                    </div>
                  </div>
                )}

                {/* The column */}
                <div
                  className="w-full overflow-hidden flex items-center justify-center px-2 rounded-md"
                  style={{
                    height: '80px',
                    backgroundColor: FIELD_COLORS[seg.color],
                    transform: isHovered ? 'translateY(-2px)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isOverlap
                      ? `${separatorShadow}, 0 0 0 2px var(--vscode-errorForeground)`
                      : isHovered
                        ? `${separatorShadow}, 0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
                        : separatorShadow,
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5 overflow-hidden w-full">
                    <span className="ipcraft-pattern-label text-[10px] font-mono font-semibold select-none truncate max-w-full px-1">
                      {seg.usage === 'memory' ? 'MEM' : 'REG'}
                    </span>
                    {displayPcts[i] > 8 && (
                      <span className="text-[9px] font-mono opacity-70 truncate max-w-full px-1">
                        {formatSize(seg.size)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Start address below column */}
                <div className="text-center text-[11px] vscode-muted font-mono mt-1">
                  {toHex(seg.start)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Address ruler for context at the far right */}
      <div className="px-4 pb-1 flex justify-end">
        <span className="text-[9px] font-mono vscode-muted opacity-70">{toHex(totalEnd)}</span>
      </div>
    </div>
  );
};

const AddressMapVisualizer = React.memo(
  AddressMapVisualizerInner,
  (prev, next) =>
    prev.blocks === next.blocks &&
    prev.hoveredBlockIndex === next.hoveredBlockIndex &&
    prev.setHoveredBlockIndex === next.setHoveredBlockIndex &&
    prev.onBlockClick === next.onBlockClick &&
    prev.onInsertAtGap === next.onInsertAtGap &&
    prev.onDeleteBlock === next.onDeleteBlock &&
    prev.layout === next.layout
);

export default AddressMapVisualizer;
