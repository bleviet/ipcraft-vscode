import React, { useEffect, useMemo, useState } from "react";
import { FIELD_COLORS, FIELD_COLOR_KEYS } from "../shared/colors";

interface RegisterMapVisualizerProps {
  registers: any[];
  hoveredRegIndex?: number | null;
  setHoveredRegIndex?: (idx: number | null) => void;
  baseAddress?: number;
  onReorderRegisters?: (newRegisters: any[]) => void;
  onRegisterClick?: (regIndex: number) => void;
}

function getRegColor(idx: number) {
  return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
}

function toHex(n: number): string {
  return `0x${Math.max(0, n).toString(16).toUpperCase()}`;
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

const RegisterMapVisualizer: React.FC<RegisterMapVisualizerProps> = ({
  registers,
  hoveredRegIndex = null,
  setHoveredRegIndex = () => {},
  baseAddress = 0,
  onReorderRegisters,
  onRegisterClick,
}) => {
  const [ctrlDrag, setCtrlDrag] = useState<CtrlDragState>(CTRL_DRAG_INITIAL);

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

        // Recalculate offsets - account for arrays (count * stride)
        let runningOffset = 0;
        newRegs.forEach((r) => {
          r.offset = runningOffset;
          r.address_offset = runningOffset;
          // Calculate size for this item
          if (r.__kind === "array") {
            runningOffset += (r.count || 1) * (r.stride || 4);
          } else {
            runningOffset += 4; // Regular register = 4 bytes
          }
        });

        onReorderRegisters(newRegs);
      }
      setCtrlDrag(CTRL_DRAG_INITIAL);
    };
    const cancelCtrlDrag = () => setCtrlDrag(CTRL_DRAG_INITIAL);

    window.addEventListener("pointerup", commitCtrlDrag);
    window.addEventListener("pointercancel", cancelCtrlDrag);
    window.addEventListener("blur", cancelCtrlDrag);
    return () => {
      window.removeEventListener("pointerup", commitCtrlDrag);
      window.removeEventListener("pointercancel", cancelCtrlDrag);
      window.removeEventListener("blur", cancelCtrlDrag);
    };
  }, [ctrlDrag, registers, onReorderRegisters]);

  const handleCtrlPointerDown = (regIdx: number, e: React.PointerEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    if (e.button !== 0) return;
    if (!onReorderRegisters) return;

    e.preventDefault();
    e.stopPropagation();

    setCtrlDrag({
      active: true,
      draggedRegIndex: regIdx,
      targetIndex: regIdx,
    });
  };

  const handlePointerMove = (regIdx: number) => {
    if (!ctrlDrag.active) return;
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
      if (reg.__kind === "array") {
        size = (reg.count || 1) * (reg.stride || 4);
        isArray = true;
      } else if (reg.size) {
        // reg.size is in BITS (e.g., 32 = 32-bit), convert to bytes
        size = Math.max(1, Math.floor(reg.size / 8));
      }
      return {
        idx,
        name: reg.name || `Reg ${idx}`,
        offset,
        absoluteAddress: baseAddress + offset,
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

  return (
    <div className="w-full">
      <div className="relative w-full flex items-start overflow-x-auto pb-2">
        {/* Register grid background */}
        <div className="relative flex flex-row items-end gap-0 pl-4 pr-2 pt-12 pb-2 min-h-[64px] w-full">
          {displayGroups.map((group, displayIdx) => {
            const isHovered = hoveredRegIndex === group.idx;
            const isDragging =
              ctrlDrag.active && ctrlDrag.draggedRegIndex === group.idx;
            const isDropTarget =
              ctrlDrag.active &&
              ctrlDrag.targetIndex === displayIdx &&
              ctrlDrag.draggedRegIndex !== displayIdx;
            const separatorShadow =
              "inset 0 0 0 1px var(--vscode-panel-border)";

            return (
              <div
                key={group.idx}
                className={`relative flex-1 flex flex-col items-center justify-end select-none min-w-[120px] ${isHovered ? "z-10" : ""} ${isDragging ? "opacity-50" : ""}`}
                style={{
                  cursor: ctrlDrag.active
                    ? "grabbing"
                    : onRegisterClick || onReorderRegisters
                      ? "pointer"
                      : "default",
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
                  if (ctrlDrag.active) handlePointerMove(displayIdx);
                }}
              >
                <div
                  className={`h-20 w-full overflow-hidden flex items-center justify-center px-2 rounded-md ${group.isArray ? "border-2 border-dashed border-white/30" : ""}`}
                  style={{
                    background: FIELD_COLORS[group.color],
                    opacity: 1,
                    transform: isHovered ? "translateY(-2px)" : undefined,
                    filter: isHovered
                      ? "saturate(1.15) brightness(1.05)"
                      : undefined,
                    boxShadow: isDropTarget
                      ? `${separatorShadow}, 0 0 0 3px var(--vscode-focusBorder), 0 0 12px var(--vscode-focusBorder)`
                      : isHovered
                        ? `${separatorShadow}, 0 0 0 2px var(--vscode-focusBorder), 0 10px 20px color-mix(in srgb, var(--vscode-foreground) 22%, transparent)`
                        : separatorShadow,
                  }}
                >
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-lg select-none">
                      {group.isArray ? "📦" : "📋"}
                    </span>
                    <span className="text-[10px] font-mono text-white/80 font-semibold select-none text-center leading-tight">
                      {group.isArray ? `[${group.count}]` : "REG"}
                    </span>
                  </div>
                </div>
                <div
                  className={`absolute -top-12 px-2 py-0.5 rounded border shadow text-xs whitespace-nowrap pointer-events-none ${
                    displayIdx === 0 ? "left-0" : "left-1/2 -translate-x-1/2"
                  }`}
                  style={{
                    background: "var(--vscode-editorWidget-background)",
                    color: "var(--vscode-foreground)",
                    borderColor: "var(--vscode-panel-border)",
                  }}
                >
                  <div className="font-bold">
                    {group.name}
                    <span className="ml-2 vscode-muted font-mono text-[11px]">
                      [{group.size}B]
                    </span>
                  </div>
                  <div className="text-[11px] vscode-muted font-mono">
                    {toHex(group.absoluteAddress)} →{" "}
                    {toHex(group.absoluteAddress + group.size - 1)}
                  </div>
                </div>
                <div className="flex w-full justify-center">
                  <div className="text-center text-[11px] vscode-muted font-mono mt-1">
                    +{toHex(group.offset)}
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

export default RegisterMapVisualizer;
