import React from 'react';
import type { FieldModel } from '../BitFieldVisualizer';
import type { ProSegment, ShiftDragState } from './types';
import FieldCell from './FieldCell';

interface HoverState {
  keyboardHelpId: string;
  hoveredFieldIndex: number | null;
  setHoveredFieldIndex: (idx: number | null) => void;
}

interface DragState {
  shiftDrag: ShiftDragState;
  shiftHeld: boolean;
  ctrlDragActive: boolean;
  ctrlHeld: boolean;
  isCtrlDragActive: () => boolean;
  dragActive: boolean;
  dragSetTo: 0 | 1;
  dragLast: string | null;
  setDragActive: (active: boolean) => void;
  setDragSetTo: (value: 0 | 1) => void;
  setDragLast: (value: string | null) => void;
}

interface InteractionHandlers {
  onUpdateFieldReset?: (fieldIndex: number, resetValue: number | null) => void;
  handleShiftPointerDown: (bit: number, e: React.PointerEvent) => void;
  handleCtrlPointerDown: (bit: number, e: React.PointerEvent) => void;
  handleShiftPointerMove: (bit: number) => void;
  handleCtrlPointerMove: (bit: number) => void;
  applyKeyboardReorder: (fieldIndex: number, direction: 'msb' | 'lsb') => void;
  applyKeyboardResize: (fieldIndex: number, edge: 'msb' | 'lsb') => void;
  applyBit: (fieldIndex: number, localBit: number, desired: 0 | 1) => void;
  bitAt: (value: number, bitIndex: number) => 0 | 1;
  getResizableEdges: (
    fieldStart: number,
    fieldEnd: number,
    bitOwners: (number | null)[],
    registerSize: number
  ) => {
    left: { canShrink: boolean; canExpand: boolean };
    right: { canShrink: boolean; canExpand: boolean };
  };
}

interface LayoutConfig {
  bitOwners: (number | null)[];
  registerSize: number;
  valueView: 'hex' | 'dec';
  valueBar: React.ReactNode;
}

interface ProLayoutViewProps {
  fields: FieldModel[];
  segments: ProSegment[];
  hoverState: HoverState;
  dragState: DragState;
  interactions: InteractionHandlers;
  layoutConfig: LayoutConfig;
}

