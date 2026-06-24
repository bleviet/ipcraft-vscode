import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FIELD_COLORS, FIELD_COLOR_KEYS } from '../shared/colors';
import { toHex } from '../utils/formatUtils';
import { useClampedMenuPosition } from '../shared/hooks/useClampedMenuPosition';

export interface VisualizerRegister {
  name?: string;
  offset?: number | string;
  address_offset?: number | string;
  __kind?: string;
  count?: number;
  stride?: number;
  size?: number;
  [key: string]: unknown;
}

interface RegisterMapVisualizerProps {
  registers: VisualizerRegister[];
  hoveredRegIndex?: number | null;
  setHoveredRegIndex?: (idx: number | null) => void;
  baseAddress?: number;
  onReorderRegisters?: (newRegisters: VisualizerRegister[]) => void;
  onRegisterClick?: (regIndex: number) => void;
  onInsertAtGap?: (gapIndex: number, kind: 'register' | 'flat-array' | 'array') => void;
  onDeleteReg?: (regIndex: number) => void;
  layout?: 'horizontal' | 'vertical';
}

function getRegColor(idx: number) {
  return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
}

// Ctrl-drag state for reordering registers
interface CtrlDragState {
  active: boolean;
  draggedRegIndex: number | null;
  targetIndex: number | null;
}

const CTRL_DRAG_INITIAL: CtrlDragState = {
  active: false,
  draggedRegIndex: null,
  targetIndex: null,
};

