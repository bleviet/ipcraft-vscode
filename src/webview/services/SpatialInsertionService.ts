/**
 * SpatialInsertionService
 *
 * Encapsulates the insert → repack → sort → validate pipeline for the three
 * spatial entities in the memory-map editor:
 *   • bit fields within a register   (insertField*)
 *   • registers within an address block (insertRegister*)
 *   • address blocks within a memory map (insertBlock*)
 *
 * All methods are pure (no side effects, no DOM access, no React state).
 * Callers are responsible for dispatching the result and updating UI state.
 */

import {
    parseBitsRange,
    formatBits,
    repackFieldsForward,
    repackFieldsBackward,
} from "../algorithms/BitFieldRepacker";
import {
    repackRegistersForward,
    repackRegistersBackward,
} from "../algorithms/RegisterRepacker";
import {
    repackBlocksForward,
    repackBlocksBackward,
} from "../algorithms/AddressBlockRepacker";

// ---------------------------------------------------------------------------
// Public result type
// ---------------------------------------------------------------------------

/**
 * Generic result of a spatial insertion operation.
 *
 * @template T  The array-element type (bit field, register, or address block).
 */
export interface InsertionResult<T> {
    /** Updated array containing the new item. */
    items: T[];
    /** Index of the newly inserted item in `items`. -1 when an error occurred. */
    newIndex: number;
    /** Human-readable error message. Present only when the insertion failed. */
    error?: string;
}

// ---------------------------------------------------------------------------
// Convenience runtime shapes (looser than the generated schema types so that
// the service can operate on the live objects the webview actually builds).
// ---------------------------------------------------------------------------

/** Runtime bit-field object as constructed in the webview. */
export interface BitFieldRuntimeDef {
    name: string;
    bits: string;
    bit_offset: number;
    bit_width: number;
    bit_range: [number, number];
    access: string;
    reset_value: number;
    description: string;
    [key: string]: unknown;
}

/** Runtime register object (regular or array) as used in address blocks. */
export interface RegisterRuntimeDef {
    name: string;
    address_offset?: number;
    offset?: number;
    access: string;
    description: string;
    __kind?: string;
    count?: number;
    stride?: number;
    [key: string]: unknown;
}