const ProLayoutView = ({
  fields,
  segments,
  hoverState,
  dragState,
  interactions,
  layoutConfig,
}: ProLayoutViewProps) => {
  const { keyboardHelpId, hoveredFieldIndex, setHoveredFieldIndex } = hoverState;
  const {
    shiftDrag,
    shiftHeld,
    ctrlDragActive,
    ctrlHeld,
    isCtrlDragActive,
    dragActive,
    dragSetTo,
    dragLast,
    setDragActive,
    setDragSetTo,
    setDragLast,
  } = dragState;
  const {
    onUpdateFieldReset,
    handleShiftPointerDown,
    handleCtrlPointerDown,
    handleShiftPointerMove,
    handleCtrlPointerMove,
    applyKeyboardReorder,
    applyKeyboardResize,
    applyBit,
    bitAt,
    getResizableEdges,
  } = interactions;
  const { bitOwners, registerSize, valueView, valueBar } = layoutConfig;

  return (
    <div className="w-full">
      <div id={keyboardHelpId} className="sr-only">
        Use Alt plus Left or Right arrow to reorder a field. Use Shift plus Left or Right arrow to
        resize the selected field.
      </div>
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        <div className="relative flex flex-row items-end gap-0.5 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full min-w-max">
          {segments.map((segment, segIdx) => {
            const width = segment.end - segment.start + 1;

            if (segment.type === 'gap') {
              return (
                <div
                  key={`gap-${segIdx}`}
                  className="relative flex flex-col items-center justify-end select-none"
                  style={{ width: `calc(${width} * 2rem)` }}
                >
                  <div className="h-20 w-full rounded-t-md overflow-hidden flex">
                    {Array.from({ length: width }).map((_, i) => {
                      const bit = segment.end - i;
                      const isInDragRange =
                        shiftDrag.active &&
                        (shiftDrag.mode === 'create' || shiftDrag.mode === 'resize') &&
                        bit >= Math.min(shiftDrag.anchorBit, shiftDrag.currentBit) &&
                        bit <= Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);

                      return (
                        <div
                          key={i}
                          className="w-10 h-20 flex items-center justify-center touch-none"
                          style={{
                            background: isInDragRange
                              ? 'var(--vscode-editor-selectionBackground, #264f78)'
                              : 'var(--vscode-editor-background)',
                            opacity: isInDragRange ? 0.9 : 0.5,
                            border: isInDragRange
                              ? '2px solid var(--vscode-focusBorder)'
                              : undefined,
                            cursor: ctrlDragActive ? 'grabbing' : ctrlHeld ? 'grab' : 'pointer',
                          }}
                          onPointerDown={(e) => {
                            if (e.shiftKey) {
                              handleShiftPointerDown(bit, e);
                              return;
                            }
                            if (e.ctrlKey || e.metaKey) {
                              handleCtrlPointerDown(bit, e);
                              return;
                            }
                          }}
                          onPointerMove={() => {
                            handleShiftPointerMove(bit);
                            handleCtrlPointerMove(bit);
                          }}
                          onPointerEnter={() => {
                            if (shiftDrag.active) {
                              handleShiftPointerMove(bit);
                            }
                            if (isCtrlDragActive()) {
                              handleCtrlPointerMove(bit);
                            }
                          }}
                        >
                          <span className="text-sm font-mono vscode-muted select-none">
                            {isInDragRange ? '+' : '-'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-row w-full">
                    {Array.from({ length: width }).map((_, i) => {
                      const bit = segment.end - i;
                      return (
                        <div
                          key={bit}
                          className="w-10 text-center text-[11px] vscode-muted font-mono mt-1"
                        >
                          {bit}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const group = segment;
            const isHovered = hoveredFieldIndex === group.idx;
            const field = fields[group.idx];
            const fieldReset =
              field?.reset_value === null || field?.reset_value === undefined
                ? 0
                : Number(field.reset_value);
            const isSingleBit = width === 1;

            return (
              <div
                key={group.idx}
                className={`relative flex flex-col items-center justify-end select-none ${isHovered ? 'z-10' : ''}`}
                style={{ width: `calc(${width} * 2rem)` }}
                role="button"
                tabIndex={0}
                aria-describedby={keyboardHelpId}
                aria-label={`${group.name || 'Field'} bits ${Math.max(group.start, group.end)} to ${Math.min(group.start, group.end)}. Alt plus arrow keys reorder. Shift plus arrow keys resize.`}
                aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                onMouseEnter={() => setHoveredFieldIndex(group.idx)}
                onMouseLeave={() => setHoveredFieldIndex(null)}
                onFocus={() => setHoveredFieldIndex(group.idx)}
                onBlur={() => setHoveredFieldIndex(null)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyKeyboardReorder(group.idx, e.key === 'ArrowLeft' ? 'msb' : 'lsb');
                    return;
                  }
                  if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault();
                    e.stopPropagation();
                    applyKeyboardResize(group.idx, e.key === 'ArrowLeft' ? 'msb' : 'lsb');
                  }
                }}
              >
                <div
                  className="h-20 w-full rounded-t-md overflow-hidden flex relative"
                  style={{
                    opacity: 1,
                    transform: isHovered ? 'translateY(-2px)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isHovered
                      ? '0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)'
                      : undefined,
                  }}
                >
                  {shiftHeld &&
                    isHovered &&
                    !shiftDrag.active &&
                    (() => {
                      const edges = getResizableEdges(
                        group.start,
                        group.end,
                        bitOwners,
                        registerSize
                      );
                      const showVisualLeft = edges.right.canShrink || edges.right.canExpand;
                      const showVisualRight = edges.left.canShrink || edges.left.canExpand;
                      const visualLeftBidirectional =
                        edges.right.canShrink && edges.right.canExpand;
                      const visualRightBidirectional = edges.left.canShrink && edges.left.canExpand;

                      return (
                        <>
                          {showVisualLeft && (
                            <div
                              className="absolute left-0 top-0 bottom-0 w-6 flex items-center justify-center z-20 pointer-events-none"
                              style={{
                                background:
                                  'linear-gradient(90deg, var(--ipcraft-pattern-handle-scrim) 0%, transparent 100%)',
                              }}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                                className="drop-shadow-lg"
                              >
                                {visualLeftBidirectional ? (
                                  <>
                                    <path
                                      d="M2 8H14"
                                      stroke="var(--ipcraft-pattern-label-fg)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M5 5L2 8L5 11"
                                      stroke="var(--ipcraft-pattern-label-fg)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M11 5L14 8L11 11"
                                      stroke="var(--ipcraft-pattern-label-fg)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </>
                                ) : edges.right.canExpand ? (
                                  <path
                                    d="M10 4L6 8L10 12"
                                    stroke="var(--ipcraft-pattern-label-fg)"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ) : (
                                  <path
                                    d="M6 4L10 8L6 12"
                                    stroke="var(--ipcraft-pattern-label-fg)"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}
                              </svg>
                            </div>
                          )}
                          {showVisualRight && (
                            <div
                              className="absolute right-0 top-0 bottom-0 w-6 flex items-center justify-center z-20 pointer-events-none"
                              style={{
                                background:
                                  'linear-gradient(270deg, var(--ipcraft-pattern-handle-scrim) 0%, transparent 100%)',
                              }}
                            >
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 16 16"
                                fill="none"
                                className="drop-shadow-lg"
                              >
                                {visualRightBidirectional ? (
                                  <>
                                    <path
                                      d="M2 8H14"
                                      stroke="var(--ipcraft-pattern-label-fg)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                    />
                                    <path
                                      d="M5 5L2 8L5 11"
                                      stroke="var(--ipcraft-pattern-label-fg)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M11 5L14 8L11 11"
                                      stroke="var(--ipcraft-pattern-label-fg)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </>
                                ) : edges.left.canExpand ? (
                                  <path
                                    d="M6 4L10 8L6 12"
                                    stroke="var(--ipcraft-pattern-label-fg)"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                ) : (
                                  <path
                                    d="M10 4L6 8L10 12"
                                    stroke="var(--ipcraft-pattern-label-fg)"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                )}
                              </svg>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  {Array.from({ length: width }).map((_, i) => {
                    const bit = group.end - i;
                    const localBit = bit - group.start;
                    const value = bitAt(fieldReset, localBit);
                    const dragKey = `${group.idx}:${localBit}`;
                    const isResizingThisField =
                      shiftDrag.active &&
                      shiftDrag.mode === 'resize' &&
                      shiftDrag.targetFieldIndex === group.idx;
                    const isInNewRange =
                      isResizingThisField &&
                      bit >= Math.min(shiftDrag.anchorBit, shiftDrag.currentBit) &&
                      bit <= Math.max(shiftDrag.anchorBit, shiftDrag.currentBit);
                    const isOutOfNewRange = isResizingThisField && !isInNewRange;

                    return (
                      <FieldCell
                        key={i}
                        bitValue={value}
                        cellIndex={i}
                        width={width}
                        isSingleBit={isSingleBit}
                        isOutOfNewRange={isOutOfNewRange}
                        isInNewRange={isInNewRange}
                        color={group.color}
                        fieldIndex={group.idx}
                        ctrlDragActive={ctrlDragActive}
                        ctrlHeld={ctrlHeld}
                        onPointerDown={(e) => {
                          if (e.shiftKey) {
                            handleShiftPointerDown(bit, e);
                            return;
                          }
                          if (e.ctrlKey || e.metaKey) {
                            handleCtrlPointerDown(bit, e);
                            return;
                          }
                          if (!onUpdateFieldReset) {
                            return;
                          }
                          if (e.button !== 0) {
                            return;
                          }
                          e.preventDefault();
                          e.stopPropagation();

                          const desired: 0 | 1 = value === 1 ? 0 : 1;
                          setDragActive(true);
                          setDragSetTo(desired);
                          setDragLast(dragKey);
                          applyBit(group.idx, localBit, desired);
                        }}
                        onPointerMove={() => {
                          handleShiftPointerMove(bit);
                          handleCtrlPointerMove(bit);
                        }}
                        onPointerEnter={(e) => {
                          if (shiftDrag.active) {
                            handleShiftPointerMove(bit);
                            return;
                          }
                          if (isCtrlDragActive()) {
                            handleCtrlPointerMove(bit);
                            return;
                          }
                          if (!dragActive) {
                            return;
                          }
                          if (!onUpdateFieldReset) {
                            return;
                          }
                          if (dragLast === dragKey) {
                            return;
                          }
                          e.preventDefault();
                          e.stopPropagation();
                          setDragLast(dragKey);
                          applyBit(group.idx, localBit, dragSetTo);
                        }}
                      />
                    );
                  })}
                </div>
                <div
                  className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${segIdx === 0 ? 'left-0' : 'left-1/2 -translate-x-1/2'}`}
                  style={{
                    background: 'var(--vscode-editorWidget-background)',
                    color: 'var(--vscode-foreground)',
                    borderColor: 'var(--vscode-panel-border)',
                  }}
                >
                  <div className="font-bold">
                    {group.name}
                    <span className="ml-2 vscode-muted font-mono text-[11px]">
                      [{Math.max(group.start, group.end)}:{Math.min(group.start, group.end)}]
                    </span>
                  </div>
                  <div className="text-[11px] vscode-muted font-mono">
                    {valueView === 'dec'
                      ? Math.trunc(fieldReset).toString(10)
                      : `0x${Math.trunc(fieldReset).toString(16).toUpperCase()}`}
                  </div>
                </div>
                <div className="flex flex-row w-full">
                  {Array.from({ length: width }).map((_, i) => {
                    const bit = group.end - i;
                    return (
                      <div
                        key={bit}
                        className="w-10 text-center text-[11px] vscode-muted font-mono mt-1"
                      >
                        {bit}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {valueBar}
    </div>
  );
};

export default ProLayoutView;
