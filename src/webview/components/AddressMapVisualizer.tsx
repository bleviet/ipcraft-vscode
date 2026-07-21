import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { calculateBlockSize } from '../utils/blockSize';
import { useClampedMenuPosition } from '../shared/hooks/useClampedMenuPosition';

export interface VisualizerAddressBlock {
  name?: string;
  baseAddress?: number | string;
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

// Zero-padded 8-digit hex (e.g. 0x00000027) used by the to-scale ruler labels.
function toHex8(n: number): string {
  return `0x${Math.max(0, n).toString(16).toUpperCase().padStart(8, '0')}`;
}

// Pick a "nice" power-of-two tick step that yields roughly `target` ticks across `span`.
function niceTickStep(span: number, target = 16): number {
  if (span <= 0) {
    return 1;
  }
  return Math.max(1, Math.pow(2, Math.round(Math.log2(span / target))));
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
// Shared segment computation hook
// ---------------------------------------------------------------------------

function useSegments(blocks: VisualizerAddressBlock[]) {
  const rawGroups = useMemo(() => {
    return blocks.map((block, idx) => {
      const base = block.baseAddress ?? 0;
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

  const sortedGroups = useMemo(() => [...rawGroups].sort((a, b) => a.start - b.start), [rawGroups]);

  const { segments, totalEnd, overlapSet } = useMemo(() => {
    if (sortedGroups.length === 0) {
      return { segments: [] as Segment[], totalEnd: 0, overlapSet: new Set<number>() };
    }

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

  const displayPcts = useMemo(() => {
    if (segments.length === 0 || totalEnd === 0) {
      return [] as number[];
    }
    const natural = segments.map((s) => (s.size / totalEnd) * 100);
    const clamped = natural.map((p) => Math.max(p, MIN_DISPLAY_PCT));
    const sum = clamped.reduce((a, b) => a + b, 0);
    return clamped.map((p) => (p / sum) * 100);
  }, [segments, totalEnd]);

  return { segments, totalEnd, overlapSet, displayPcts };
}

const STRIPE_BG =
  'repeating-linear-gradient(-45deg, var(--vscode-editorWidget-border, var(--vscode-panel-border)) 0, var(--vscode-editorWidget-border, var(--vscode-panel-border)) 1px, transparent 0, transparent 50%)';

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
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    blockIndex: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const contextMenuPos = useClampedMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  );

  // Measured height of the vertical ruler track so it fills the available pane
  // height instead of a fixed size that leaves empty space below.
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const [rulerHeight, setRulerHeight] = useState(560);
  useEffect(() => {
    const el = rulerRef.current;
    if (!el) {
      return;
    }
    const update = () => setRulerHeight(Math.max(el.clientHeight, 240));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout, blocks.length]);

  const { segments, totalEnd, overlapSet, displayPcts } = useSegments(blocks);

  // First and last block segment indices — used for tooltip edge-pinning.
  const firstBlockSegIdx = useMemo(() => segments.findIndex((s) => s.type === 'block'), [segments]);
  const lastBlockSegIdx = useMemo(
    () => segments.length - 1 - [...segments].reverse().findIndex((s) => s.type === 'block'),
    [segments]
  );

  useEffect(() => {
    if (!contextMenu) {
      return;
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (
        contextMenuPos.menuRef.current &&
        !contextMenuPos.menuRef.current.contains(e.target as Node)
      ) {
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
  // Vertical to-scale address ruler (side-by-side mode)
  //
  // An address axis on the left with evenly-spaced tick labels, a single
  // unified track (gaps shown as light gray) and colored blocks positioned at
  // their true proportional offset, with name / address-range / size labels on
  // the right.
  // ---------------------------------------------------------------------------

  if (layout === 'vertical') {
    if (blocks.length === 0) {
      return (
        <div className="w-full px-3 py-6 text-center vscode-muted text-sm select-none">
          No address blocks defined.
        </div>
      );
    }

    const TRACK_HEIGHT = rulerHeight;
    const MIN_BLOCK_PX = 5;

    const blockSegs = segments.filter((s): s is BlockSegment => s.type === 'block');
    const axisStart = Math.min(...blockSegs.map((s) => s.start));
    const span = Math.max(1, totalEnd - axisStart);
    const maxEndInclusive = totalEnd - 1;

    const toY = (addr: number) => ((addr - axisStart) / span) * TRACK_HEIGHT;

    // Tick values: nice power-of-two steps, plus the top and bottom endpoints.
    const step = niceTickStep(span);
    const tickValues = new Set<number>([axisStart, maxEndInclusive]);
    for (let v = Math.ceil(axisStart / step) * step; v < totalEnd; v += step) {
      tickValues.add(v);
    }
    const ticks = [...tickValues].sort((a, b) => a - b);

    // Declutter label stack: keep each label aligned to its block, but nudge it
    // down so a three-line label never overlaps the one above it.
    const LABEL_MIN_GAP = 44;
    let lastLabelTop = -Infinity;
    const labelTops = blockSegs.map((seg) => {
      const top = Math.max(toY(seg.start), lastLabelTop + LABEL_MIN_GAP);
      lastLabelTop = top;
      return top;
    });

    return (
      <div
        ref={containerRef}
        className="w-full h-full min-h-0 flex flex-col relative select-none px-2 pt-3 pb-12"
        onMouseLeave={() => setHoveredBlockIndex(null)}
      >
        {overlapSet.size > 0 && (
          <div
            className="mb-2 text-xs px-2 py-1 rounded flex items-center gap-1.5"
            style={{
              background: 'color-mix(in srgb, var(--vscode-errorForeground) 12%, transparent)',
              color: 'var(--vscode-errorForeground)',
              border:
                '1px solid color-mix(in srgb, var(--vscode-errorForeground) 30%, transparent)',
            }}
          >
            <span className="codicon codicon-warning text-[11px]" />
            Address space overlap detected
          </div>
        )}

        <div ref={rulerRef} className="flex flex-1 min-h-0">
          {/* Address axis with tick labels */}
          <div className="relative shrink-0" style={{ width: 60 }}>
            <div className="absolute top-0 bottom-0 right-0 w-px bg-[var(--vscode-foreground)] opacity-30" />
            {ticks.map((value) => (
              <div
                key={`tick-${value}`}
                className="absolute right-0 flex items-center gap-1 pr-px"
                style={{ top: toY(value), transform: 'translateY(-50%)' }}
              >
                <span className="text-[10px] font-mono vscode-muted whitespace-nowrap leading-none">
                  {toHex(value)}
                </span>
                <span className="block h-px w-2 bg-[var(--vscode-foreground)] opacity-50" />
              </div>
            ))}
          </div>

          {/* Unified track — gaps remain the gray background, blocks sit on top */}
          <div
            className="relative shrink-0 ml-1 rounded-sm overflow-hidden"
            style={{
              width: 88,
              background: 'color-mix(in srgb, var(--vscode-foreground) 9%, transparent)',
              border: '1px solid var(--vscode-panel-border)',
            }}
          >
            {blockSegs.map((seg) => {
              const isHovered = hoveredBlockIndex === seg.idx;
              const isOverlap = overlapSet.has(seg.idx);
              const top = toY(seg.start);
              const height = Math.max(toY(seg.end + 1) - top, MIN_BLOCK_PX);
              return (
                <div
                  key={`block-${seg.idx}`}
                  data-viz-row
                  className="absolute left-0 right-0"
                  style={{
                    top,
                    height,
                    backgroundColor: FIELD_COLORS[seg.color],
                    cursor: onBlockClick ? 'pointer' : 'default',
                    outline: isOverlap ? '2px solid var(--vscode-errorForeground)' : undefined,
                    outlineOffset: '-2px',
                    filter: isHovered ? 'saturate(1.15) brightness(1.08)' : undefined,
                    boxShadow: isHovered ? 'inset 0 0 0 2px var(--vscode-focusBorder)' : undefined,
                    zIndex: isHovered ? 5 : 1,
                  }}
                  onMouseEnter={() => setHoveredBlockIndex(seg.idx)}
                  onClick={() => onBlockClick?.(seg.idx)}
                  onContextMenu={(e) => {
                    if (!onInsertAtGap && !onDeleteBlock) {
                      return;
                    }
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, blockIndex: seg.idx });
                  }}
                  title={`${seg.name} • ${toHex8(seg.start)} – ${toHex8(seg.end)} • ${formatSize(seg.size)}`}
                />
              );
            })}
          </div>

          {/* Block labels — name / address range / size, aligned to block tops */}
          <div className="relative flex-1 ml-3 min-w-0">
            {blockSegs.map((seg, li) => {
              const isHovered = hoveredBlockIndex === seg.idx;
              return (
                <div
                  key={`label-${seg.idx}`}
                  className="absolute left-0 right-0 leading-tight"
                  style={{ top: labelTops[li], cursor: onBlockClick ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHoveredBlockIndex(seg.idx)}
                  onClick={() => onBlockClick?.(seg.idx)}
                >
                  <div
                    className="font-mono font-semibold text-[12px] truncate"
                    style={{
                      color: FIELD_COLORS[seg.color],
                      textDecoration: isHovered ? 'underline' : undefined,
                    }}
                  >
                    {seg.name}
                  </div>
                  <div className="font-mono text-[10px] vscode-muted whitespace-nowrap">
                    {toHex8(seg.start)} – {toHex8(seg.end)}
                  </div>
                  <div className="font-mono text-[10px] vscode-muted">({formatSize(seg.size)})</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Context menu */}
        {contextMenu && (onInsertAtGap ?? onDeleteBlock) && (
          <div
            ref={contextMenuPos.menuRef}
            className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm"
            style={{
              left: (contextMenuPos.adjusted ?? contextMenu).x,
              top: (contextMenuPos.adjusted ?? contextMenu).y,
            }}
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

      {/* Proportional columns — overflow visible so hover tooltips on edge columns aren't clipped */}
      <div className="relative w-full flex items-start pb-2">
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {segments.map((seg, i) => {
            const width = `${displayPcts[i]}%`;

            // Gap column
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
                      backgroundImage: STRIPE_BG,
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

            // Pin hover tooltip to left edge for first block, right edge for last,
            // centred for everything in between — prevents clipping at container edges.
            const isFirst = i === firstBlockSegIdx;
            const isLast = i === lastBlockSegIdx;
            const tooltipStyle: React.CSSProperties = isFirst
              ? { left: 0 }
              : isLast
                ? { right: 0 }
                : { left: '50%', transform: 'translateX(-50%)' };

            return (
              <div
                key={`block-${seg.idx}`}
                className={`relative flex flex-col items-center justify-end select-none ${isHovered ? 'z-10' : ''}`}
                style={{ width, cursor: onBlockClick ? 'pointer' : 'default' }}
                onMouseEnter={() => setHoveredBlockIndex(seg.idx)}
                onMouseLeave={() => setHoveredBlockIndex(null)}
                onClick={() => onBlockClick?.(seg.idx)}
              >
                {/* Hover tooltip — edge-pinned to avoid clipping */}
                {isHovered && (
                  <div
                    className="absolute -top-12 px-2 py-0.5 rounded border shadow-lg text-xs whitespace-nowrap z-20 pointer-events-none"
                    style={{
                      ...tooltipStyle,
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

      {/* End address */}
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