/** Runtime address block as used in memory maps. */
export interface AddressBlockRuntimeDef {
    name: string;
    base_address?: number;
    offset?: number;
    size?: number;
    range?: number;
    registers?: RegisterRuntimeDef[];
    [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Convert `bit_offset` + `bit_width` to a `[msb:lsb]` range string. */
function fieldToBitsStr(field: BitFieldRuntimeDef): string {
    const lo = Number(field.bit_offset ?? 0);
    const width = Number(field.bit_width ?? 1);
    const msb = lo + width - 1;
    return `[${msb}:${lo}]`;
}

/** Compute the next sequential name of the form `<prefix><N+1>`. */
function nextSequentialName(items: { name?: string }[], prefix: string): string {
    let maxN = 0;
    const re = new RegExp(`^${prefix}(\\d+)$`);
    for (const item of items) {
        const m = String(item.name ?? "").match(re);
        if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    }
    return `${prefix}${maxN + 1}`;
}

/** Sort fields ascending by LSB. */
function sortFieldsByLsb(fields: BitFieldRuntimeDef[]): BitFieldRuntimeDef[] {
    return [...fields].sort((a, b) => {
        const aBits = parseBitsRange(fieldToBitsStr(a));
        const bBits = parseBitsRange(fieldToBitsStr(b));
        if (!aBits || !bBits) return 0;
        return aBits[1] - bBits[1];
    });
}

/** Sort registers ascending by address offset. */
function sortRegistersByOffset(registers: RegisterRuntimeDef[]): RegisterRuntimeDef[] {
    return [...registers].sort(
        (a, b) =>
            (a.address_offset ?? a.offset ?? 0) - (b.address_offset ?? b.offset ?? 0),
    );
}

/** Sort blocks ascending by base address. */
function sortBlocksByBase(blocks: AddressBlockRuntimeDef[]): AddressBlockRuntimeDef[] {
    return [...blocks].sort(
        (a, b) =>
            (a.base_address ?? a.offset ?? 0) - (b.base_address ?? b.offset ?? 0),
    );
}

// ---------------------------------------------------------------------------
// SpatialInsertionService
// ---------------------------------------------------------------------------

/**
 * Provides spatial insertion operations for bit fields, registers, and address
 * blocks. Encapsulates the insert → repack → sort → validate pipeline.
 *
 * All methods are static and free of side effects.
 */
export class SpatialInsertionService {
    // =========================================================================
    // BIT FIELD INSERTION
    // =========================================================================

    /**
     * Insert a new 1-bit field immediately after the field at `selectedIndex`.
     *
     * The new field is placed at `selectedMsb + 1`. If that position collides
     * with an existing field, `repackFieldsForward` is applied to shift
     * subsequent fields upward. Returns an error if the register bounds would
     * be exceeded.
     *
     * @param fields        Normalised bit-field array for the current register.
     * @param selectedIndex Index of the currently selected field. -1 means last.
     * @param registerSize  Register width in bits (typically 32).
     */
    static insertFieldAfter(
        fields: BitFieldRuntimeDef[],
        selectedIndex: number,
        registerSize: number,
    ): InsertionResult<BitFieldRuntimeDef> {
        const regSize = registerSize || 32;
        const name = nextSequentialName(fields, "field");

        if (fields.length === 0) {
            const newField: BitFieldRuntimeDef = {
                name,
                bits: formatBits(0, 0),
                bit_offset: 0,
                bit_width: 1,
                bit_range: [0, 0],
                access: "read-write",
                reset_value: 0,
                description: "",
            };
            return { items: [newField], newIndex: 0 };
        }

        const selIdx = selectedIndex >= 0 ? selectedIndex : fields.length - 1;
        const selected = fields[selIdx];
        const selectedBits = parseBitsRange(fieldToBitsStr(selected));
        if (!selectedBits) {
            return {
                items: fields,
                newIndex: -1,
                error: "Cannot determine selected field position",
            };
        }
        const [resolvedMsb] = selectedBits;
        const newMsb = resolvedMsb + 1;
        const newLsb = newMsb; // width = 1

        if (newLsb < 0 || newMsb >= regSize) {
            return {
                items: fields,
                newIndex: -1,
                error: `Cannot insert after: would place field at [${newMsb}:${newLsb}], outside register bounds`,
            };
        }

        // Collision check.
        for (const field of fields) {
            if (field === selected) continue;
            const bits = parseBitsRange(fieldToBitsStr(field));
            if (!bits) continue;
            const [fMsb, fLsb] = bits;
            if (fLsb <= newMsb && fMsb >= newLsb) {
                return {
                    items: fields,
                    newIndex: -1,
                    error: `Cannot insert: bits [${newMsb}:${newLsb}] already occupied by ${field.name}`,
                };
            }
        }

        const newField: BitFieldRuntimeDef = {
            name,
            bits: formatBits(newMsb, newLsb),
            bit_offset: newLsb,
            bit_width: 1,
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
        newFields = sortFieldsByLsb(newFields);

        // Validate: no field may have a negative LSB.
        let minLsb = Infinity;
        for (const field of newFields) {
            const bits = parseBitsRange(fieldToBitsStr(field));
            if (bits) minLsb = Math.min(minLsb, bits[1]);
        }
        if (minLsb < 0) {
            return {
                items: fields,
                newIndex: -1,
                error: "Cannot insert: not enough space for repacking",
            };
        }

        const newIndex = newFields.findIndex((field) => field.name === name);
        return { items: newFields, newIndex };
    }

    /**
     * Insert a new 1-bit field immediately before the field at `selectedIndex`.
     *
     * The new field is placed at `selectedLsb - 1`. `repackFieldsBackward` is
     * applied if needed. Returns an error if bounds would be exceeded.
     *
     * @param fields        Normalised bit-field array for the current register.
     * @param selectedIndex Index of the currently selected field. -1 means last.
     * @param registerSize  Register width in bits (typically 32).
     */
    static insertFieldBefore(
        fields: BitFieldRuntimeDef[],
        selectedIndex: number,
        registerSize: number,
    ): InsertionResult<BitFieldRuntimeDef> {
        const regSize = registerSize || 32;
        const name = nextSequentialName(fields, "field");

        if (fields.length === 0) {
            const newField: BitFieldRuntimeDef = {
                name,
                bits: formatBits(0, 0),
                bit_offset: 0,
                bit_width: 1,
                bit_range: [0, 0],
                access: "read-write",
                reset_value: 0,
                description: "",
            };
            return { items: [newField], newIndex: 0 };
        }

        const selIdx = selectedIndex >= 0 ? selectedIndex : fields.length - 1;
        const selected = fields[selIdx];
        const selectedBits = parseBitsRange(fieldToBitsStr(selected));
        if (!selectedBits) {
            return {
                items: fields,
                newIndex: -1,
                error: "Cannot determine selected field position",
            };
        }
        const [, resolvedLsb] = selectedBits;
        const newLsb = resolvedLsb - 1;
        const newMsb = newLsb; // width = 1

        if (newLsb < 0 || newMsb >= regSize) {
            return {
                items: fields,
                newIndex: -1,
                error: `Cannot insert before: would place field at [${newMsb}:${newLsb}], outside register bounds`,
            };
        }

        // Collision check.
        for (const field of fields) {
            if (field === selected) continue;
            const bits = parseBitsRange(fieldToBitsStr(field));
            if (!bits) continue;
            const [fMsb, fLsb] = bits;
            if (fLsb <= newMsb && fMsb >= newLsb) {
                return {
                    items: fields,
                    newIndex: -1,
                    error: `Cannot insert: bits [${newMsb}:${newLsb}] already occupied by ${field.name}`,
                };
            }
        }

        const newField: BitFieldRuntimeDef = {
            name,
            bits: formatBits(newMsb, newLsb),
            bit_offset: newLsb,
            bit_width: 1,
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
        newFields = sortFieldsByLsb(newFields);

        // Validate: no field may exceed register size.
        let maxMsb = -Infinity;
        for (const field of newFields) {
            const bits = parseBitsRange(fieldToBitsStr(field));
            if (bits) maxMsb = Math.max(maxMsb, bits[0]);
        }
        if (maxMsb >= regSize) {
            return {
                items: fields,
                newIndex: -1,
                error: "Cannot insert: not enough space for repacking",
            };
        }

        const newIndex = newFields.findIndex((field) => field.name === name);
        return { items: newFields, newIndex };
    }

    // =========================================================================
    // REGISTER INSERTION
    // =========================================================================

    /**
     * Insert a new register immediately after the register at `selectedIndex`.
     *
     * The new register is offset at `selectedOffset + selectedSize` (4 bytes
     * for regular registers, or `count * stride` for register arrays).
     * `repackRegistersForward` is applied to keep subsequent registers
     * contiguous.
     *
     * @param registers     Current register array.
     * @param selectedIndex Index of the currently selected register. -1 means last.
     */
    static insertRegisterAfter(
        registers: RegisterRuntimeDef[],
        selectedIndex: number,
    ): InsertionResult<RegisterRuntimeDef> {
        const name = nextSequentialName(registers, "reg");

        const defaultReg = (regName: string, offset: number): RegisterRuntimeDef => ({
            name: regName,
            address_offset: offset,
            offset,
            access: "read-write",
            description: "",
        });

        if (registers.length === 0) {
            return { items: [defaultReg(name, 0)], newIndex: 0 };
        }

        const selIdx = selectedIndex >= 0 ? selectedIndex : registers.length - 1;
        const selected = registers[selIdx];
        const selectedOffset = selected.address_offset ?? selected.offset ?? 0;

        // Compute the size of the selected entry (4 bytes, or array footprint).
        let selectedSize = 4;
        if (selected.__kind === "array") {
            selectedSize = (selected.count ?? 1) * (selected.stride ?? 4);
        }
        const newOffset = selectedOffset + selectedSize;

        let newRegisters: RegisterRuntimeDef[] = [
            ...registers.slice(0, selIdx + 1),
            defaultReg(name, newOffset),
            ...registers.slice(selIdx + 1),
        ];
        newRegisters = repackRegistersForward(newRegisters, selIdx + 2);
        newRegisters = sortRegistersByOffset(newRegisters);

        const newIndex = newRegisters.findIndex((r) => r.name === name);
        return { items: newRegisters, newIndex };
    }

    /**
     * Insert a new register immediately before the register at `selectedIndex`.
     *
     * Returns an error if the computed offset would be negative.
     *
     * @param registers     Current register array.
     * @param selectedIndex Index of the currently selected register. -1 means last.
     */
    static insertRegisterBefore(
        registers: RegisterRuntimeDef[],
        selectedIndex: number,
    ): InsertionResult<RegisterRuntimeDef> {
        const name = nextSequentialName(registers, "reg");

        const defaultReg = (regName: string, offset: number): RegisterRuntimeDef => ({
            name: regName,
            address_offset: offset,
            offset,
            access: "read-write",
            description: "",
        });

        if (registers.length === 0) {
            return { items: [defaultReg(name, 0)], newIndex: 0 };
        }

        const selIdx = selectedIndex >= 0 ? selectedIndex : registers.length - 1;
        const selected = registers[selIdx];
        const selectedOffset = selected.address_offset ?? selected.offset ?? 0;
        const newOffset = selectedOffset - 4;

        if (newOffset < 0) {
            return {
                items: registers,
                newIndex: -1,
                error: "Cannot insert before: offset would be negative",
            };
        }

        let newRegisters: RegisterRuntimeDef[] = [
            ...registers.slice(0, selIdx),
            defaultReg(name, newOffset),
            ...registers.slice(selIdx),
        ];
        newRegisters = repackRegistersBackward(
            newRegisters,
            selIdx - 1 >= 0 ? selIdx - 1 : 0,
        );
        newRegisters = sortRegistersByOffset(newRegisters);

        // Validate: no register should end up with a negative offset.
        for (const reg of newRegisters) {
            if ((reg.address_offset ?? reg.offset ?? 0) < 0) {
                return {
                    items: registers,
                    newIndex: -1,
                    error: "Cannot insert: not enough offset space for repacking",
                };
            }
        }

        const newIndex = newRegisters.findIndex((r) => r.name === name);
        return { items: newRegisters, newIndex };
    }

    // =========================================================================
    // BLOCK INSERTION
    // =========================================================================

    /**
     * Insert a new address block immediately after the block at `selectedIndex`.
     *
     * The new block's base is set to `selectedBase + selectedSize`.
     * `repackBlocksForward` is applied to keep subsequent blocks contiguous.
     *
     * @param blocks        Current address-block array.
     * @param selectedIndex Index of the currently selected block. -1 means last.
     */
    static insertBlockAfter(
        blocks: AddressBlockRuntimeDef[],
        selectedIndex: number,
    ): InsertionResult<AddressBlockRuntimeDef> {
        const name = nextSequentialName(blocks, "block");

        const defaultBlock = (
            blockName: string,
            base: number,
        ): AddressBlockRuntimeDef => ({
            name: blockName,
            base_address: base,
            size: 4,
            usage: "register",
            description: "",
            registers: [
                {
                    name: "reg0",
                    address_offset: 0,
                    offset: 0,
                    access: "read-write",
                    description: "",
                },
            ],
        });

        if (blocks.length === 0) {
            return { items: [defaultBlock(name, 0)], newIndex: 0 };
        }

        const selIdx = selectedIndex >= 0 ? selectedIndex : blocks.length - 1;
        const selected = blocks[selIdx];
        const selectedBase = selected.base_address ?? selected.offset ?? 0;
        const selectedRegisters = selected.registers ?? [];
        const selectedSize =
            selectedRegisters.length > 0
                ? selectedRegisters.length * 4
                : (selected.size ?? selected.range ?? 4);

        const newBase = selectedBase + (typeof selectedSize === "number" ? selectedSize : 4);

        let newBlocks: AddressBlockRuntimeDef[] = [
            ...blocks.slice(0, selIdx + 1),
            defaultBlock(name, newBase),
            ...blocks.slice(selIdx + 1),
        ];
        newBlocks = repackBlocksForward(newBlocks, selIdx + 2);
        newBlocks = sortBlocksByBase(newBlocks);

        const newIndex = newBlocks.findIndex((b) => b.name === name);
        return { items: newBlocks, newIndex };
    }

    /**
     * Insert a new address block immediately before the block at `selectedIndex`.
     *
     * Returns an error if there is insufficient address space.
     *
     * @param blocks        Current address-block array.
     * @param selectedIndex Index of the currently selected block. -1 means last.
     */
    static insertBlockBefore(
        blocks: AddressBlockRuntimeDef[],
        selectedIndex: number,
    ): InsertionResult<AddressBlockRuntimeDef> {
        const name = nextSequentialName(blocks, "block");

        const defaultBlock = (
            blockName: string,
            base: number,
        ): AddressBlockRuntimeDef => ({
            name: blockName,
            base_address: base,
            size: 4,
            usage: "register",
            description: "",
            registers: [
                {
                    name: "reg0",
                    address_offset: 0,
                    offset: 0,
                    access: "read-write",
                    description: "",
                },
            ],
        });

        if (blocks.length === 0) {
            return { items: [defaultBlock(name, 0)], newIndex: 0 };
        }

        const selIdx = selectedIndex >= 0 ? selectedIndex : blocks.length - 1;
        const selected = blocks[selIdx];
        const selectedBase = selected.base_address ?? selected.offset ?? 0;
        const newSize = 4;
        const newEnd = selectedBase - 1;
        const newBase = Math.max(0, newEnd - newSize + 1);

        if (newBase < 0) {
            return {
                items: blocks,
                newIndex: -1,
                error: "Cannot insert before: not enough address space",
            };
        }

        let newBlocks: AddressBlockRuntimeDef[] = [
            ...blocks.slice(0, selIdx),
            defaultBlock(name, newBase),
            ...blocks.slice(selIdx),
        ];

        // Shrink the previous block if it would overlap the new one.
        if (selIdx > 0) {
            const prevBlock = newBlocks[selIdx - 1];
            const prevBase = prevBlock.base_address ?? prevBlock.offset ?? 0;
            const prevRegisters = prevBlock.registers ?? [];
            const prevSize =
                prevRegisters.length > 0
                    ? prevRegisters.length * 4
                    : (prevBlock.size ?? prevBlock.range ?? 4);
            const prevEnd =
                prevBase + (typeof prevSize === "number" ? prevSize : 4) - 1;

            if (prevEnd >= newBase) {
                const newPrevSize = newBase - prevBase;
                if (newPrevSize <= 0) {
                    return {
                        items: blocks,
                        newIndex: -1,
                        error: "Cannot insert before: insufficient space, previous block would have zero or negative size",
                    };
                }
                newBlocks[selIdx - 1] = { ...prevBlock, size: newPrevSize };
            }
        }

        newBlocks = repackBlocksBackward(
            newBlocks,
            selIdx - 1 >= 0 ? selIdx - 1 : 0,
        );
        newBlocks = sortBlocksByBase(newBlocks);

        const newIndex = newBlocks.findIndex((b) => b.name === name);
        return { items: newBlocks, newIndex };
    }
}