const RegisterMapVisualizerInner: React.FC<RegisterMapVisualizerProps> = ({
  registers,
  hoveredRegIndex = null,
  setHoveredRegIndex = () => undefined,
  baseAddress = 0,
  onReorderRegisters,
  onRegisterClick,
  onInsertAtGap,
  onDeleteReg,
  layout = 'horizontal',
}) => {
  const [ctrlDrag, setCtrlDrag] = useState<CtrlDragState>(CTRL_DRAG_INITIAL);
  const [insertHoverGap, setInsertHoverGap] = useState<number | null>(null);
  const [insertBarScrollY, setInsertBarScrollY] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    regIndex: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const insertClearRef = useRef<number | null>(null);
  const contextMenuPos = useClampedMenuPosition(
    contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null
  );

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
    if (!onInsertAtGap || ctrlDrag.active) {
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

  // Ctrl-drag: cleanup on pointer up
  useEffect(() => {
    if (!ctrlDrag.active) {
      return;
    }
    const commitCtrlDrag = () => {
      if (
        ctrlDrag.draggedRegIndex !== null &&
        ctrlDrag.targetIndex !== null &&
        ctrlDrag.draggedRegIndex !== ctrlDrag.targetIndex &&
        onReorderRegisters
      ) {
        // Reorder registers
        const newRegs = [...registers];
        const [removed] = newRegs.splice(ctrlDrag.draggedRegIndex, 1);
        newRegs.splice(ctrlDrag.targetIndex, 0, removed);

        // Offsets will be automatically recalculated by the global layout engine
        // when the state update propagates.

        onReorderRegisters(newRegs);
      }
      setCtrlDrag(CTRL_DRAG_INITIAL);
    };
    const cancelCtrlDrag = () => setCtrlDrag(CTRL_DRAG_INITIAL);

    window.addEventListener('pointerup', commitCtrlDrag);
    window.addEventListener('pointercancel', cancelCtrlDrag);
    window.addEventListener('blur', cancelCtrlDrag);
    return () => {
      window.removeEventListener('pointerup', commitCtrlDrag);
      window.removeEventListener('pointercancel', cancelCtrlDrag);
      window.removeEventListener('blur', cancelCtrlDrag);
    };
  }, [ctrlDrag, registers, onReorderRegisters]);

  const handleCtrlPointerDown = (regIdx: number, e: React.PointerEvent) => {
    if (!e.ctrlKey && !e.metaKey) {
      return;
    }
    if (e.button !== 0) {
      return;
    }
    if (!onReorderRegisters) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    setCtrlDrag({
      active: true,
      draggedRegIndex: regIdx,
      targetIndex: regIdx,
    });
  };

  const handlePointerMove = (regIdx: number) => {
    if (!ctrlDrag.active) {
      return;
    }
    if (ctrlDrag.targetIndex !== regIdx) {
      setCtrlDrag((prev) => ({ ...prev, targetIndex: regIdx }));
    }
  };

  const groups = useMemo(() => {
    return registers.map((reg, idx) => {
      const offset = reg.address_offset ?? reg.offset ?? idx * 4;
      // Calculate size - arrays use count * stride, registers use 4 bytes (32-bit default)
      let size = 4; // Default: 4 bytes (32-bit register)
      let isArray = false;
      if (reg.__kind === 'array') {
        size = (reg.count ?? 1) * (reg.stride ?? 4);
        isArray = true;
      } else if (reg.size) {
        // reg.size is in BITS (e.g., 32 = 32-bit), convert to bytes
        size = Math.max(1, Math.floor(reg.size / 8));
      }
      return {
        idx,
        name: reg.name ?? `Reg ${idx}`,
        offset: Number(offset),
        absoluteAddress: Number(baseAddress) + Number(offset),
        size,
        isArray,
        count: reg.count,
        stride: reg.stride,
        color: getRegColor(idx),
      };
    });
  }, [registers, baseAddress]);

  // Compute preview order during drag
  const displayGroups = useMemo(() => {
    if (
      !ctrlDrag.active ||
      ctrlDrag.draggedRegIndex === null ||
      ctrlDrag.targetIndex === null ||
      ctrlDrag.draggedRegIndex === ctrlDrag.targetIndex
    ) {
      return groups;
    }

    // Reorder for preview
    const newGroups = [...groups];
    const [removed] = newGroups.splice(ctrlDrag.draggedRegIndex, 1);
    newGroups.splice(ctrlDrag.targetIndex, 0, removed);
    return newGroups;
  }, [groups, ctrlDrag]);

  if (layout === 'vertical') {
    return (
      <div
        ref={containerRef}
        className="flex flex-col w-full relative"
        onMouseMove={handleContainerMouseMove}
        onMouseLeave={scheduleInsertClear}
      >
        {displayGroups.map((group, displayIdx) => {
          const isHovered = hoveredRegIndex === group.idx;
          const isDragging = ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
          const isDropTarget =
            ctrlDrag.active &&
            ctrlDrag.targetIndex === displayIdx &&
            ctrlDrag.draggedRegIndex !== displayIdx;

          return (
            <div
              key={group.idx}
              data-viz-row={group.idx}
              className={`flex items-center gap-3 px-3 py-2 border-b vscode-border select-none transition-colors ${
                isHovered ? 'vscode-row-hover' : ''
              } ${isDragging ? 'opacity-50' : ''}`}
              style={{
                cursor: ctrlDrag.active
                  ? 'grabbing'
                  : onRegisterClick || onReorderRegisters
                    ? 'pointer'
                    : 'default',
                boxShadow: isDropTarget ? '0 0 0 2px var(--vscode-focusBorder) inset' : undefined,
              }}
              onMouseEnter={() => setHoveredRegIndex(group.idx)}
              onMouseLeave={() => setHoveredRegIndex(null)}
              onClick={(e) => {
                if (!ctrlDrag.active && onRegisterClick) {
                  e.stopPropagation();
                  onRegisterClick(group.idx);
                }
              }}
              onContextMenu={(e) => {
                if (!onInsertAtGap && !onDeleteReg) {
                  return;
                }
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, regIndex: group.idx });
              }}
              onPointerDown={(e) => handleCtrlPointerDown(group.idx, e)}
              onPointerMove={() => handlePointerMove(displayIdx)}
              onPointerEnter={() => {
                if (ctrlDrag.active) {
                  handlePointerMove(displayIdx);
                }
              }}
            >
              {/* Color swatch */}
              <div
                className={`w-3 shrink-0 self-stretch rounded-sm ${group.isArray ? 'border-2 border-dashed' : ''}`}
                style={{
                  backgroundColor: FIELD_COLORS[group.color],
                  borderColor: group.isArray ? 'var(--ipcraft-pattern-border)' : undefined,
                  filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                }}
              />
              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-semibold text-sm truncate">{group.name}</span>
                  <span className="ipcraft-pattern-label text-[10px] font-mono shrink-0">
                    {group.isArray ? `[${String(group.count)}]` : 'REG'}
                  </span>
                </div>
                <div className="text-[11px] vscode-muted font-mono">
                  {toHex(group.absoluteAddress)}
                  <span className="mx-1 opacity-50">→</span>
                  {toHex(Number(group.absoluteAddress) + Number(group.size) - 1)}
                  <span className="ml-2 opacity-60">[{group.size}B]</span>
                </div>
              </div>
              {/* Absolute address */}
              <div className="text-[11px] vscode-muted font-mono shrink-0">
                @ {toHex(group.absoluteAddress)}
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
            <div className="flex gap-1 mx-2 pointer-events-auto">
              <button
                className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center hover:scale-105 transition-transform shadow"
                style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
                title={`Insert Register at position ${insertHoverGap}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertAtGap(insertHoverGap, 'register');
                  setInsertHoverGap(null);
                  setInsertBarScrollY(null);
                }}
              >
                + REG
              </button>
              <button
                className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center hover:scale-105 transition-transform shadow"
                style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
                title={`Insert Flat Array at position ${insertHoverGap}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertAtGap(insertHoverGap, 'flat-array');
                  setInsertHoverGap(null);
                  setInsertBarScrollY(null);
                }}
              >
                + FLAT ARR
              </button>
              <button
                className="px-2 py-0.5 rounded-full text-white text-[10px] font-bold flex items-center justify-center hover:scale-105 transition-transform shadow"
                style={{ background: 'linear-gradient(135deg, #f97316, #f43f5e)' }}
                title={`Insert Register Array at position ${insertHoverGap}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onInsertAtGap(insertHoverGap, 'array');
                  setInsertHoverGap(null);
                  setInsertBarScrollY(null);
                }}
              >
                + NESTED ARR
              </button>
            </div>
            <div
              className="flex-1 h-[2px] rounded-full"
              style={{ background: 'linear-gradient(to left, #f97316, #f43f5e)' }}
            />
          </div>
        )}
        {contextMenu && (onInsertAtGap ?? onDeleteReg) && (
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
              <>
                <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                  Insert Above
                </div>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onInsertAtGap(contextMenu.regIndex, 'register');
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-symbol-field text-xs" />
                  Register
                </button>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onInsertAtGap(contextMenu.regIndex, 'flat-array');
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-symbol-array text-xs" />
                  Flat Array
                </button>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onInsertAtGap(contextMenu.regIndex, 'array');
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-symbol-struct text-xs" />
                  Nested Array
                </button>

                <div className="border-t vscode-border my-1" />
                <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                  Insert Below
                </div>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onInsertAtGap(contextMenu.regIndex + 1, 'register');
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-symbol-field text-xs" />
                  Register
                </button>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onInsertAtGap(contextMenu.regIndex + 1, 'flat-array');
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-symbol-array text-xs" />
                  Flat Array
                </button>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onInsertAtGap(contextMenu.regIndex + 1, 'array');
                    setContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-symbol-struct text-xs" />
                  Nested Array
                </button>
              </>
            )}
            {onDeleteReg && (
              <>
                <div className="border-t vscode-border my-0.5" />
                <button
                  className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  style={{ color: 'var(--vscode-errorForeground)' }}
                  onClick={() => {
                    onDeleteReg(contextMenu.regIndex);
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

  return (
    <div className="w-full">
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        {/* Register grid background */}
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {displayGroups.map((group, displayIdx) => {
            const isHovered = hoveredRegIndex === group.idx;
            const isDragging = ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
            const isDropTarget =
              ctrlDrag.active &&
              ctrlDrag.targetIndex === displayIdx &&
              ctrlDrag.draggedRegIndex !== displayIdx;
            const separatorShadow = 'inset 0 0 0 1px var(--vscode-panel-border)';

            return (
              <div
                key={group.idx}
                className={`relative flex-1 flex flex-col items-center justify-end select-none min-w-[120px] ${isHovered ? 'z-10' : ''} ${isDragging ? 'opacity-50' : ''}`}
                style={{
                  cursor: ctrlDrag.active
                    ? 'grabbing'
                    : onRegisterClick || onReorderRegisters
                      ? 'pointer'
                      : 'default',
                }}
                onMouseEnter={() => setHoveredRegIndex(group.idx)}
                onMouseLeave={() => setHoveredRegIndex(null)}
                onClick={(e) => {
                  if (!ctrlDrag.active && onRegisterClick) {
                    e.stopPropagation();
                    onRegisterClick(group.idx);
                  }
                }}
                onPointerDown={(e) => handleCtrlPointerDown(group.idx, e)}
                onPointerMove={() => handlePointerMove(displayIdx)}
                onPointerEnter={() => {
                  if (ctrlDrag.active) {
                    handlePointerMove(displayIdx);
                  }
                }}
              >
                <div
                  className={`h-20 w-full overflow-hidden flex items-center justify-center px-2 rounded-md ${group.isArray ? 'border-2 border-dashed' : ''}`}
                  style={{
                    backgroundColor: FIELD_COLORS[group.color],
                    opacity: 1,
                    borderColor: group.isArray ? 'var(--ipcraft-pattern-border)' : undefined,
                    transform: isHovered ? 'translateY(-2px)' : undefined,
                    filter: isHovered ? 'saturate(1.15) brightness(1.05)' : undefined,
                    boxShadow: isDropTarget
                      ? `${separatorShadow}, 0 0 0 3px var(--vscode-focusBorder), 0 0 12px var(--vscode-focusBorder)`
                      : isHovered
                        ? `${separatorShadow}, 0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
                        : separatorShadow,
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="ipcraft-pattern-label text-[10px] font-mono font-semibold select-none text-center leading-tight">
                      {group.isArray ? `[${String(group.count)}]` : 'REG'}
                    </span>
                  </div>
                </div>
                <div
                  className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${
                    displayIdx === 0 ? 'left-0' : 'left-1/2 -translate-x-1/2'
                  }`}
                  style={{
                    background: 'var(--vscode-editorWidget-background)',
                    color: 'var(--vscode-foreground)',
                    borderColor: 'var(--vscode-panel-border)',
                  }}
                >
                  <div className="font-bold">
                    {group.name}
                    <span className="ml-2 vscode-muted font-mono text-[11px]">[{group.size}B]</span>
                  </div>
                  <div className="text-[11px] vscode-muted font-mono">
                    {toHex(group.absoluteAddress)} →{' '}
                    {toHex(Number(group.absoluteAddress) + Number(group.size) - 1)}
                  </div>
                </div>
                <div className="flex w-full justify-center">
                  <div className="text-center text-[11px] vscode-muted font-mono mt-1">
                    {toHex(group.absoluteAddress)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const RegisterMapVisualizer = React.memo(
  RegisterMapVisualizerInner,
  (prev, next) =>
    prev.registers === next.registers &&
    prev.hoveredRegIndex === next.hoveredRegIndex &&
    prev.setHoveredRegIndex === next.setHoveredRegIndex &&
    prev.baseAddress === next.baseAddress &&
    prev.onReorderRegisters === next.onReorderRegisters &&
    prev.onRegisterClick === next.onRegisterClick &&
    prev.onInsertAtGap === next.onInsertAtGap &&
    prev.onDeleteReg === next.onDeleteReg &&
    prev.layout === next.layout
);

export default RegisterMapVisualizer;
