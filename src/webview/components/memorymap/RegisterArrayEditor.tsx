import React, { useState } from "react";
import type { YamlUpdateHandler } from "../../types/editor";
import {
    VSCodeDropdown,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import { KeyboardShortcutsButton } from "../../shared/components";
import RegisterMapVisualizer from "../RegisterMapVisualizer";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RegEditKey = "name" | "offset" | "access" | "description";
type RegActiveCell = { rowIndex: number; key: RegEditKey };
const REG_COLUMN_ORDER: RegEditKey[] = ["name", "offset", "access", "description"];

export interface RegisterArrayEditorProps {
    /** The register array definition object. */
    registerArray: any;
    onUpdate: YamlUpdateHandler;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders and manages editing of a register array definition:
 * - Array name, base offset, count, stride
 * - Inline RegisterMapVisualizer for nested template registers
 * - Keyboard-navigable nested registers table
 */
export function RegisterArrayEditor({
    registerArray,
    onUpdate,
}: RegisterArrayEditorProps) {
    const arr = registerArray;
    const nestedRegisters = arr?.registers || [];
    const baseOffset = arr?.address_offset ?? 0;

    const [selectedRegIndex, setSelectedRegIndex] = useState<number>(-1);
    const [hoveredRegIndex, setHoveredRegIndex] = useState<number | null>(null);
    const [regActiveCell, setRegActiveCell] = useState<RegActiveCell>({
        rowIndex: -1,
        key: "name",
    });

    const toHex = (n: number) => `0x${Math.max(0, n).toString(16).toUpperCase()}`;

    const scrollToCell = (rowIndex: number, key: string) => {
        window.setTimeout(() => {
            const row = document.querySelector(`tr[data-reg-idx="${rowIndex}"]`);
            row?.scrollIntoView({ block: "nearest" });
            const cell = row?.querySelector(`td[data-col-key="${key}"]`);
            cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
        }, 0);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
        const keyLower = e.key.toLowerCase();
        const vimToArrow: Record<string, string> = {
            h: "ArrowLeft",
            j: "ArrowDown",
            k: "ArrowUp",
            l: "ArrowRight",
        };
        const normalizedKey = vimToArrow[keyLower] ?? e.key;

        const isArrow = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(normalizedKey);
        const isEdit = normalizedKey === "F2" || keyLower === "e" || keyLower === "enter";
        const isDelete = keyLower === "d" || e.key === "Delete";
        const isInsertAfter = keyLower === "o" && !e.shiftKey;
        const isInsertBefore = keyLower === "o" && e.shiftKey;

        if (!isArrow && !isEdit && !isDelete && !isInsertAfter && !isInsertBefore) return;
        if (e.ctrlKey || e.metaKey) return;

        const target = e.target as HTMLElement | null;
        const isTypingTarget = !!target?.closest(
            'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown',
        );
        if (isTypingTarget) return;

        const currentRow = selectedRegIndex >= 0 ? selectedRegIndex : 0;

        if (isInsertAfter || isInsertBefore) {
            e.preventDefault();
            e.stopPropagation();

            let maxN = 0;
            for (const r of nestedRegisters) {
                const match = r.name?.match(/^reg(\d+)$/i);
                if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
            }
            const newName = `reg${maxN + 1}`;
            const selIdx = selectedRegIndex >= 0 ? selectedRegIndex : nestedRegisters.length - 1;
            const selected = nestedRegisters[selIdx];
            const selectedOffset = selected?.address_offset ?? selected?.offset ?? 0;
            const newOffset = isInsertAfter ? selectedOffset + 4 : Math.max(0, selectedOffset - 4);

            const newReg = {
                name: newName,
                offset: newOffset,
                address_offset: newOffset,
                access: "read-write",
                description: "",
                fields: [{ name: "data", bits: "[31:0]", access: "read-write", description: "" }],
            };

            let newRegs: any[];
            let newIdx: number;
            if (isInsertAfter) {
                newRegs = [
                    ...nestedRegisters.slice(0, selIdx + 1),
                    newReg,
                    ...nestedRegisters.slice(selIdx + 1),
                ];
                newIdx = selIdx + 1;
            } else {
                newRegs = [
                    ...nestedRegisters.slice(0, selIdx),
                    newReg,
                    ...nestedRegisters.slice(selIdx),
                ];
                newIdx = selIdx;
            }

            onUpdate(["registers"], newRegs);
            setSelectedRegIndex(newIdx);
            setHoveredRegIndex(newIdx);
            setRegActiveCell({ rowIndex: newIdx, key: "name" });
            scrollToCell(newIdx, "name");
            return;
        }

        if (isDelete) {
            if (currentRow < 0 || currentRow >= nestedRegisters.length) return;
            e.preventDefault();
            e.stopPropagation();
            const newRegs = nestedRegisters.filter((_: any, i: number) => i !== currentRow);
            onUpdate(["registers"], newRegs);
            const nextRow = currentRow > 0 ? currentRow - 1 : newRegs.length > 0 ? 0 : -1;
            setSelectedRegIndex(nextRow);
            setHoveredRegIndex(nextRow);
            return;
        }

        if (isArrow) {
            e.preventDefault();
            const isVertical = normalizedKey === "ArrowUp" || normalizedKey === "ArrowDown";
            const delta = normalizedKey === "ArrowUp" || normalizedKey === "ArrowLeft" ? -1 : 1;

            if (isVertical) {
                const next = Math.max(0, Math.min(nestedRegisters.length - 1, currentRow + delta));
                setSelectedRegIndex(next);
                setHoveredRegIndex(next);
                setRegActiveCell({ rowIndex: next, key: regActiveCell.key });
                scrollToCell(next, regActiveCell.key);
            } else {
                const currentKey = regActiveCell.key;
                const currentCol = Math.max(0, REG_COLUMN_ORDER.indexOf(currentKey));
                const nextCol = Math.max(0, Math.min(REG_COLUMN_ORDER.length - 1, currentCol + delta));
                const nextKey = REG_COLUMN_ORDER[nextCol];
                setRegActiveCell({ rowIndex: currentRow, key: nextKey });
                scrollToCell(currentRow, nextKey);
            }
        }

        if (isEdit) {
            e.preventDefault();
            e.stopPropagation();
            setRegActiveCell({ rowIndex: currentRow, key: regActiveCell.key });
        }
    };

    return (
        <div className="flex flex-col w-full h-full min-h-0">
            {/* Header */}
            <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0">
                <div className="flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-bold font-mono tracking-tight">
                            {arr?.name || "Register Array"}
                        </h2>
                        <p className="vscode-muted text-sm mt-1 max-w-2xl">
                            {arr?.description || "Register array"} • {arr?.count || 1} instances ×{" "}
                            {arr?.stride || 4} bytes
                        </p>
                    </div>
                </div>

                {/* Array Properties */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 vscode-surface-alt p-4 rounded-lg">
                    <div>
                        <label className="text-xs vscode-muted block mb-1">Name</label>
                        <VSCodeTextField
                            value={arr?.name || ""}
                            onInput={(e: any) => onUpdate(["name"], e.target.value)}
                            className="w-full"
                        />
                    </div>
                    <div>
                        <label className="text-xs vscode-muted block mb-1">Base Offset</label>
                        <span className="font-mono text-sm">{toHex(baseOffset)}</span>
                    </div>
                    <div>
                        <label className="text-xs vscode-muted block mb-1">Count</label>
                        <VSCodeTextField
                            value={String(arr?.count || 1)}
                            onInput={(e: any) => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val) && val > 0) onUpdate(["count"], val);
                            }}
                            className="w-24"
                        />
                    </div>
                    <div>
                        <label className="text-xs vscode-muted block mb-1">Stride (bytes)</label>
                        <VSCodeTextField
                            value={String(arr?.stride || 4)}
                            onInput={(e: any) => {
                                const val = parseInt(e.target.value, 10);
                                if (!isNaN(val) && val > 0) onUpdate(["stride"], val);
                            }}
                            className="w-24"
                        />
                    </div>
                </div>

                {/* Address summary */}
                <div className="text-sm vscode-muted">
                    <span className="font-mono">
                        {toHex(baseOffset)} →{" "}
                        {toHex(baseOffset + (arr?.count || 1) * (arr?.stride || 4) - 1)}
                    </span>
                    <span className="ml-2">
                        ({(arr?.count || 1) * (arr?.stride || 4)} bytes total)
                    </span>
                </div>

                {/* RegisterMapVisualizer for nested registers */}
                <div className="w-full relative z-10 mt-4 select-none">
                    <RegisterMapVisualizer
                        registers={nestedRegisters}
                        hoveredRegIndex={hoveredRegIndex}
                        setHoveredRegIndex={setHoveredRegIndex}
                        baseAddress={0}
                        onReorderRegisters={(newRegs) => onUpdate(["registers"], newRegs)}
                        onRegisterClick={(idx) => {
                            setSelectedRegIndex(idx);
                            setHoveredRegIndex(idx);
                        }}
                    />
                </div>
            </div>

            {/* Nested registers table */}
            <div className="flex-1 flex overflow-hidden min-h-0">
                <div className="flex-1 vscode-surface min-h-0 flex flex-col">
                    <div
                        tabIndex={0}
                        data-registers-table="true"
                        className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
                        onKeyDown={handleKeyDown}
                    >
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
                                {nestedRegisters.map((reg: any, idx: number) => {
                                    const regOffset = reg.address_offset ?? reg.offset ?? 0;
                                    const isSelected = selectedRegIndex === idx;
                                    const isHovered = hoveredRegIndex === idx;

                                    return (
                                        <tr
                                            key={idx}
                                            data-reg-idx={idx}
                                            className={`group transition-colors border-l-4 border-transparent h-12 ${isSelected
                                                    ? "vscode-focus-border vscode-row-selected"
                                                    : isHovered
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
                                                    setRegActiveCell({ rowIndex: idx, key: "name" });
                                                }}
                                            >
                                                {regActiveCell.rowIndex === idx && regActiveCell.key === "name" ? (
                                                    <VSCodeTextField
                                                        value={reg.name || ""}
                                                        onInput={(e: any) =>
                                                            onUpdate(["registers", idx, "name"], e.target.value)
                                                        }
                                                        className="w-full font-mono"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className="font-mono">{reg.name}</span>
                                                )}
                                            </td>

                                            {/* OFFSET */}
                                            <td
                                                data-col-key="offset"
                                                className={`px-4 py-2 font-mono text-xs align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "offset"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "offset" });
                                                }}
                                            >
                                                {regActiveCell.rowIndex === idx && regActiveCell.key === "offset" ? (
                                                    <VSCodeTextField
                                                        value={String(regOffset)}
                                                        onInput={(e: any) => {
                                                            const val = parseInt(e.target.value, 10);
                                                            if (!isNaN(val) && val >= 0) {
                                                                onUpdate(["registers", idx, "offset"], val);
                                                                onUpdate(["registers", idx, "address_offset"], val);
                                                            }
                                                        }}
                                                        className="w-full font-mono text-xs"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span>{`0x${Number(regOffset).toString(16).toUpperCase()}`}</span>
                                                )}
                                            </td>

                                            {/* ACCESS */}
                                            <td
                                                data-col-key="access"
                                                className={`px-4 py-2 text-xs align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "access"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "access" });
                                                }}
                                            >
                                                {regActiveCell.rowIndex === idx && regActiveCell.key === "access" ? (
                                                    <VSCodeDropdown
                                                        value={reg.access || "read-write"}
                                                        onInput={(e: any) =>
                                                            onUpdate(["registers", idx, "access"], e.target.value)
                                                        }
                                                        className="w-full"
                                                    >
                                                        {["read-write", "read-only", "write-only"].map((opt) => (
                                                            <option key={opt} value={opt}>
                                                                {opt}
                                                            </option>
                                                        ))}
                                                    </VSCodeDropdown>
                                                ) : (
                                                    <span
                                                        className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold bg-opacity-20 ${reg.access === "read-only"
                                                                ? "bg-blue-500 text-blue-500"
                                                                : reg.access === "write-only"
                                                                    ? "bg-orange-500 text-orange-500"
                                                                    : "bg-green-500 text-green-500"
                                                            }`}
                                                    >
                                                        {reg.access || "RW"}
                                                    </span>
                                                )}
                                            </td>

                                            {/* DESCRIPTION */}
                                            <td
                                                data-col-key="description"
                                                className={`px-6 py-2 align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "description"
                                                        ? "vscode-cell-active"
                                                        : ""
                                                    }`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setSelectedRegIndex(idx);
                                                    setRegActiveCell({ rowIndex: idx, key: "description" });
                                                }}
                                            >
                                                {regActiveCell.rowIndex === idx && regActiveCell.key === "description" ? (
                                                    <VSCodeTextField
                                                        value={reg.description || ""}
                                                        onInput={(e: any) =>
                                                            onUpdate(["registers", idx, "description"], e.target.value)
                                                        }
                                                        className="w-full"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className="truncate block max-w-[300px] opacity-70">
                                                        {reg.description}
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {nestedRegisters.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="px-4 py-8 text-center vscode-muted">
                                            No nested registers. Press{" "}
                                            <kbd className="px-1 rounded vscode-surface-alt">o</kbd> to add one.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex-none p-4 bg-vscode-editor-background border-t vscode-border flex justify-between items-center">
                    <p className="text-xs vscode-muted">
                        These registers are replicated {arr?.count || 1} times at{" "}
                        {arr?.stride || 4}-byte intervals.
                    </p>
                    <KeyboardShortcutsButton context="array" />
                </div>
            </div>
        </div>
    );
}
