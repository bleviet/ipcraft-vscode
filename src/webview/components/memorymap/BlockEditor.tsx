import React, { useEffect, useRef, useState } from "react";
import {
    VSCodeDropdown,
    VSCodeOption,
    VSCodeTextField,
    VSCodeTextArea,
} from "@vscode/webview-ui-toolkit/react";
import { KeyboardShortcutsButton } from "../../shared/components";
import RegisterMapVisualizer from "../RegisterMapVisualizer";
import { FIELD_COLORS, FIELD_COLOR_KEYS } from "../../shared/colors";
import {
    repackRegistersForward,
    repackRegistersBackward,
} from "../../algorithms/RegisterRepacker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RegEditKey = "name" | "offset" | "access" | "description";
type RegActiveCell = { rowIndex: number; key: RegEditKey };
const REG_COLUMN_ORDER: RegEditKey[] = ["name", "offset", "access", "description"];

const ACCESS_OPTIONS = [
    "read-only",
    "write-only",
    "read-write",
    "write-1-to-clear",
    "read-write-1-to-clear",
];

export interface BlockEditorProps {
    /** The address block object (has name, base_address, registers, etc.). */
    block: any;
    selectionMeta?: {
        absoluteAddress?: number;
        relativeOffset?: number;
        focusDetails?: boolean;
    };
    onUpdate: (path: Array<string | number>, value: unknown) => void;
    onNavigateToRegister?: (regIndex: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a single address block's properties, including:
 * - Block header / description
 * - RegisterMapVisualizer
 * - Keyboard-navigable registers table with insert / delete / reorder support
 */
export function BlockEditor({
    block,
    selectionMeta,
    onUpdate,
    onNavigateToRegister,
}: BlockEditorProps) {
    const registers = block?.registers || [];
    const baseAddress = block?.base_address ?? block?.offset ?? 0;

    const [selectedRegIndex, setSelectedRegIndex] = useState<number>(-1);
    const [hoveredRegIndex, setHoveredRegIndex] = useState<number | null>(null);
    const [regActiveCell, setRegActiveCell] = useState<RegActiveCell>({
        rowIndex: -1,
        key: "name",
    });
    const [insertError, setInsertError] = useState<string | null>(null);

    const focusRef = useRef<HTMLDivElement | null>(null);
    const errorRef = useRef<HTMLDivElement | null>(null);

    const toHex = (n: number) => `0x${Math.max(0, n).toString(16).toUpperCase()}`;
    const getRegColor = (idx: number) => FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];

    // Auto-focus on explicit request.
    useEffect(() => {
        if (!selectionMeta?.focusDetails) return;
        const id = window.setTimeout(() => focusRef.current?.focus(), 0);
        return () => window.clearTimeout(id);
    }, [selectionMeta?.focusDetails, block?.name]);

    // Clamp selection when block changes.
    useEffect(() => {
        const regs = block?.registers || [];
        if (!Array.isArray(regs) || regs.length === 0) {
            setSelectedRegIndex(-1);
            setRegActiveCell({ rowIndex: -1, key: "name" });
            return;
        }
        setSelectedRegIndex((prev) => {
            if (prev < 0) return 0;
            if (prev >= regs.length) return regs.length - 1;
            return prev;
        });
        setRegActiveCell((prev) => {
            const rowIndex = prev.rowIndex < 0 ? 0 : Math.min(regs.length - 1, prev.rowIndex);
            const key = REG_COLUMN_ORDER.includes(prev.key) ? prev.key : "name";
            return { rowIndex, key };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [block?.name, (block?.registers || []).length]);

    // Escape: return focus back to the table.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            const activeEl = document.activeElement as HTMLElement | null;
            if (!activeEl) return;
            const inRegs =
                !!focusRef.current &&
                focusRef.current.contains(activeEl) &&
                activeEl !== focusRef.current;
            if (!inRegs) return;
            e.preventDefault();
            e.stopPropagation();
            try { (activeEl as any).blur?.(); } catch { /* ignore */ }
            window.setTimeout(() => focusRef.current?.focus(), 0);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // Keyboard shortcuts (o/O insert, arrow nav, F2/e edit, d delete, Shift+A/I array insert).
    useEffect(() => {
        const liveRegisters = block?.registers || [];

        const getNextRegName = () => {
            let maxN = 0;
            for (const r of liveRegisters) {
                const m = String(r.name || "").match(/^reg(\d+)$/);
                if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
            }
            return `reg${maxN + 1}`;
        };

        const defaultReg = (name: string, offset: number) => ({
            name,
            address_offset: offset,
            offset,
            access: "read-write",
            description: "",
        });

        const tryInsertReg = (after: boolean) => {
            setInsertError(null);
            if (liveRegisters.length === 0) {
                const name = getNextRegName();
                onUpdate(["registers"], [defaultReg(name, 0)]);
                setSelectedRegIndex(0);
                setHoveredRegIndex(0);
                setRegActiveCell({ rowIndex: 0, key: "name" });
                window.setTimeout(() => {
                    document.querySelector(`tr[data-reg-idx="0"]`)?.scrollIntoView({ block: "center" });
                }, 100);
                return;
            }

            const selIdx = selectedRegIndex >= 0 ? selectedRegIndex : liveRegisters.length - 1;
            const selected = liveRegisters[selIdx];
            const selectedOffset = selected.address_offset ?? selected.offset ?? 0;

            if (after) {
                let selectedSize = 4;
                if ((selected as any).__kind === "array") {
                    selectedSize = ((selected as any).count || 1) * ((selected as any).stride || 4);
                }
                const newOffset = selectedOffset + selectedSize;
                const name = getNextRegName();
                let newRegs = [
                    ...liveRegisters.slice(0, selIdx + 1),
                    defaultReg(name, newOffset),
                    ...liveRegisters.slice(selIdx + 1),
                ];
                newRegs = repackRegistersForward(newRegs, selIdx + 2);
                newRegs.sort(
                    (a, b) => (a.address_offset ?? a.offset ?? 0) - (b.address_offset ?? b.offset ?? 0),
                );
                const newIdx = newRegs.findIndex((r) => r.name === name);
                onUpdate(["registers"], newRegs);
                setSelectedRegIndex(newIdx);
                setHoveredRegIndex(newIdx);
                setRegActiveCell({ rowIndex: newIdx, key: "name" });
                window.setTimeout(() => {
                    document.querySelector(`tr[data-reg-idx="${newIdx}"]`)?.scrollIntoView({ block: "center" });
                }, 100);
            } else {
                const newOffset = selectedOffset - 4;
                if (newOffset < 0) {
                    setInsertError("Cannot insert before: offset would be negative");
                    return;
                }
                const name = getNextRegName();
                let newRegs = [
                    ...liveRegisters.slice(0, selIdx),
                    defaultReg(name, newOffset),
                    ...liveRegisters.slice(selIdx),
                ];
                newRegs = repackRegistersBackward(newRegs, selIdx - 1 >= 0 ? selIdx - 1 : 0);
                newRegs.sort(
                    (a, b) => (a.address_offset ?? a.offset ?? 0) - (b.address_offset ?? b.offset ?? 0),
                );
                const newIdx = newRegs.findIndex((r) => r.name === name);
                for (const r of newRegs) {
                    if ((r.address_offset ?? r.offset ?? 0) < 0) {
                        setInsertError("Cannot insert: not enough offset space for repacking");
                        return;
                    }
                }
                onUpdate(["registers"], newRegs);
                setSelectedRegIndex(newIdx);
                setHoveredRegIndex(newIdx);
                setRegActiveCell({ rowIndex: newIdx, key: "name" });
                window.setTimeout(() => {
                    document.querySelector(`tr[data-reg-idx="${newIdx}"]`)?.scrollIntoView({ block: "center" });
                }, 100);
            }
        };

        const onKeyDown = (e: KeyboardEvent) => {
            let keyLower = (e.key || "").toLowerCase();
            if (e.altKey && e.code) {
                if (e.code === "KeyH") keyLower = "h";
                if (e.code === "KeyJ") keyLower = "j";
                if (e.code === "KeyK") keyLower = "k";
                if (e.code === "KeyL") keyLower = "l";
            }
            const vimToArrow: Record<string, "ArrowLeft" | "ArrowDown" | "ArrowUp" | "ArrowRight"> = {
                h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight",
            };
            const normalizedKey: string = vimToArrow[keyLower] ?? e.key;

            const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(normalizedKey);
            const isEdit = normalizedKey === "F2" || keyLower === "e";
            const isDelete = keyLower === "d" || e.key === "Delete";
            const isInsertAfter = keyLower === "o" && !e.shiftKey;
            const isInsertBefore = keyLower === "o" && e.shiftKey;
            const isInsertArrayAfter = keyLower === "a" && e.shiftKey;
            const isInsertArrayBefore = keyLower === "i" && e.shiftKey;

            if (!isArrow && !isEdit && !isDelete && !isInsertAfter && !isInsertBefore &&
                !isInsertArrayAfter && !isInsertArrayBefore) return;
            if (e.ctrlKey || e.metaKey) return;

            const activeEl = document.activeElement as HTMLElement | null;
            const isInRegsArea =
                !!focusRef.current &&
                !!activeEl &&
                (activeEl === focusRef.current || focusRef.current.contains(activeEl));
            if (!isInRegsArea) return;

            const target = e.target as HTMLElement | null;
            const isTypingTarget = !!target?.closest(
                'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown',
            );
            if (isTypingTarget) return;

            const scrollToCell = (rowIndex: number, key: RegEditKey) => {
                window.setTimeout(() => {
                    const row = document.querySelector(`tr[data-reg-idx="${rowIndex}"]`);
                    row?.scrollIntoView({ block: "nearest" });
                    const cell = row?.querySelector(`td[data-col-key="${key}"]`) as HTMLElement | null;
                    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
                }, 0);
            };

            const focusEditor = (rowIndex: number, key: RegEditKey) => {
                window.setTimeout(() => {
                    const row = document.querySelector(`tr[data-reg-idx="${rowIndex}"]`);
                    const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
                    editor?.focus?.();
                }, 0);
            };

            const currentRow =
                regActiveCell.rowIndex >= 0
                    ? regActiveCell.rowIndex
                    : selectedRegIndex >= 0
                        ? selectedRegIndex
                        : 0;
            const currentKey: RegEditKey = REG_COLUMN_ORDER.includes(regActiveCell.key)
                ? regActiveCell.key
                : "name";

            if (isEdit) {
                if (currentRow < 0 || currentRow >= liveRegisters.length) return;
                e.preventDefault(); e.stopPropagation();
                setSelectedRegIndex(currentRow);
                setHoveredRegIndex(currentRow);
                setRegActiveCell({ rowIndex: currentRow, key: currentKey });
                focusEditor(currentRow, currentKey);
                return;
            }
            if (isInsertAfter || isInsertBefore) {
                e.preventDefault(); e.stopPropagation();
                tryInsertReg(isInsertAfter);
                return;
            }
            if (isInsertArrayAfter || isInsertArrayBefore) {
                e.preventDefault(); e.stopPropagation();
                let maxN = 0;
                for (const r of liveRegisters) {
                    const match = r.name?.match(/^ARRAY_(\d+)$/i);
                    if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
                }
                const arrayName = `ARRAY_${maxN + 1}`;
                const selIdx = selectedRegIndex >= 0 ? selectedRegIndex : liveRegisters.length - 1;
                const selected = liveRegisters[selIdx];
                const selectedOffset = selected?.address_offset ?? selected?.offset ?? 0;
                let selectedSize = 4;
                if ((selected as any)?.__kind === "array") {
                    selectedSize = ((selected as any).count || 1) * ((selected as any).stride || 4);
                }
                const newArraySize = 8;
                const baseOffset = isInsertArrayAfter ? selectedOffset + selectedSize : selectedOffset;
                const newArray = {
                    __kind: "array",
                    name: arrayName,
                    address_offset: baseOffset,
                    offset: baseOffset,
                    count: 2,
                    stride: 4,
                    description: "",
                    registers: [
                        {
                            name: "reg0",
                            offset: 0,
                            address_offset: 0,
                            access: "read-write",
                            description: "",
                            fields: [{ name: "data", bits: "[31:0]", access: "read-write", description: "" }],
                        },
                    ],
                };
                let newRegs: any[];
                let newIdx: number;
                if (isInsertArrayAfter) {
                    newRegs = [
                        ...liveRegisters.slice(0, selIdx + 1),
                        newArray,
                        ...liveRegisters.slice(selIdx + 1),
                    ];
                    newIdx = selIdx + 1;
                } else {
                    newRegs = [
                        ...liveRegisters.slice(0, selIdx),
                        newArray,
                        ...liveRegisters.slice(selIdx).map((r: any) => ({
                            ...r,
                            offset: (r.offset ?? r.address_offset ?? 0) + newArraySize,
                            address_offset: (r.address_offset ?? r.offset ?? 0) + newArraySize,
                        })),
                    ];
                    newIdx = selIdx;
                }
                onUpdate(["registers"], newRegs);
                setSelectedRegIndex(newIdx);
                setHoveredRegIndex(newIdx);
                setRegActiveCell({ rowIndex: newIdx, key: "name" });
                return;
            }
            if (isDelete) {
                if (currentRow < 0 || currentRow >= liveRegisters.length) return;
                e.preventDefault(); e.stopPropagation();
                const newRegs = liveRegisters.filter((_: any, i: number) => i !== currentRow);
                onUpdate(["registers"], newRegs);
                const nextRow = currentRow > 0 ? currentRow - 1 : newRegs.length > 0 ? 0 : -1;
                setSelectedRegIndex(nextRow);
                setHoveredRegIndex(nextRow);
                setRegActiveCell({ rowIndex: nextRow, key: currentKey });
                return;
            }

            e.preventDefault(); e.stopPropagation();
            if (liveRegisters.length === 0) return;

            const isVertical = normalizedKey === "ArrowUp" || normalizedKey === "ArrowDown";
            const delta = normalizedKey === "ArrowUp" || normalizedKey === "ArrowLeft" ? -1 : 1;

            if (e.altKey && isVertical) {
                if (selectedRegIndex < 0) return;
                const next = selectedRegIndex + delta;
                if (next < 0 || next >= liveRegisters.length) return;
                const newRegs = [...liveRegisters];
                const temp = newRegs[selectedRegIndex];
                newRegs[selectedRegIndex] = newRegs[next];
                newRegs[next] = temp;
                newRegs.forEach((r, i) => { r.offset = i * 4; r.address_offset = i * 4; });
                onUpdate(["registers"], newRegs);
                setSelectedRegIndex(next);
                setHoveredRegIndex(next);
                setRegActiveCell((prev) => ({ rowIndex: next, key: prev.key }));
                scrollToCell(next, currentKey);
                return;
            }

            if (isVertical) {
                const nextRow = Math.max(0, Math.min(liveRegisters.length - 1, currentRow + delta));
                setSelectedRegIndex(nextRow);
                setHoveredRegIndex(nextRow);
                setRegActiveCell({ rowIndex: nextRow, key: currentKey });
                scrollToCell(nextRow, currentKey);
                return;
            }

            const currentCol = Math.max(0, REG_COLUMN_ORDER.indexOf(currentKey));
            const nextCol = Math.max(0, Math.min(REG_COLUMN_ORDER.length - 1, currentCol + delta));
            const nextKey = REG_COLUMN_ORDER[nextCol] ?? "name";
            setSelectedRegIndex(currentRow);
            setHoveredRegIndex(currentRow);
            setRegActiveCell({ rowIndex: currentRow, key: nextKey });
            scrollToCell(currentRow, nextKey);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [block, selectedRegIndex, hoveredRegIndex, regActiveCell, onUpdate]);

    return (
        <div className="flex flex-col w-full h-full min-h-0">
            {/* Header + RegisterMapVisualizer */}
            <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
                <div className="flex justify-between items-start relative z-10">
                    <div>
                        <h2 className="text-2xl font-bold font-mono tracking-tight">
                            {block?.name || "Address Block"}
                        </h2>
                        <p className="vscode-muted text-sm mt-1 max-w-2xl">
                            {block?.description || `Base: ${toHex(baseAddress)}`} •{" "}
                            {block?.usage || "register"}
                        </p>
                    </div>
                </div>
                <div className="w-full relative z-10 mt-2 select-none">
                    <RegisterMapVisualizer
                        registers={registers}
                        hoveredRegIndex={hoveredRegIndex}
                        setHoveredRegIndex={setHoveredRegIndex}
                        baseAddress={baseAddress}
                        onReorderRegisters={(newRegs) => onUpdate(["registers"], newRegs)}
                        onRegisterClick={onNavigateToRegister}
                    />
                </div>
            </div>

            {/* Registers table */}
            <div className="flex-1 flex overflow-hidden min-h-0">
                <div className="flex-1 vscode-surface min-h-0 flex flex-col">
                    <div
                        ref={focusRef}
                        tabIndex={0}
                        data-regs-table="true"
                        className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
                    >
                        {insertError ? (
                            <div ref={errorRef} className="vscode-error px-4 py-2 text-xs">
                                {insertError}
                            </div>
                        ) : null}
                        <table className="w-full text-left border-collapse table-fixed">
                            <colgroup>
                                <col className="w-[30%] min-w-[200px]" />
                                <col className="w-[20%] min-w-[120px]" />
                                <col className="w-[15%] min-w-[100px]" />
                                <col className="w-[35%]" />
                            </colgroup>
                            <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                                <tr className="h-12">
                                    <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
                                    <th className="px-4 py-3 border-b vscode-border align-middle">Offset</th>
                                    <th className="px-4 py-3 border-b vscode-border align-middle">Access</th>
                                    <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y vscode-border text-sm">
                                {registers.map((reg: any, idx: number) => {
                                    const color = getRegColor(idx);
                                    const offset = reg.address_offset ?? reg.offset ?? idx * 4;

                                    return (
                                        <tr
                                            key={idx}
                                            data-reg-idx={idx}
                                            className={`group transition-colors border-l-4 border-transparent h-12 ${idx === selectedRegIndex
                                                    ? "vscode-focus-border vscode-row-selected"
                                                    : idx === hoveredRegIndex
                                                        ? "vscode-focus-border vscode-row-hover"
                                                        : ""
                                                }`}
                                            onMouseEnter={() => setHoveredRegIndex(idx)}
                                            onMouseLeave={() => setHoveredRegIndex(null)}
                                            onClick={() => {
                                                setSelectedRegIndex(idx);
                                                setHoveredRegIndex(idx);
                                                setRegActiveCell((prev) => ({ rowIndex: idx, key: prev.key }));
                                            }}
                                        >
                                            {/* NAME */}
                                            <td
                                                data-col-key="name"
                                                className={`px-6 py-2 font-medium align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "name"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setHoveredRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "name" });
                                                }}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-2.5 h-2.5 rounded-sm"
                                                        style={{ backgroundColor: FIELD_COLORS[color] || color }}
                                                    />
                                                    <VSCodeTextField
                                                        data-edit-key="name"
                                                        className="flex-1"
                                                        value={reg.name || ""}
                                                        onBlur={(e: any) =>
                                                            onUpdate(["registers", idx, "name"], e.target.value)
                                                        }
                                                    />
                                                </div>
                                            </td>
                                            {/* OFFSET */}
                                            <td
                                                data-col-key="offset"
                                                className={`px-4 py-2 font-mono vscode-muted align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "offset"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setHoveredRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "offset" });
                                                }}
                                            >
                                                <VSCodeTextField
                                                    data-edit-key="offset"
                                                    className="w-full font-mono"
                                                    value={toHex(offset)}
                                                    onInput={(e: any) => {
                                                        const val = Number.parseInt(e.target.value, 0);
                                                        if (!Number.isNaN(val)) {
                                                            onUpdate(["registers", idx, "offset"], val);
                                                        }
                                                    }}
                                                />
                                            </td>
                                            {/* ACCESS */}
                                            <td
                                                data-col-key="access"
                                                className={`px-4 py-2 align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "access"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setHoveredRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "access" });
                                                }}
                                            >
                                                <VSCodeDropdown
                                                    data-edit-key="access"
                                                    className="w-full"
                                                    value={reg.access || "read-write"}
                                                    onInput={(e: any) =>
                                                        onUpdate(["registers", idx, "access"], e.target.value)
                                                    }
                                                >
                                                    {ACCESS_OPTIONS.map((opt) => (
                                                        <VSCodeOption key={opt} value={opt}>{opt}</VSCodeOption>
                                                    ))}
                                                </VSCodeDropdown>
                                            </td>
                                            {/* DESCRIPTION */}
                                            <td
                                                data-col-key="description"
                                                className={`px-6 py-2 vscode-muted align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "description"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setHoveredRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "description" });
                                                }}
                                            >
                                                <VSCodeTextArea
                                                    data-edit-key="description"
                                                    className="w-full"
                                                    rows={1}
                                                    value={reg.description || ""}
                                                    onInput={(e: any) =>
                                                        onUpdate(["registers", idx, "description"], e.target.value)
                                                    }
                                                />
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            <KeyboardShortcutsButton context="block" />
        </div>
    );
}
