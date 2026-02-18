import { useCallback, useEffect, useRef, useState } from "react";
import {
    parseBitsRange,
    formatBits,
    repackFieldsForward,
    repackFieldsBackward,
} from "../algorithms/BitFieldRepacker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditKey = "name" | "bits" | "access" | "reset" | "description";
export type ActiveCell = { rowIndex: number; key: EditKey };

export const COLUMN_ORDER: EditKey[] = [
    "name",
    "bits",
    "access",
    "reset",
    "description",
];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Manages editing state and operations for bit fields within a register.
 * Handles draft values, validation errors, active cell tracking,
 * and spatial insertion logic.
 *
 * @param fields   Normalised bit field array for the current register.
 * @param registerSize  Register width in bits (e.g. 32).
 * @param onUpdate Callback to commit a YAML path + value change.
 * @param isActive When false the keyboard handler is not installed.
 */
export function useFieldEditor(
    fields: any[],
    registerSize: number,
    onUpdate: (path: Array<string | number>, value: unknown) => void,
    isActive: boolean = true,
) {
    // ---- selection / hover ----
    const [selectedFieldIndex, setSelectedFieldIndex] = useState<number>(-1);
    const [hoveredFieldIndex, setHoveredFieldIndex] = useState<number | null>(
        null,
    );
    const [selectedEditKey, setSelectedEditKey] = useState<EditKey>("name");
    const [activeCell, setActiveCell] = useState<ActiveCell>({
        rowIndex: -1,
        key: "name",
    });

    // ---- drafts ----
    const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
    const [nameErrors, setNameErrors] = useState<Record<string, string | null>>(
        {},
    );
    const [bitsDrafts, setBitsDrafts] = useState<Record<number, string>>({});
    const [bitsErrors, setBitsErrors] = useState<Record<number, string | null>>(
        {},
    );
    const [dragPreviewRanges, setDragPreviewRanges] = useState<
        Record<number, [number, number]>
    >({});
    const [resetDrafts, setResetDrafts] = useState<Record<number, string>>({});
    const [resetErrors, setResetErrors] = useState<Record<number, string | null>>(
        {},
    );

    // ---- insert error ----
    const [insertError, setInsertError] = useState<string | null>(null);

    // ---- DOM refs ----
    const focusRef = useRef<HTMLDivElement | null>(null);
    const errorRef = useRef<HTMLDivElement | null>(null);

    // ---------------------------------------------------------------------------
    // Internal helpers
    // ---------------------------------------------------------------------------

    /** Converts bit_offset + bit_width → "[MSB:LSB]" string. */
    const toBits = useCallback((f: any): string => {
        const o = Number(f?.bit_offset ?? 0);
        const w = Number(f?.bit_width ?? 1);
        if (!Number.isFinite(o) || !Number.isFinite(w)) {
            return "[?:?]";
        }
        const msb = o + w - 1;
        return `[${msb}:${o}]`;
    }, []);

    const refocusTableSoon = useCallback(() => {
        window.setTimeout(() => {
            focusRef.current?.focus();
        }, 0);
    }, []);

    const focusFieldEditor = useCallback((rowIndex: number, key: EditKey) => {
        window.setTimeout(() => {
            const row = document.querySelector(`tr[data-field-idx="${rowIndex}"]`);
            const el = row?.querySelector(
                `[data-edit-key="${key}"]`,
            ) as HTMLElement | null;
            try {
                el?.focus();
            } catch {
                // ignore
            }
        }, 0);
    }, []);

    // ---------------------------------------------------------------------------
    // Public helpers returned to consumers
    // ---------------------------------------------------------------------------

    /** Initialises drafts for row `idx` if they haven't been set yet. */
    const ensureDraftsInitialized = useCallback(
        (idx: number) => {
            const f = fields[idx];
            if (!f) {
                return;
            }
            const key = f.name ? `${f.name}` : `idx-${idx}`;
            setNameDrafts((prev) =>
                prev[key] !== undefined ? prev : { ...prev, [key]: String(f.name ?? "") },
            );
            setBitsDrafts((prev) =>
                prev[idx] !== undefined ? prev : { ...prev, [idx]: toBits(f) },
            );
            setResetDrafts((prev) => {
                if (prev[idx] !== undefined) {
                    return prev;
                }
                const v = f?.reset_value;
                const display =
                    v !== null && v !== undefined
                        ? `0x${Number(v).toString(16).toUpperCase()}`
                        : "0x0";
                return { ...prev, [idx]: display };
            });
        },
        [fields, toBits],
    );

    /** Moves the currently selected field up (-1) or down (+1). */
    const moveSelectedField = useCallback(
        (delta: -1 | 1) => {
            const idx = selectedFieldIndex;
            if (idx < 0) {
                return;
            }
            const next = idx + delta;
            if (next < 0 || next >= fields.length) {
                return;
            }
            onUpdate(["__op", "field-move"], { index: idx, delta });
            setBitsDrafts({});
            setBitsErrors({});
            setNameDrafts({});
            setNameErrors({});
            setSelectedFieldIndex(next);
            setHoveredFieldIndex(next);
        },
        [selectedFieldIndex, fields.length, onUpdate],
    );

    // ---------------------------------------------------------------------------
    // Clamp selection when the register changes
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) {
            setSelectedFieldIndex(-1);
            setActiveCell({ rowIndex: -1, key: "name" });
            return;
        }
        if (!fields.length) {
            setSelectedFieldIndex(-1);
            setActiveCell({ rowIndex: -1, key: "name" });
            return;
        }
        setSelectedFieldIndex((prev) => {
            if (prev < 0) {
                return 0;
            }
            if (prev >= fields.length) {
                return fields.length - 1;
            }
            return prev;
        });
        setActiveCell((prev) => {
            const rowIndex =
                prev.rowIndex < 0 ? 0 : Math.min(fields.length - 1, prev.rowIndex);
            const key = COLUMN_ORDER.includes(prev.key) ? prev.key : "name";
            return { rowIndex, key };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, fields.length]);

    // ---------------------------------------------------------------------------
    // Keyboard shortcuts (o/O insert, arrow nav, F2/e edit, d delete)
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) {
            return;
        }

        const getNextFieldName = () => {
            let maxN = 0;
            for (const f of fields) {
                const m = String(f.name || "").match(/^field(\d+)$/);
                if (m) {
                    maxN = Math.max(maxN, parseInt(m[1], 10));
                }
            }
            return `field${maxN + 1}`;
        };

        const tryInsertField = (after: boolean) => {
            setInsertError(null);
            const regSize = registerSize || 32;
            const newFieldWidth = 1;

            if (fields.length === 0) {
                const name = getNextFieldName();
                const newField = {
                    name,
                    bits: formatBits(0, 0),
                    bit_offset: 0,
                    bit_width: 1,
                    bit_range: [0, 0],
                    access: "read-write",
                    reset_value: 0,
                    description: "",
                };
                onUpdate(["fields"], [newField]);
                setSelectedFieldIndex(0);
                setHoveredFieldIndex(0);
                setActiveCell({ rowIndex: 0, key: "name" });
                setBitsDrafts({});
                setBitsErrors({});
                setNameDrafts({});
                setNameErrors({});
                window.setTimeout(() => {
                    const row = document.querySelector(`tr[data-field-idx="0"]`);
                    row?.scrollIntoView({ block: "center" });
                }, 100);
                return;
            }

            const selIdx =
                selectedFieldIndex >= 0 ? selectedFieldIndex : fields.length - 1;
            const selected = fields[selIdx];
            const o = Number(selected?.bit_offset ?? 0);
            const w = Number(selected?.bit_width ?? 1);
            const selectedMsb = o + w - 1;
            const selectedLsb = o;
            const selectedBits = parseBitsRange(`[${selectedMsb}:${selectedLsb}]`);
            if (!selectedBits) {
                setInsertError("Cannot determine selected field position");
                return;
            }
            const [resolvedMsb, resolvedLsb] = selectedBits;

            const scrollToError = () => {
                window.setTimeout(
                    () =>
                        errorRef.current?.scrollIntoView({
                            block: "nearest",
                            behavior: "smooth",
                        }),
                    0,
                );
            };

            if (after) {
                const newMsb = resolvedMsb + 1;
                const newLsb = newMsb - newFieldWidth + 1;

                if (newLsb < 0 || newMsb >= regSize) {
                    setInsertError(
                        `Cannot insert after: would place field at [${newMsb}:${newLsb}], outside register bounds`,
                    );
                    scrollToError();
                    return;
                }

                const innerToBits = (f: any) => {
                    const fo = Number(f?.bit_offset ?? 0);
                    const fw = Number(f?.bit_width ?? 1);
                    const msb = fo + fw - 1;
                    return `[${msb}:${fo}]`;
                };

                for (const f of fields) {
                    if (f === selected) {
                        continue;
                    }
                    const bits = parseBitsRange(innerToBits(f));
                    if (!bits) {
                        continue;
                    }
                    const [fMsb, fLsb] = bits;
                    if (fLsb <= newMsb && fMsb >= newLsb) {
                        setInsertError(
                            `Cannot insert: bits [${newMsb}:${newLsb}] already occupied by ${f.name}`,
                        );
                        scrollToError();
                        return;
                    }
                }

                const name = getNextFieldName();
                const newField = {
                    name,
                    bits: formatBits(newMsb, newLsb),
                    bit_offset: newLsb,
                    bit_width: newFieldWidth,
                    bit_range: [newMsb, newLsb],
                    access: "read-write",
                    reset_value: 0,
                    description: "",
                };

                let newFields = [
                    ...fields.slice(0, selIdx + 1),
                    newField,
                    ...fields.slice(selIdx + 1),
                ];
                newFields = repackFieldsForward(newFields, selIdx + 2, regSize);
                newFields.sort((a, b) => {
                    const aBits = parseBitsRange(
                        `[${Number(a?.bit_offset ?? 0) + Number(a?.bit_width ?? 1) - 1}:${Number(a?.bit_offset ?? 0)}]`,
                    );
                    const bBits = parseBitsRange(
                        `[${Number(b?.bit_offset ?? 0) + Number(b?.bit_width ?? 1) - 1}:${Number(b?.bit_offset ?? 0)}]`,
                    );
                    if (!aBits || !bBits) {
                        return 0;
                    }
                    return aBits[1] - bBits[1];
                });

                const newIdx = newFields.findIndex((f) => f.name === name);
                let minLsb = Infinity;
                for (const f of newFields) {
                    const bits = parseBitsRange(
                        `[${Number(f?.bit_offset ?? 0) + Number(f?.bit_width ?? 1) - 1}:${Number(f?.bit_offset ?? 0)}]`,
                    );
                    if (bits) {
                        minLsb = Math.min(minLsb, bits[1]);
                    }
                }
                if (minLsb < 0) {
                    setInsertError("Cannot insert: not enough space for repacking");
                    scrollToError();
                    return;
                }

                onUpdate(["fields"], newFields);
                setSelectedFieldIndex(newIdx);
                setHoveredFieldIndex(newIdx);
                setActiveCell({ rowIndex: newIdx, key: "name" });
                setBitsDrafts({});
                setBitsErrors({});
                setNameDrafts({});
                setNameErrors({});
                window.setTimeout(() => {
                    const row = document.querySelector(
                        `tr[data-field-idx="${newIdx}"]`,
                    );
                    row?.scrollIntoView({ block: "center" });
                }, 100);
            } else {
                const newLsb = resolvedLsb - 1;
                const newMsb = newLsb + newFieldWidth - 1;

                if (newLsb < 0 || newMsb >= regSize) {
                    setInsertError(
                        `Cannot insert before: would place field at [${newMsb}:${newLsb}], outside register bounds`,
                    );
                    scrollToError();
                    return;
                }

                const innerToBits2 = (f: any) => {
                    const fo = Number(f?.bit_offset ?? 0);
                    const fw = Number(f?.bit_width ?? 1);
                    const msb = fo + fw - 1;
                    return `[${msb}:${fo}]`;
                };

                for (const f of fields) {
                    if (f === selected) {
                        continue;
                    }
                    const bits = parseBitsRange(innerToBits2(f));
                    if (!bits) {
                        continue;
                    }
                    const [fMsb, fLsb] = bits;
                    if (fLsb <= newMsb && fMsb >= newLsb) {
                        setInsertError(
                            `Cannot insert: bits [${newMsb}:${newLsb}] already occupied by ${f.name}`,
                        );
                        scrollToError();
                        return;
                    }
                }

                const name = getNextFieldName();
                const newField = {
                    name,
                    bits: formatBits(newMsb, newLsb),
                    bit_offset: newLsb,
                    bit_width: newFieldWidth,
                    bit_range: [newMsb, newLsb],
                    access: "read-write",
                    reset_value: 0,
                    description: "",
                };

                let newFields = [
                    ...fields.slice(0, selIdx),
                    newField,
                    ...fields.slice(selIdx),
                ];
                newFields = repackFieldsBackward(
                    newFields,
                    selIdx - 1 >= 0 ? selIdx - 1 : 0,
                    regSize,
                );
                newFields.sort((a, b) => {
                    const aBits = parseBitsRange(
                        `[${Number(a?.bit_offset ?? 0) + Number(a?.bit_width ?? 1) - 1}:${Number(a?.bit_offset ?? 0)}]`,
                    );
                    const bBits = parseBitsRange(
                        `[${Number(b?.bit_offset ?? 0) + Number(b?.bit_width ?? 1) - 1}:${Number(b?.bit_offset ?? 0)}]`,
                    );
                    if (!aBits || !bBits) {
                        return 0;
                    }
                    return aBits[1] - bBits[1];
                });

                const newIdx = newFields.findIndex((f) => f.name === name);
                let maxMsb = -Infinity;
                for (const f of newFields) {
                    const bits = parseBitsRange(
                        `[${Number(f?.bit_offset ?? 0) + Number(f?.bit_width ?? 1) - 1}:${Number(f?.bit_offset ?? 0)}]`,
                    );
                    if (bits) {
                        maxMsb = Math.max(maxMsb, bits[0]);
                    }
                }
                if (maxMsb >= regSize) {
                    setInsertError("Cannot insert: not enough space for repacking");
                    scrollToError();
                    return;
                }

                onUpdate(["fields"], newFields);
                setSelectedFieldIndex(newIdx);
                setHoveredFieldIndex(newIdx);
                setActiveCell({ rowIndex: newIdx, key: "name" });
                setBitsDrafts({});
                setBitsErrors({});
                setNameDrafts({});
                setNameErrors({});
                window.setTimeout(() => {
                    const row = document.querySelector(
                        `tr[data-field-idx="${newIdx}"]`,
                    );
                    row?.scrollIntoView({ block: "center" });
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
            const vimToArrow: Record<
                string,
                "ArrowLeft" | "ArrowDown" | "ArrowUp" | "ArrowRight"
            > = { h: "ArrowLeft", j: "ArrowDown", k: "ArrowUp", l: "ArrowRight" };
            const mappedArrow = vimToArrow[keyLower];
            const normalizedKey: string = mappedArrow ?? e.key;

            const isArrow =
                normalizedKey === "ArrowUp" ||
                normalizedKey === "ArrowDown" ||
                normalizedKey === "ArrowLeft" ||
                normalizedKey === "ArrowRight";
            const isEdit = normalizedKey === "F2" || keyLower === "e";
            const isDelete = keyLower === "d" || e.key === "Delete";
            const isInsertAfter = keyLower === "o" && !e.shiftKey;
            const isInsertBefore = keyLower === "o" && e.shiftKey;

            if (
                !isArrow &&
                !isEdit &&
                !isDelete &&
                !isInsertAfter &&
                !isInsertBefore
            ) {
                return;
            }
            if (e.ctrlKey || e.metaKey) {
                return;
            }

            const activeEl = document.activeElement as HTMLElement | null;
            const isInFieldsArea =
                !!focusRef.current &&
                !!activeEl &&
                (activeEl === focusRef.current ||
                    focusRef.current.contains(activeEl));
            if (!isInFieldsArea) {
                return;
            }

            const target = e.target as HTMLElement | null;
            const isInDropdown = !!target?.closest("vscode-dropdown");
            const isTypingTarget = !!target?.closest(
                'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area',
            );
            if (isTypingTarget) {
                return;
            }
            if (isInDropdown && !keyLower.match(/^[hjkl]$/)) {
                return;
            }

            const scrollToCell = (rowIndex: number, key: EditKey) => {
                window.setTimeout(() => {
                    const row = document.querySelector(
                        `tr[data-field-idx="${rowIndex}"]`,
                    );
                    row?.scrollIntoView({
                        block: rowIndex === 0 ? "center" : "nearest",
                    });
                    const cell = row?.querySelector(
                        `td[data-col-key="${key}"]`,
                    ) as HTMLElement | null;
                    cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
                }, 0);
            };

            const currentRow =
                activeCell.rowIndex >= 0
                    ? activeCell.rowIndex
                    : selectedFieldIndex >= 0
                        ? selectedFieldIndex
                        : 0;
            const currentKey: EditKey = COLUMN_ORDER.includes(activeCell.key)
                ? activeCell.key
                : selectedEditKey;

            if (isEdit) {
                if (currentRow < 0 || currentRow >= fields.length) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                setSelectedFieldIndex(currentRow);
                setHoveredFieldIndex(currentRow);
                setSelectedEditKey(currentKey);
                setActiveCell({ rowIndex: currentRow, key: currentKey });
                focusFieldEditor(currentRow, currentKey);
                return;
            }

            if (isInsertAfter || isInsertBefore) {
                e.preventDefault();
                e.stopPropagation();
                tryInsertField(isInsertAfter);
                return;
            }

            if (isDelete) {
                if (currentRow < 0 || currentRow >= fields.length) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                const newFields = fields.filter((_, idx) => idx !== currentRow);
                onUpdate(["fields"], newFields);
                const nextRow =
                    currentRow > 0 ? currentRow - 1 : newFields.length > 0 ? 0 : -1;
                setSelectedFieldIndex(nextRow);
                setHoveredFieldIndex(nextRow);
                setActiveCell({ rowIndex: nextRow, key: currentKey });
                setBitsDrafts({});
                setBitsErrors({});
                setNameDrafts({});
                setNameErrors({});
                return;
            }

            const isVertical =
                normalizedKey === "ArrowUp" || normalizedKey === "ArrowDown";
            const delta =
                normalizedKey === "ArrowUp" || normalizedKey === "ArrowLeft" ? -1 : 1;

            if (e.altKey && isVertical) {
                if (selectedFieldIndex < 0) {
                    return;
                }
                const next = selectedFieldIndex + delta;
                if (next < 0 || next >= fields.length) {
                    return;
                }
                e.preventDefault();
                e.stopPropagation();
                onUpdate(["__op", "field-move"], { index: selectedFieldIndex, delta });
                setBitsDrafts({});
                setBitsErrors({});
                setNameDrafts({});
                setNameErrors({});
                setSelectedFieldIndex(next);
                setHoveredFieldIndex(next);
                setActiveCell((prev) => ({ rowIndex: next, key: prev.key }));
                scrollToCell(next, currentKey);
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (isVertical) {
                const nextRow = Math.max(
                    0,
                    Math.min(fields.length - 1, currentRow + delta),
                );
                setSelectedFieldIndex(nextRow);
                setHoveredFieldIndex(nextRow);
                setSelectedEditKey(currentKey);
                setActiveCell({ rowIndex: nextRow, key: currentKey });
                scrollToCell(nextRow, currentKey);
                return;
            }

            const currentCol = Math.max(0, COLUMN_ORDER.indexOf(currentKey));
            const nextCol = Math.max(
                0,
                Math.min(COLUMN_ORDER.length - 1, currentCol + delta),
            );
            const nextKey = COLUMN_ORDER[nextCol] ?? "name";
            setSelectedFieldIndex(currentRow);
            setHoveredFieldIndex(currentRow);
            setSelectedEditKey(nextKey);
            setActiveCell({ rowIndex: currentRow, key: nextKey });
            scrollToCell(currentRow, nextKey);
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isActive,
        fields.length,
        selectedFieldIndex,
        selectedEditKey,
        activeCell,
        onUpdate,
        registerSize,
    ]);

    // ---------------------------------------------------------------------------
    // Escape: return focus from inline editor back to the table container
    // ---------------------------------------------------------------------------
    useEffect(() => {
        if (!isActive) {
            return;
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") {
                return;
            }
            const activeEl = document.activeElement as HTMLElement | null;
            if (!activeEl) {
                return;
            }
            const inFields =
                !!focusRef.current &&
                focusRef.current.contains(activeEl) &&
                activeEl !== focusRef.current;
            if (!inFields) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            try {
                (activeEl as any).blur?.();
            } catch {
                // ignore
            }
            refocusTableSoon();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [isActive, refocusTableSoon]);

    return {
        // selection / hover
        selectedFieldIndex,
        setSelectedFieldIndex,
        hoveredFieldIndex,
        setHoveredFieldIndex,
        selectedEditKey,
        setSelectedEditKey,
        activeCell,
        setActiveCell,
        // drafts
        nameDrafts,
        setNameDrafts,
        nameErrors,
        setNameErrors,
        bitsDrafts,
        setBitsDrafts,
        bitsErrors,
        setBitsErrors,
        dragPreviewRanges,
        setDragPreviewRanges,
        resetDrafts,
        setResetDrafts,
        resetErrors,
        setResetErrors,
        // insert error
        insertError,
        setInsertError,
        // refs
        focusRef,
        errorRef,
        // helpers
        toBits,
        ensureDraftsInitialized,
        moveSelectedField,
        focusFieldEditor,
        refocusTableSoon,
    };
}

/** Return type of {@link useFieldEditor}. */
export type FieldEditorState = ReturnType<typeof useFieldEditor>;
