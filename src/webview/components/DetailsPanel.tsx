import React, {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  VSCodeDropdown,
  VSCodeOption,
  VSCodeTextField,
  VSCodeTextArea,
} from "@vscode/webview-ui-toolkit/react";
import { Register } from "../types/memoryMap";
import BitFieldVisualizer from "./BitFieldVisualizer";
import AddressMapVisualizer from "./AddressMapVisualizer";
import RegisterMapVisualizer from "./RegisterMapVisualizer";
import {
  FIELD_COLORS,
  FIELD_COLOR_KEYS,
  getFieldColor,
} from "../shared/colors";
import { KeyboardShortcutsButton } from "../shared/components";
import {
  parseBitsRange,
  formatBits,
  repackFieldsFrom,
  repackFieldsForward,
  repackFieldsBackward,
} from "../algorithms/BitFieldRepacker";
import {
  repackBlocksForward,
  repackBlocksBackward,
} from "../algorithms/AddressBlockRepacker";
import {
  repackRegistersForward,
  repackRegistersBackward,
} from "../algorithms/RegisterRepacker";

/**
 * Calculate block size based on registers and register arrays
 * For regular registers: 4 bytes per register
 * For register arrays: count * stride bytes
 * Falls back to explicit size if no registers
 */
function calculateBlockSize(block: any): number {
  const registers = block?.registers || [];
  if (registers.length === 0) {
    return block?.size ?? block?.range ?? 4;
  }

  let totalSize = 0;
  for (const reg of registers) {
    if (reg.__kind === "array") {
      // Register array: size = count * stride
      const count = reg.count || 1;
      const stride = reg.stride || 4;
      totalSize += count * stride;
    } else {
      // Regular register: 4 bytes
      totalSize += 4;
    }
  }
  return totalSize;
}

interface DetailsPanelProps {
  selectedType: "memoryMap" | "block" | "register" | "array" | null;
  selectedObject: any;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
  onUpdate: (path: Array<string | number>, value: any) => void;
  onNavigateToRegister?: (regIndex: number) => void;
  onNavigateToBlock?: (blockIndex: number) => void;
}

export type DetailsPanelHandle = {
  focus: () => void;
};

const ACCESS_OPTIONS = [
  "read-only",
  "write-only",
  "read-write",
  "write-1-to-clear",
  "read-write-1-to-clear",
];

type EditKey = "name" | "bits" | "access" | "reset" | "description";

type ActiveCell = { rowIndex: number; key: EditKey };

const COLUMN_ORDER: EditKey[] = [
  "name",
  "bits",
  "access",
  "reset",
  "description",
];

type BlockEditKey = "name" | "base" | "size" | "usage" | "description";
type BlockActiveCell = { rowIndex: number; key: BlockEditKey };
const BLOCK_COLUMN_ORDER: BlockEditKey[] = [
  "name",
  "base",
  "size",
  "usage",
  "description",
];

type RegEditKey = "name" | "offset" | "access" | "description";
type RegActiveCell = { rowIndex: number; key: RegEditKey };
const REG_COLUMN_ORDER: RegEditKey[] = [
  "name",
  "offset",
  "access",
  "description",
];

const DetailsPanel = React.forwardRef<DetailsPanelHandle, DetailsPanelProps>(
  (props, ref) => {
    const {
      selectedType: rawSelectedType,
      selectedObject: rawSelectedObject,
      selectionMeta: rawSelectionMeta, // eslint-disable-line @typescript-eslint/no-unused-vars
      onUpdate: rawOnUpdate,
      onNavigateToRegister,
      onNavigateToBlock,
    } = props;

    // Derived State for Array Elements (e.g. TIMER[0])
    // If selecting a specific element of an array, we want to show it as a Register (if single) or Block (if multiple).
    let selectedType = rawSelectedType;
    let selectedObject = rawSelectedObject;
    let selectionMeta = rawSelectionMeta;
    let onUpdate = rawOnUpdate;

    if (
      rawSelectedType === "array" &&
      (rawSelectedObject as any)?.__element_index !== undefined
    ) {
      const arr = rawSelectedObject as any;
      const registers = arr.registers || [];

      if (registers.length === 1) {
        // Single Register: Masquerade as a single Register View
        selectedType = "register";
        selectedObject = registers[0]; // The template register

        // Adjust absolute address base to the element's base address
        if (arr.__element_base !== undefined) {
          selectionMeta = {
            ...(rawSelectionMeta || {}),
            absoluteAddress: arr.__element_base,
          };
        }

        // Redirect updates: The view will update 'name', 'description' of selectedObject.
        // We need to map this to ['registers', 0, 'property'] on the Array object.
        onUpdate = (path: any[], value: any) => {
          rawOnUpdate(["registers", 0, ...path], value);
        };
      } else {
        // Multiple Registers: Masquerade as a Block View
        selectedType = "block";
        selectedObject = arr; // Default to array

        if (arr.__element_base !== undefined) {
          // Inject base_address for correct visualizer/header display
          selectedObject = { ...arr, base_address: arr.__element_base };
          selectionMeta = {
            ...(rawSelectionMeta || {}),
            absoluteAddress: arr.__element_base,
          };
        }

        // Updates to ['registers', idx, prop] work natively on the Array object
      }
    }
    const [offsetText, setOffsetText] = useState<string>("");
    const [selectedFieldIndex, setSelectedFieldIndex] = useState<number>(-1);
    const [hoveredFieldIndex, setHoveredFieldIndex] = useState<number | null>(
      null,
    );
    const [selectedEditKey, setSelectedEditKey] = useState<EditKey>("name");
    const [activeCell, setActiveCell] = useState<ActiveCell>({
      rowIndex: -1,
      key: "name",
    });
    const [blockActiveCell, setBlockActiveCell] = useState<BlockActiveCell>({
      rowIndex: -1,
      key: "name",
    });
    const [regActiveCell, setRegActiveCell] = useState<RegActiveCell>({
      rowIndex: -1,
      key: "name",
    });
    // Use unique key per register (e.g. blockIdx-regIdx or field name)
    const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
    const [nameErrors, setNameErrors] = useState<Record<string, string | null>>(
      {},
    );
    const [bitsDrafts, setBitsDrafts] = useState<Record<number, string>>({});
    const [bitsErrors, setBitsErrors] = useState<Record<number, string | null>>(
      {},
    );
    // Track preview bit ranges during Ctrl+drag operations
    const [dragPreviewRanges, setDragPreviewRanges] = useState<
      Record<number, [number, number]>
    >({});

    // Helper: get bit width from [N:M] or [N]
    const parseBitsWidth = (bits: string): number | null => {
      const match = bits.trim().match(/^\[(\d+)(?::(\d+))?\]$/);
      if (!match) {
        return null;
      }
      const n = parseInt(match[1], 10);
      const m = match[2] ? parseInt(match[2], 10) : n;
      return Math.abs(n - m) + 1;
    };
    // Validate bits string: must be [N:M] or [N], N, M >= 0, N >= M
    const validateBitsString = (bits: string): string | null => {
      const trimmed = bits.trim();
      if (!/^\[\d+(?::\d+)?\]$/.test(trimmed)) {
        return "Format must be [N:M] or [N]";
      }
      const match = trimmed.match(/\[(\d+)(?::(\d+))?\]/);
      if (!match) {
        return "Invalid format";
      }
      const n = parseInt(match[1], 10);
      const m = match[2] ? parseInt(match[2], 10) : n;
      if (n < 0 || m < 0) {
        return "Bit indices must be >= 0";
      }
      if (n < m) {
        return "MSB must be >= LSB";
      }
      return null;
    };
    const [resetDrafts, setResetDrafts] = useState<Record<number, string>>({});
    const [resetErrors, setResetErrors] = useState<
      Record<number, string | null>
    >({});
    // Insert error states for vim-style insertion
    const [fieldsInsertError, setFieldsInsertError] = useState<string | null>(
      null,
    );
    const [blocksInsertError, setBlocksInsertError] = useState<string | null>(
      null,
    );
    const [regsInsertError, setRegsInsertError] = useState<string | null>(null);
    // Memory map states
    const [selectedBlockIndex, setSelectedBlockIndex] = useState<number>(-1);
    const [hoveredBlockIndex, setHoveredBlockIndex] = useState<number | null>(
      null,
    );
    // Address block states
    const [selectedRegIndex, setSelectedRegIndex] = useState<number>(-1);
    const [hoveredRegIndex, setHoveredRegIndex] = useState<number | null>(null);
    const fieldsFocusRef = useRef<HTMLDivElement | null>(null);
    const blocksFocusRef = useRef<HTMLDivElement | null>(null);
    const regsFocusRef = useRef<HTMLDivElement | null>(null);
    const fieldsErrorRef = useRef<HTMLDivElement | null>(null);
    const blocksErrorRef = useRef<HTMLDivElement | null>(null);
    const regsErrorRef = useRef<HTMLDivElement | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          if (selectedType === "register") {
            fieldsFocusRef.current?.focus();
            return;
          }
          if (selectedType === "memoryMap") {
            blocksFocusRef.current?.focus();
            return;
          }
          if (selectedType === "block") {
            regsFocusRef.current?.focus();
            return;
          }
          // Fallback: focus whichever exists.
          fieldsFocusRef.current?.focus();
          blocksFocusRef.current?.focus();
          regsFocusRef.current?.focus();
        },
      }),
      [selectedType],
    );

    const refocusFieldsTableSoon = () => {
      window.setTimeout(() => {
        fieldsFocusRef.current?.focus();
      }, 0);
    };

    const refocusBlocksTableSoon = () => {
      window.setTimeout(() => {
        blocksFocusRef.current?.focus();
      }, 0);
    };

    const refocusRegsTableSoon = () => {
      window.setTimeout(() => {
        regsFocusRef.current?.focus();
      }, 0);
    };

    const isRegister = selectedType === "register" && !!selectedObject;
    const reg = isRegister ? (selectedObject as Register) : null;
    // Normalize fields for BitFieldVisualizer: always provide bit/bit_range
    const fields = useMemo(() => {
      if (!reg?.fields) {
        return [];
      }
      return reg.fields.map((f: any) => {
        if (f.bit_range) {
          return f;
        }
        if (f.bit_offset !== undefined && f.bit_width !== undefined) {
          const lo = Number(f.bit_offset);
          const width = Number(f.bit_width);
          const hi = lo + width - 1;
          return { ...f, bit_range: [hi, lo] };
        }
        if (f.bit !== undefined) {
          return f;
        }
        return f;
      });
    }, [reg?.fields]);

    // Only shift focus into this panel when explicitly requested (e.g. Outline Enter/Right/l).
    useEffect(() => {
      if (!selectionMeta?.focusDetails) {
        return;
      }
      const id = window.setTimeout(() => {
        if (selectedType === "register") {
          fieldsFocusRef.current?.focus();
        }
        if (selectedType === "memoryMap") {
          blocksFocusRef.current?.focus();
        }
        if (selectedType === "block") {
          regsFocusRef.current?.focus();
        }
      }, 0);
      return () => window.clearTimeout(id);
    }, [selectionMeta?.focusDetails, selectedType, selectedObject?.name]);

    const focusFieldEditor = (rowIndex: number, key: EditKey) => {
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
    };

    // Escape should return focus from an inline editor back to its table container.
    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key !== "Escape") {
          return;
        }

        const activeEl = document.activeElement as HTMLElement | null;
        if (!activeEl) {
          return;
        }

        const inFields =
          !!fieldsFocusRef.current &&
          fieldsFocusRef.current.contains(activeEl) &&
          activeEl !== fieldsFocusRef.current;
        const inBlocks =
          !!blocksFocusRef.current &&
          blocksFocusRef.current.contains(activeEl) &&
          activeEl !== blocksFocusRef.current;
        const inRegs =
          !!regsFocusRef.current &&
          regsFocusRef.current.contains(activeEl) &&
          activeEl !== regsFocusRef.current;
        if (!inFields && !inBlocks && !inRegs) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        try {
          (activeEl as any).blur?.();
        } catch {
          // ignore
        }
        if (inFields) {
          refocusFieldsTableSoon();
        }
        if (inBlocks) {
          refocusBlocksTableSoon();
        }
        if (inRegs) {
          refocusRegsTableSoon();
        }
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    // Keyboard shortcuts (when the fields table is focused):
    // - Arrow keys: move between cells
    // - Vim keys: h/j/k/l move between cells
    // - Alt+ArrowUp / Alt+ArrowDown: move selected field (repack offsets)
    // - F2 or e: edit active cell
    // --- Bit Field Table: Keyboard Shortcuts (including o/O insert) ---
    useEffect(() => {
      if (!isRegister) {
        return;
      }

      // Helper to get bits string for a field
      const toBits = (f: any) => {
        const o = Number(f?.bit_offset ?? 0);
        const w = Number(f?.bit_width ?? 1);
        if (!Number.isFinite(o) || !Number.isFinite(w)) {
          return "[?:?]";
        }
        const msb = o + w - 1;
        return `[${msb}:${o}]`;
      };

      const getNextFieldName = () => {
        // Find max fieldN
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
        setFieldsInsertError(null);
        const regSize = reg?.size || 32;
        const newFieldWidth = 1; // Default 1-bit field

        // CASE 1: Empty register - place at LSB
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

        // Get selected field or use last field
        const selIdx =
          selectedFieldIndex >= 0 ? selectedFieldIndex : fields.length - 1;
        const selected = fields[selIdx];
        const selectedBits = parseBitsRange(toBits(selected));
        if (!selectedBits) {
          setFieldsInsertError("Cannot determine selected field position");
          return;
        }

        const [selectedMsb, selectedLsb] = selectedBits;

        if (after) {
          // INSERT AFTER: new field goes to lower bits (MSB = selectedMsb + 1)
          const newMsb = selectedMsb + 1;
          const newLsb = newMsb - newFieldWidth + 1;

          // Check if new field fits within register
          if (newLsb < 0 || newMsb >= regSize) {
            setFieldsInsertError(
              `Cannot insert after: would place field at [${newMsb}:${newLsb}], outside register bounds`,
            );
            window.setTimeout(
              () =>
                fieldsErrorRef.current?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                }),
              0,
            );
            return;
          }

          // Check if any existing field overlaps with the new field position
          for (const f of fields) {
            if (f === selected) {
              continue;
            } // Skip the selected field itself
            const bits = parseBitsRange(toBits(f));
            if (!bits) {
              continue;
            }
            const [fMsb, fLsb] = bits;
            // Check if field f overlaps with the range [newMsb:newLsb]
            // Overlap occurs if: (fLsb <= newMsb && fMsb >= newLsb)
            if (fLsb <= newMsb && fMsb >= newLsb) {
              setFieldsInsertError(
                `Cannot insert: bits [${newMsb}:${newLsb}] already occupied by ${f.name}`,
              );
              window.setTimeout(
                () =>
                  fieldsErrorRef.current?.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                  }),
                0,
              );
              return;
            }
          }

          // Create new field
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

          // Insert after selected field in array
          let newFields = [
            ...fields.slice(0, selIdx + 1),
            newField,
            ...fields.slice(selIdx + 1),
          ];

          // Repack subsequent fields forward (toward MSB)
          newFields = repackFieldsForward(newFields, selIdx + 2, regSize);

          // Sort by LSB ascending to maintain array order (bit 0 first)
          newFields.sort((a, b) => {
            const aBits = parseBitsRange(toBits(a));
            const bBits = parseBitsRange(toBits(b));
            if (!aBits || !bBits) {
              return 0;
            }
            return aBits[1] - bBits[1]; // LSB ascending
          });

          // Find new index after sort
          const newIdx = newFields.findIndex((f) => f.name === name);

          // Check for overflow after repacking
          let minLsb = Infinity;
          for (const f of newFields) {
            const bits = parseBitsRange(toBits(f));
            if (bits) {
              minLsb = Math.min(minLsb, bits[1]);
            }
          }
          if (minLsb < 0) {
            setFieldsInsertError(
              "Cannot insert: not enough space for repacking",
            );
            window.setTimeout(
              () =>
                fieldsErrorRef.current?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                }),
              0,
            );
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
          // INSERT BEFORE: new field goes to higher bits (LSB = selectedLsb - 1)
          const newLsb = selectedLsb - 1;
          const newMsb = newLsb + newFieldWidth - 1;

          // Check if new field fits within register
          if (newLsb < 0 || newMsb >= regSize) {
            setFieldsInsertError(
              `Cannot insert before: would place field at [${newMsb}:${newLsb}], outside register bounds`,
            );
            window.setTimeout(
              () =>
                fieldsErrorRef.current?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                }),
              0,
            );
            return;
          }

          // Check if any existing field overlaps with the new field position
          for (const f of fields) {
            if (f === selected) {
              continue;
            } // Skip the selected field itself
            const bits = parseBitsRange(toBits(f));
            if (!bits) {
              continue;
            }
            const [fMsb, fLsb] = bits;
            // Check if field f overlaps with the range [newMsb:newLsb]
            // Overlap occurs if: (fLsb <= newMsb && fMsb >= newLsb)
            if (fLsb <= newMsb && fMsb >= newLsb) {
              setFieldsInsertError(
                `Cannot insert: bits [${newMsb}:${newLsb}] already occupied by ${f.name}`,
              );
              window.setTimeout(
                () =>
                  fieldsErrorRef.current?.scrollIntoView({
                    block: "nearest",
                    behavior: "smooth",
                  }),
                0,
              );
              return;
            }
          }

          // Create new field
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

          // Insert before selected field in array
          let newFields = [
            ...fields.slice(0, selIdx),
            newField,
            ...fields.slice(selIdx),
          ];

          // Repack previous fields backward (toward LSB)
          newFields = repackFieldsBackward(
            newFields,
            selIdx - 1 >= 0 ? selIdx - 1 : 0,
            regSize,
          );

          // Sort by LSB ascending to maintain array order (bit 0 first)
          newFields.sort((a, b) => {
            const aBits = parseBitsRange(toBits(a));
            const bBits = parseBitsRange(toBits(b));
            if (!aBits || !bBits) {
              return 0;
            }
            return aBits[1] - bBits[1]; // LSB ascending
          });

          // Find new index after sort
          const newIdx = newFields.findIndex((f) => f.name === name);

          // Check for overflow after repacking
          let maxMsb = -Infinity;
          for (const f of newFields) {
            const bits = parseBitsRange(toBits(f));
            if (bits) {
              maxMsb = Math.max(maxMsb, bits[0]);
            }
          }
          if (maxMsb >= regSize) {
            setFieldsInsertError(
              "Cannot insert: not enough space for repacking",
            );
            window.setTimeout(
              () =>
                fieldsErrorRef.current?.scrollIntoView({
                  block: "nearest",
                  behavior: "smooth",
                }),
              0,
            );
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
        // Fix for Mac Option+Vim keys producing special chars
        if (e.altKey && e.code) {
          if (e.code === "KeyH") {
            keyLower = "h";
          }
          if (e.code === "KeyJ") {
            keyLower = "j";
          }
          if (e.code === "KeyK") {
            keyLower = "k";
          }
          if (e.code === "KeyL") {
            keyLower = "l";
          }
        }
        const vimToArrow: Record<
          string,
          "ArrowLeft" | "ArrowDown" | "ArrowUp" | "ArrowRight"
        > = {
          h: "ArrowLeft",
          j: "ArrowDown",
          k: "ArrowUp",
          l: "ArrowRight",
        };

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

        // Avoid hijacking common editor chords.
        if (e.ctrlKey || e.metaKey) {
          return;
        }

        const activeEl = document.activeElement as HTMLElement | null;
        const isInFieldsArea =
          !!fieldsFocusRef.current &&
          !!activeEl &&
          (activeEl === fieldsFocusRef.current ||
            fieldsFocusRef.current.contains(activeEl));
        if (!isInFieldsArea) {
          return;
        }

        const target = e.target as HTMLElement | null;
        const isInDropdown = !!target?.closest("vscode-dropdown");
        const isTypingTarget = !!target?.closest(
          'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area',
        );
        // Don't steal arrow keys while editing/typing, but allow vim keys in dropdown
        if (isTypingTarget) {
          return;
        }
        // In dropdown, allow vim keys but not raw arrow keys (dropdown needs those for navigation)
        if (isInDropdown && !keyLower.match(/^[hjkl]$/)) {
          return;
        }

        const scrollToCell = (rowIndex: number, key: EditKey) => {
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-field-idx="${rowIndex}"]`,
            );
            // For first element, scroll to center to ensure it's fully visible below sticky headers
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
          // Remove the field at currentRow and ensure fields is a valid array
          const newFields = fields.filter((_, idx) => idx !== currentRow);
          onUpdate(["fields"], newFields);
          // Move selection to previous or next field
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

        // Alt+Arrow moves fields.
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
          onUpdate(["__op", "field-move"], {
            index: selectedFieldIndex,
            delta,
          });

          // Clear draft states to force display of fresh normalized values
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

        // Plain arrows navigate cells.
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
    }, [
      isRegister,
      fields.length,
      selectedFieldIndex,
      selectedEditKey,
      activeCell,
      onUpdate,
    ]);

    // Keyboard shortcuts for Memory Map blocks table (when focused):
    // - Arrow keys or Vim h/j/k/l to move active cell
    // - F2 or e focuses the editor for the active cell
    // --- Address Block Table: Keyboard Shortcuts (including o/O insert) ---
    useEffect(() => {
      if (selectedType !== "memoryMap") {
        return;
      }

      const blocks =
        selectedObject?.address_blocks || selectedObject?.addressBlocks || [];

      const getNextBlockName = () => {
        let maxN = 0;
        for (const b of blocks) {
          const m = String(b.name || "").match(/^block(\d+)$/);
          if (m) {
            maxN = Math.max(maxN, parseInt(m[1], 10));
          }
        }
        return `block${maxN + 1}`;
      };

      const tryInsertBlock = (after: boolean) => {
        setBlocksInsertError(null);

        // CASE 1: Empty memory map - place at base address 0
        if (blocks.length === 0) {
          const name = getNextBlockName();
          const newBlock = {
            name,
            base_address: 0,
            size: 4, // Size of 1 register (32-bit = 4 bytes)
            usage: "register",
            description: "",
            registers: [
              {
                name: "reg0",
                address_offset: 0,
                offset: 0,
                access: "read-write",
                description: "",
                fields: [
                  {
                    name: "data",
                    bits: "[31:0]",
                    access: "read-write",
                    description: "",
                  },
                ],
              },
            ],
          };
          onUpdate(["addressBlocks"], [newBlock]);
          setSelectedBlockIndex(0);
          setHoveredBlockIndex(0);
          setBlockActiveCell({ rowIndex: 0, key: "name" });
          window.setTimeout(() => {
            const row = document.querySelector(`tr[data-block-idx="0"]`);
            row?.scrollIntoView({ block: "center" });
          }, 100);
          return;
        }

        // Get selected block or use last block
        const selIdx =
          selectedBlockIndex >= 0 ? selectedBlockIndex : blocks.length - 1;
        const selected = blocks[selIdx];
        const selectedBase = selected.base_address ?? selected.offset ?? 0;

        // Calculate size based on registers (4 bytes per register)
        const selectedRegisters = selected.registers || [];
        const selectedSize =
          selectedRegisters.length > 0
            ? selectedRegisters.length * 4
            : (selected.size ?? selected.range ?? 4);

        if (after) {
          // INSERT AFTER: new block goes to higher address (base = selected.base + calculated size)
          const newBase = selectedBase + selectedSize;

          const name = getNextBlockName();
          const newBlock = {
            name,
            base_address: newBase,
            size: 4, // Size of 1 register (32-bit = 4 bytes)
            usage: "register",
            description: "",
            registers: [
              {
                name: "reg0",
                address_offset: 0,
                offset: 0,
                access: "read-write",
                description: "",
                fields: [
                  {
                    name: "data",
                    bits: "[31:0]",
                    access: "read-write",
                    description: "",
                  },
                ],
              },
            ],
          };

          // Insert after selected block in array
          let newBlocks = [
            ...blocks.slice(0, selIdx + 1),
            newBlock,
            ...blocks.slice(selIdx + 1),
          ];

          // Repack subsequent blocks forward (toward higher addresses)
          newBlocks = repackBlocksForward(newBlocks, selIdx + 2);

          // Sort by base address ascending
          newBlocks.sort((a, b) => {
            const aBase = a.base_address ?? a.offset ?? 0;
            const bBase = b.base_address ?? b.offset ?? 0;
            return aBase - bBase;
          });

          // Find new index after sort
          const newIdx = newBlocks.findIndex((b) => b.name === name);

          onUpdate(["addressBlocks"], newBlocks);
          setSelectedBlockIndex(newIdx);
          setHoveredBlockIndex(newIdx);
          setBlockActiveCell({ rowIndex: newIdx, key: "name" });
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-block-idx="${newIdx}"]`,
            );
            row?.scrollIntoView({ block: "center" });
          }, 100);
        } else {
          // INSERT BEFORE: new block goes to lower address (end = selected.base - 1)
          const newSize = 4; // Size of 1 register (32-bit = 4 bytes)
          const newEnd = selectedBase - 1;
          const newBase = Math.max(0, newEnd - newSize + 1);

          // Check if we have room
          if (newBase < 0) {
            setBlocksInsertError(
              "Cannot insert before: not enough address space",
            );
            return;
          }

          const name = getNextBlockName();
          const newBlock = {
            name,
            base_address: newBase,
            size: newSize,
            usage: "register",
            description: "",
            registers: [
              {
                name: "reg0",
                address_offset: 0,
                offset: 0,
                access: "read-write",
                description: "",
                fields: [
                  {
                    name: "data",
                    bits: "[31:0]",
                    access: "read-write",
                    description: "",
                  },
                ],
              },
            ],
          };

          // Insert before selected block in array
          let newBlocks = [
            ...blocks.slice(0, selIdx),
            newBlock,
            ...blocks.slice(selIdx),
          ];

          // Repack previous blocks backward (toward lower addresses)
          // Need to resize or shift blocks if there's overlap
          // For simplicity with auto-resize: check if previous block needs to be resized
          if (selIdx > 0) {
            const prevBlock = newBlocks[selIdx - 1];
            const prevBase = prevBlock.base_address ?? prevBlock.offset ?? 0;

            // Calculate previous block size based on registers
            const prevRegisters = prevBlock.registers || [];
            const prevSize =
              prevRegisters.length > 0
                ? prevRegisters.length * 4
                : (prevBlock.size ?? prevBlock.range ?? 4);
            const prevEnd = prevBase + prevSize - 1;

            // Check if previous block overlaps with new block
            if (prevEnd >= newBase) {
              // Auto-resize previous block to fit
              const newPrevSize = newBase - prevBase;
              if (newPrevSize <= 0) {
                setBlocksInsertError(
                  "Cannot insert before: insufficient space, previous block would have zero or negative size",
                );
                return;
              }
              newBlocks[selIdx - 1] = {
                ...prevBlock,
                size: newPrevSize,
              };
            }
          }

          // Repack blocks backward if needed
          newBlocks = repackBlocksBackward(
            newBlocks,
            selIdx - 1 >= 0 ? selIdx - 1 : 0,
          );

          // Sort by base address ascending
          newBlocks.sort((a, b) => {
            const aBase = a.base_address ?? a.offset ?? 0;
            const bBase = b.base_address ?? b.offset ?? 0;
            return aBase - bBase;
          });

          // Find new index after sort
          const newIdx = newBlocks.findIndex((b) => b.name === name);

          onUpdate(["addressBlocks"], newBlocks);
          setSelectedBlockIndex(newIdx);
          setHoveredBlockIndex(newIdx);
          setBlockActiveCell({ rowIndex: newIdx, key: "name" });
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-block-idx="${newIdx}"]`,
            );
            row?.scrollIntoView({ block: "center" });
          }, 100);
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        let keyLower = (e.key || "").toLowerCase();
        // Fix for Mac Option+Vim keys producing special chars
        if (e.altKey && e.code) {
          if (e.code === "KeyH") {
            keyLower = "h";
          }
          if (e.code === "KeyJ") {
            keyLower = "j";
          }
          if (e.code === "KeyK") {
            keyLower = "k";
          }
          if (e.code === "KeyL") {
            keyLower = "l";
          }
        }
        const vimToArrow: Record<
          string,
          "ArrowLeft" | "ArrowDown" | "ArrowUp" | "ArrowRight"
        > = {
          h: "ArrowLeft",
          j: "ArrowDown",
          k: "ArrowUp",
          l: "ArrowRight",
        };

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
        const isInBlocksArea =
          !!blocksFocusRef.current &&
          !!activeEl &&
          (activeEl === blocksFocusRef.current ||
            blocksFocusRef.current.contains(activeEl));
        if (!isInBlocksArea) {
          return;
        }

        const target = e.target as HTMLElement | null;
        const isTypingTarget = !!target?.closest(
          'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown',
        );
        if (isTypingTarget) {
          return;
        }

        const scrollToCell = (rowIndex: number, key: BlockEditKey) => {
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-block-idx="${rowIndex}"]`,
            );
            row?.scrollIntoView({ block: "nearest" });
            const cell = row?.querySelector(
              `td[data-col-key="${key}"]`,
            ) as HTMLElement | null;
            cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }, 0);
        };

        const focusEditor = (rowIndex: number, key: BlockEditKey) => {
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-block-idx="${rowIndex}"]`,
            );
            const editor = row?.querySelector(
              `[data-edit-key="${key}"]`,
            ) as HTMLElement | null;
            editor?.focus?.();
          }, 0);
        };

        const currentRow =
          blockActiveCell.rowIndex >= 0
            ? blockActiveCell.rowIndex
            : selectedBlockIndex >= 0
              ? selectedBlockIndex
              : 0;
        const currentKey: BlockEditKey = BLOCK_COLUMN_ORDER.includes(
          blockActiveCell.key,
        )
          ? blockActiveCell.key
          : "name";

        if (isEdit) {
          if (currentRow < 0 || currentRow >= blocks.length) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          setSelectedBlockIndex(currentRow);
          setHoveredBlockIndex(currentRow);
          setBlockActiveCell({ rowIndex: currentRow, key: currentKey });
          focusEditor(currentRow, currentKey);
          return;
        }

        if (isInsertAfter || isInsertBefore) {
          e.preventDefault();
          e.stopPropagation();
          tryInsertBlock(isInsertAfter);
          return;
        }
        if (isDelete) {
          if (currentRow < 0 || currentRow >= blocks.length) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          // Remove the block at currentRow and ensure addressBlocks is a valid array
          const newBlocks = blocks.filter(
            (_: any, idx: number) => idx !== currentRow,
          );
          onUpdate(["addressBlocks"], newBlocks);
          // Move selection to previous or next block
          const nextRow =
            currentRow > 0 ? currentRow - 1 : newBlocks.length > 0 ? 0 : -1;
          setSelectedBlockIndex(nextRow);
          setHoveredBlockIndex(nextRow);
          setBlockActiveCell({ rowIndex: nextRow, key: currentKey });
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        // Can't navigate if there are no blocks yet
        if (blocks.length === 0) {
          return;
        }

        const isVertical =
          normalizedKey === "ArrowUp" || normalizedKey === "ArrowDown";
        const delta =
          normalizedKey === "ArrowUp" || normalizedKey === "ArrowLeft" ? -1 : 1;

        if (isVertical) {
          const nextRow = Math.max(
            0,
            Math.min(blocks.length - 1, currentRow + delta),
          );
          setSelectedBlockIndex(nextRow);
          setHoveredBlockIndex(nextRow);
          setBlockActiveCell({ rowIndex: nextRow, key: currentKey });
          scrollToCell(nextRow, currentKey);
          return;
        }

        const currentCol = Math.max(0, BLOCK_COLUMN_ORDER.indexOf(currentKey));
        const nextCol = Math.max(
          0,
          Math.min(BLOCK_COLUMN_ORDER.length - 1, currentCol + delta),
        );
        const nextKey = BLOCK_COLUMN_ORDER[nextCol] ?? "name";
        setSelectedBlockIndex(currentRow);
        setHoveredBlockIndex(currentRow);
        setBlockActiveCell({ rowIndex: currentRow, key: nextKey });
        scrollToCell(currentRow, nextKey);
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [
      selectedType,
      selectedObject,
      selectedBlockIndex,
      hoveredBlockIndex,
      blockActiveCell,
    ]);

    // Keyboard shortcuts for Address Block registers table (when focused):
    // - Arrow keys or Vim h/j/k/l to move active cell
    // - F2 or e focuses the editor for the active cell
    // --- Registers Table: Keyboard Shortcuts (including o/O insert) ---
    useEffect(() => {
      if (selectedType !== "block") {
        return;
      }

      const registers = selectedObject?.registers || [];

      const getNextRegName = () => {
        let maxN = 0;
        for (const r of registers) {
          const m = String(r.name || "").match(/^reg(\d+)$/);
          if (m) {
            maxN = Math.max(maxN, parseInt(m[1], 10));
          }
        }
        return `reg${maxN + 1}`;
      };

      const tryInsertReg = (after: boolean) => {
        setRegsInsertError(null);

        // CASE 1: Empty block - place at offset 0x00
        if (registers.length === 0) {
          const name = getNextRegName();
          const newReg = {
            name,
            address_offset: 0,
            offset: 0,
            access: "read-write",
            description: "",
          };
          onUpdate(["registers"], [newReg]);
          setSelectedRegIndex(0);
          setHoveredRegIndex(0);
          setRegActiveCell({ rowIndex: 0, key: "name" });
          window.setTimeout(() => {
            const row = document.querySelector(`tr[data-reg-idx="0"]`);
            row?.scrollIntoView({ block: "center" });
          }, 100);
          return;
        }

        // Get selected register or use last register
        const selIdx =
          selectedRegIndex >= 0 ? selectedRegIndex : registers.length - 1;
        const selected = registers[selIdx];
        const selectedOffset = selected.address_offset ?? selected.offset ?? 0;

        if (after) {
          // INSERT AFTER: new register goes after selected item
          // If selected is an array, offset = array.offset + (count * stride)
          // If selected is a register, offset = reg.offset + 4
          let selectedSize = 4; // Default register size
          if ((selected as any).__kind === "array") {
            const arrCount = (selected as any).count || 1;
            const arrStride = (selected as any).stride || 4;
            selectedSize = arrCount * arrStride;
          }
          const newOffset = selectedOffset + selectedSize;

          const name = getNextRegName();
          const newReg = {
            name,
            address_offset: newOffset,
            offset: newOffset,
            access: "read-write",
            description: "",
          };

          // Insert after selected register in array
          let newRegs = [
            ...registers.slice(0, selIdx + 1),
            newReg,
            ...registers.slice(selIdx + 1),
          ];

          // Repack subsequent registers forward (toward higher offsets)
          newRegs = repackRegistersForward(newRegs, selIdx + 2);

          // Sort by offset ascending
          newRegs.sort((a, b) => {
            const aOffset = a.address_offset ?? a.offset ?? 0;
            const bOffset = b.address_offset ?? b.offset ?? 0;
            return aOffset - bOffset;
          });

          // Find new index after sort
          const newIdx = newRegs.findIndex((r) => r.name === name);

          onUpdate(["registers"], newRegs);
          setSelectedRegIndex(newIdx);
          setHoveredRegIndex(newIdx);
          setRegActiveCell({ rowIndex: newIdx, key: "name" });
          window.setTimeout(() => {
            const row = document.querySelector(`tr[data-reg-idx="${newIdx}"]`);
            row?.scrollIntoView({ block: "center" });
          }, 100);
        } else {
          // INSERT BEFORE: new register goes to lower offset (offset = selected.offset - 4)
          const newOffset = selectedOffset - 4;

          // Check if we have room
          if (newOffset < 0) {
            setRegsInsertError(
              "Cannot insert before: offset would be negative",
            );
            return;
          }

          const name = getNextRegName();
          const newReg = {
            name,
            address_offset: newOffset,
            offset: newOffset,
            access: "read-write",
            description: "",
          };

          // Insert before selected register in array
          let newRegs = [
            ...registers.slice(0, selIdx),
            newReg,
            ...registers.slice(selIdx),
          ];

          // Repack previous registers backward (toward lower offsets)
          newRegs = repackRegistersBackward(
            newRegs,
            selIdx - 1 >= 0 ? selIdx - 1 : 0,
          );

          // Sort by offset ascending
          newRegs.sort((a, b) => {
            const aOffset = a.address_offset ?? a.offset ?? 0;
            const bOffset = b.address_offset ?? b.offset ?? 0;
            return aOffset - bOffset;
          });

          // Find new index after sort
          const newIdx = newRegs.findIndex((r) => r.name === name);

          // Check for negative offsets after repacking
          for (const r of newRegs) {
            const rOffset = r.address_offset ?? r.offset ?? 0;
            if (rOffset < 0) {
              setRegsInsertError(
                "Cannot insert: not enough offset space for repacking",
              );
              return;
            }
          }

          onUpdate(["registers"], newRegs);
          setSelectedRegIndex(newIdx);
          setHoveredRegIndex(newIdx);
          setRegActiveCell({ rowIndex: newIdx, key: "name" });
          window.setTimeout(() => {
            const row = document.querySelector(`tr[data-reg-idx="${newIdx}"]`);
            row?.scrollIntoView({ block: "center" });
          }, 100);
        }
      };

      const onKeyDown = (e: KeyboardEvent) => {
        let keyLower = (e.key || "").toLowerCase();
        // Fix for Mac Option+Vim keys producing special chars
        if (e.altKey && e.code) {
          if (e.code === "KeyH") {
            keyLower = "h";
          }
          if (e.code === "KeyJ") {
            keyLower = "j";
          }
          if (e.code === "KeyK") {
            keyLower = "k";
          }
          if (e.code === "KeyL") {
            keyLower = "l";
          }
        }
        const vimToArrow: Record<
          string,
          "ArrowLeft" | "ArrowDown" | "ArrowUp" | "ArrowRight"
        > = {
          h: "ArrowLeft",
          j: "ArrowDown",
          k: "ArrowUp",
          l: "ArrowRight",
        };

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
        const isInsertArrayAfter = keyLower === "a" && e.shiftKey; // Shift+A to insert array after
        const isInsertArrayBefore = keyLower === "i" && e.shiftKey; // Shift+I to insert array before
        if (
          !isArrow &&
          !isEdit &&
          !isDelete &&
          !isInsertAfter &&
          !isInsertBefore &&
          !isInsertArrayAfter &&
          !isInsertArrayBefore
        ) {
          return;
        }

        if (e.ctrlKey || e.metaKey) {
          return;
        }

        const activeEl = document.activeElement as HTMLElement | null;
        const isInRegsArea =
          !!regsFocusRef.current &&
          !!activeEl &&
          (activeEl === regsFocusRef.current ||
            regsFocusRef.current.contains(activeEl));
        if (!isInRegsArea) {
          return;
        }

        const target = e.target as HTMLElement | null;
        const isTypingTarget = !!target?.closest(
          'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown',
        );
        if (isTypingTarget) {
          return;
        }

        const scrollToCell = (rowIndex: number, key: RegEditKey) => {
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-reg-idx="${rowIndex}"]`,
            );
            row?.scrollIntoView({ block: "nearest" });
            const cell = row?.querySelector(
              `td[data-col-key="${key}"]`,
            ) as HTMLElement | null;
            cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
          }, 0);
        };

        const focusEditor = (rowIndex: number, key: RegEditKey) => {
          window.setTimeout(() => {
            const row = document.querySelector(
              `tr[data-reg-idx="${rowIndex}"]`,
            );
            const editor = row?.querySelector(
              `[data-edit-key="${key}"]`,
            ) as HTMLElement | null;
            editor?.focus?.();
          }, 0);
        };

        const currentRow =
          regActiveCell.rowIndex >= 0
            ? regActiveCell.rowIndex
            : selectedRegIndex >= 0
              ? selectedRegIndex
              : 0;
        const currentKey: RegEditKey = REG_COLUMN_ORDER.includes(
          regActiveCell.key,
        )
          ? regActiveCell.key
          : "name";

        if (isEdit) {
          if (currentRow < 0 || currentRow >= registers.length) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          setSelectedRegIndex(currentRow);
          setHoveredRegIndex(currentRow);
          setRegActiveCell({ rowIndex: currentRow, key: currentKey });
          focusEditor(currentRow, currentKey);
          return;
        }

        if (isInsertAfter || isInsertBefore) {
          e.preventDefault();
          e.stopPropagation();
          tryInsertReg(isInsertAfter);
          return;
        }

        // Insert Register Array (Shift+A after, Shift+I before)
        if (isInsertArrayAfter || isInsertArrayBefore) {
          e.preventDefault();
          e.stopPropagation();

          // Generate unique array name
          let maxN = 0;
          for (const r of registers) {
            const match = r.name?.match(/^ARRAY_(\d+)$/i);
            if (match) {
              maxN = Math.max(maxN, parseInt(match[1], 10));
            }
          }
          const arrayName = `ARRAY_${maxN + 1}`;

          // Get offset for new array
          const selIdx =
            selectedRegIndex >= 0 ? selectedRegIndex : registers.length - 1;
          const selected = registers[selIdx];
          const selectedOffset =
            selected?.address_offset ?? selected?.offset ?? 0;

          // Calculate size of selected item for "after" insertion
          let selectedSize = 4;
          if ((selected as any)?.__kind === "array") {
            selectedSize =
              ((selected as any).count || 1) * ((selected as any).stride || 4);
          }

          // New array size (2 registers * 4 bytes stride = 8 bytes)
          const newArraySize = 8;

          // Determine offset based on insert direction
          // After: place after selected item (selected.offset + selected.size)
          // Before: take selected item's offset, push selected and subsequent forward
          const baseOffset = isInsertArrayAfter
            ? selectedOffset + selectedSize
            : selectedOffset;

          // Create new register array with default nested register
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
                fields: [
                  {
                    name: "data",
                    bits: "[31:0]",
                    access: "read-write",
                    description: "",
                  },
                ],
              },
            ],
          };

          // Insert after or before selected
          let newRegs;
          let newIdx;
          if (isInsertArrayAfter) {
            newRegs = [
              ...registers.slice(0, selIdx + 1),
              newArray,
              ...registers.slice(selIdx + 1),
            ];
            newIdx = selIdx + 1;
          } else {
            // Insert before: push selected and subsequent items forward
            newRegs = [
              ...registers.slice(0, selIdx),
              newArray,
              ...registers.slice(selIdx).map((r: any) => ({
                ...r,
                offset: (r.offset ?? r.address_offset ?? 0) + newArraySize,
                address_offset:
                  (r.address_offset ?? r.offset ?? 0) + newArraySize,
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
          if (currentRow < 0 || currentRow >= registers.length) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          // Remove the register at currentRow and ensure registers is a valid array
          const newRegs = registers.filter(
            (_: any, idx: number) => idx !== currentRow,
          );
          onUpdate(["registers"], newRegs);
          // Move selection to previous or next register
          const nextRow =
            currentRow > 0 ? currentRow - 1 : newRegs.length > 0 ? 0 : -1;
          setSelectedRegIndex(nextRow);
          setHoveredRegIndex(nextRow);
          setRegActiveCell({ rowIndex: nextRow, key: currentKey });
          return;
        }

        const isVertical =
          normalizedKey === "ArrowUp" || normalizedKey === "ArrowDown";
        const delta =
          normalizedKey === "ArrowUp" || normalizedKey === "ArrowLeft" ? -1 : 1;

        // Alt+Arrow moves registers (with offset recalculation)
        if (e.altKey && isVertical) {
          if (selectedRegIndex < 0) {
            return;
          }
          const next = selectedRegIndex + delta;
          if (next < 0 || next >= registers.length) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();

          // Swap registers in array
          const newRegs = [...registers];
          const temp = newRegs[selectedRegIndex];
          newRegs[selectedRegIndex] = newRegs[next];
          newRegs[next] = temp;

          // Recalculate offsets (4-byte stride)
          newRegs.forEach((r, i) => {
            r.offset = i * 4;
            r.address_offset = i * 4;
          });

          onUpdate(["registers"], newRegs);
          setSelectedRegIndex(next);
          setHoveredRegIndex(next);
          setRegActiveCell((prev) => ({ rowIndex: next, key: prev.key }));
          scrollToCell(next, currentKey);
          return;
        }

        // Plain arrows navigate cells.
        e.preventDefault();
        e.stopPropagation();

        // Can't navigate if there are no registers yet
        if (registers.length === 0) {
          return;
        }

        if (isVertical) {
          const nextRow = Math.max(
            0,
            Math.min(registers.length - 1, currentRow + delta),
          );
          setSelectedRegIndex(nextRow);
          setHoveredRegIndex(nextRow);
          setRegActiveCell({ rowIndex: nextRow, key: currentKey });
          scrollToCell(nextRow, currentKey);
          return;
        }

        const currentCol = Math.max(0, REG_COLUMN_ORDER.indexOf(currentKey));
        const nextCol = Math.max(
          0,
          Math.min(REG_COLUMN_ORDER.length - 1, currentCol + delta),
        );
        const nextKey = REG_COLUMN_ORDER[nextCol] ?? "name";
        setSelectedRegIndex(currentRow);
        setHoveredRegIndex(currentRow);
        setRegActiveCell({ rowIndex: currentRow, key: nextKey });
        scrollToCell(currentRow, nextKey);
      };

      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, [
      selectedType,
      selectedObject,
      selectedRegIndex,
      hoveredRegIndex,
      regActiveCell,
    ]);

    const registerOffsetText = useMemo(() => {
      if (!isRegister || !reg) {
        return "";
      }
      const off = Number(reg.address_offset ?? 0);
      return `0x${off.toString(16).toUpperCase()}`;
    }, [isRegister, reg?.address_offset]);

    useEffect(() => {
      if (isRegister) {
        setOffsetText(registerOffsetText);
      } else {
        setOffsetText("");
      }
    }, [isRegister, registerOffsetText]);

    useEffect(() => {
      if (!isRegister) {
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
    }, [isRegister, (reg as any)?.name, fields.length]);

    // Clamp selection/active cell for Memory Map blocks.
    useEffect(() => {
      if (selectedType !== "memoryMap") {
        setSelectedBlockIndex(-1);
        setBlockActiveCell({ rowIndex: -1, key: "name" });
        return;
      }
      const blocks =
        selectedObject?.address_blocks || selectedObject?.addressBlocks || [];
      if (!Array.isArray(blocks) || blocks.length === 0) {
        setSelectedBlockIndex(-1);
        setBlockActiveCell({ rowIndex: -1, key: "name" });
        return;
      }
      setSelectedBlockIndex((prev) => {
        if (prev < 0) {
          return 0;
        }
        if (prev >= blocks.length) {
          return blocks.length - 1;
        }
        return prev;
      });
      setBlockActiveCell((prev) => {
        const rowIndex =
          prev.rowIndex < 0 ? 0 : Math.min(blocks.length - 1, prev.rowIndex);
        const key = BLOCK_COLUMN_ORDER.includes(prev.key) ? prev.key : "name";
        return { rowIndex, key };
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      selectedType,
      selectedObject?.name,
      (selectedObject?.address_blocks || selectedObject?.addressBlocks || [])
        .length,
    ]);

    // Clamp selection/active cell for Address Block registers.
    useEffect(() => {
      if (selectedType !== "block") {
        setSelectedRegIndex(-1);
        setRegActiveCell({ rowIndex: -1, key: "name" });
        return;
      }
      const registers = selectedObject?.registers || [];
      if (!Array.isArray(registers) || registers.length === 0) {
        setSelectedRegIndex(-1);
        setRegActiveCell({ rowIndex: -1, key: "name" });
        return;
      }
      setSelectedRegIndex((prev) => {
        if (prev < 0) {
          return 0;
        }
        if (prev >= registers.length) {
          return registers.length - 1;
        }
        return prev;
      });
      setRegActiveCell((prev) => {
        const rowIndex =
          prev.rowIndex < 0 ? 0 : Math.min(registers.length - 1, prev.rowIndex);
        const key = REG_COLUMN_ORDER.includes(prev.key) ? prev.key : "name";
        return { rowIndex, key };
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      selectedType,
      selectedObject?.name,
      (selectedObject?.registers || []).length,
    ]);

    const commitRegisterOffset = () => {
      if (!isRegister) {
        return;
      }
      const parsed = Number.parseInt(offsetText.trim(), 0);
      if (Number.isNaN(parsed)) {
        return;
      }
      onUpdate(["address_offset"], parsed);
    };

    const toBits = (f: any) => {
      const o = Number(f?.bit_offset ?? 0);
      const w = Number(f?.bit_width ?? 1);
      if (!Number.isFinite(o) || !Number.isFinite(w)) {
        return "[?:?]";
      }
      const msb = o + w - 1;
      return `[${msb}:${o}]`;
    };

    // Parse a bit string like "[7:4]" or "[3]" or "7:4" or "3".
    const parseBitsInput = (text: string) => {
      const trimmed = text.trim().replace(/[\[\]]/g, "");
      if (!trimmed) {
        return null;
      }
      const parts = trimmed.split(":").map((p) => Number(p.trim()));
      if (parts.some((p) => Number.isNaN(p))) {
        return null;
      }
      let msb: number;
      let lsb: number;
      if (parts.length === 1) {
        msb = parts[0];
        lsb = parts[0];
      } else {
        [msb, lsb] = parts as [number, number];
      }
      if (!Number.isFinite(msb) || !Number.isFinite(lsb)) {
        return null;
      }
      if (msb < lsb) {
        const tmp = msb;
        msb = lsb;
        lsb = tmp;
      }
      const width = msb - lsb + 1;
      return {
        bit_offset: lsb,
        bit_width: width,
        bit_range: [msb, lsb] as [number, number],
      };
    };

    const parseReset = (text: string): number | null => {
      const s = text.trim();
      if (!s) {
        return null;
      }
      const v = Number.parseInt(s, 0);
      return Number.isFinite(v) ? v : null;
    };

    const validateVhdlIdentifier = (name: string): string | null => {
      const trimmed = name.trim();
      if (!trimmed) {
        return "Name is required";
      }
      // VHDL basic identifier (common convention):
      // - starts with a letter
      // - contains only letters, digits, and underscores
      // - no consecutive underscores
      // - no trailing underscore
      const re = /^[A-Za-z](?:[A-Za-z0-9]*(_[A-Za-z0-9]+)*)?$/;
      if (!re.test(trimmed)) {
        return "VHDL name must start with a letter and contain only letters, digits, and single underscores";
      }
      return null;
    };

    const getFieldBitWidth = (f: any): number => {
      const w = Number(f?.bit_width);
      if (Number.isFinite(w) && w > 0) {
        return w;
      }
      const br = f?.bit_range;
      if (Array.isArray(br) && br.length === 2) {
        const msb = Number(br[0]);
        const lsb = Number(br[1]);
        if (Number.isFinite(msb) && Number.isFinite(lsb)) {
          return Math.abs(msb - lsb) + 1;
        }
      }
      return 1;
    };

    const validateResetForField = (
      f: any,
      value: number | null,
    ): string | null => {
      if (value === null) {
        return null;
      }
      if (!Number.isFinite(value)) {
        return "Invalid number";
      }
      if (value < 0) {
        return "Reset must be >= 0";
      }
      const width = getFieldBitWidth(f);
      // Avoid overflow in shifts; for typical widths (<=32) this is safe.
      const max =
        width >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, width) - 1;
      if (value > max) {
        return `Reset too large for ${width} bit(s)`;
      }
      return null;
    };

    if (!selectedObject) {
      return (
        <div className="flex items-center justify-center h-full vscode-muted text-sm">
          Select an item to view details
        </div>
      );
    }

    if (selectedType === "register") {
      const regObj = selectedObject as Register;

      const getFieldKey = (field: any, idx: number) => {
        // Prefer a unique name if available, else fallback to index
        return field && field.name ? `${field.name}` : `idx-${idx}`;
      };
      const ensureDraftsInitialized = (idx: number) => {
        const f = fields[idx];
        if (!f) {
          return;
        }
        const key = getFieldKey(f, idx);
        setNameDrafts((prev) =>
          prev[key] !== undefined
            ? prev
            : { ...prev, [key]: String(f.name ?? "") },
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
      };

      const moveSelectedField = (delta: -1 | 1) => {
        const idx = selectedFieldIndex;
        if (idx < 0) {
          return;
        }
        const next = idx + delta;
        if (next < 0 || next >= fields.length) {
          return;
        }
        onUpdate(["__op", "field-move"], { index: idx, delta });

        // Clear draft states to force display of fresh normalized values
        setBitsDrafts({});
        setBitsErrors({});
        setNameDrafts({});
        setNameErrors({});

        setSelectedFieldIndex(next);
        setHoveredFieldIndex(next);
      };

      return (
        <div className="flex flex-col w-full h-full min-h-0">
          {/* --- Register Header and BitFieldVisualizer --- */}
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
            {/* <div className="absolute inset-0 fpga-grid-bg bg-[size:24px_24px] pointer-events-none"></div> */}
            <div className="flex justify-between items-start relative z-10">
              <div>
                <h2 className="text-2xl font-bold font-mono tracking-tight">
                  {regObj.name}
                </h2>
                <p className="vscode-muted text-sm mt-1 max-w-2xl">
                  {regObj.description}
                </p>
              </div>
            </div>
            <div className="w-full relative z-10 mt-2 select-none">
              <BitFieldVisualizer
                fields={fields}
                hoveredFieldIndex={hoveredFieldIndex}
                setHoveredFieldIndex={setHoveredFieldIndex}
                registerSize={32}
                layout="pro"
                onUpdateFieldReset={(fieldIndex, resetValue) => {
                  onUpdate(["fields", fieldIndex, "reset_value"], resetValue);
                }}
                onUpdateFieldRange={(fieldIndex, newRange) => {
                  // Update entire field object at once to avoid race conditions
                  const [hi, lo] = newRange;
                  const field = fields[fieldIndex];
                  const updatedField = {
                    ...field,
                    bit_range: newRange,
                    bit_offset: lo,
                    bit_width: hi - lo + 1,
                  };
                  const newFields = [...fields];
                  newFields[fieldIndex] = updatedField;
                  onUpdate(["fields"], newFields);
                }}
                onBatchUpdateFields={(updates) => {
                  const newFields = [...fields];
                  updates.forEach(({ idx, range }) => {
                    const [hi, lo] = range;
                    const field = newFields[idx];
                    if (field) {
                      newFields[idx] = {
                        ...field,
                        bit_range: range,
                        bit_offset: lo,
                        bit_width: hi - lo + 1,
                      };
                    }
                  });
                  // Sort by LSB to keep table clean
                  newFields.sort((a, b) => {
                    const aLo = a.bit_range
                      ? a.bit_range[1]
                      : (a.bit_offset ?? 0);
                    const bLo = b.bit_range
                      ? b.bit_range[1]
                      : (b.bit_offset ?? 0);
                    return aLo - bLo;
                  });
                  onUpdate(["fields"], newFields);
                }}
                onCreateField={(newField) => {
                  // Generate unique name
                  let maxN = 0;
                  for (const f of fields) {
                    const m = String(f.name || "").match(/^field(\d+)$/);
                    if (m) {
                      maxN = Math.max(maxN, parseInt(m[1], 10));
                    }
                  }
                  const name = `field${maxN + 1}`;
                  const [hi, lo] = newField.bit_range;
                  const field = {
                    name,
                    bit_range: newField.bit_range,
                    bit_offset: lo,
                    bit_width: hi - lo + 1,
                    access: "read-write",
                    reset_value: 0,
                    description: "",
                  };
                  // Add new field and sort by LSB
                  const newFields = [...fields, field].sort((a, b) => {
                    const aLo = a.bit_range
                      ? a.bit_range[1]
                      : (a.bit_offset ?? 0);
                    const bLo = b.bit_range
                      ? b.bit_range[1]
                      : (b.bit_offset ?? 0);
                    return aLo - bLo;
                  });
                  onUpdate(["fields"], newFields);
                }}
                onDragPreview={(preview) => {
                  if (preview === null) {
                    setDragPreviewRanges({});
                  } else {
                    const newRanges: Record<number, [number, number]> = {};
                    preview.forEach(({ idx, range }) => {
                      newRanges[idx] = range;
                    });
                    setDragPreviewRanges(newRanges);
                  }
                }}
              />
            </div>
          </div>
          {/* --- Main Content: Table and Properties --- */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface border-r vscode-border min-h-0 flex flex-col">
              <div className="shrink-0 px-4 py-2 border-b vscode-border vscode-surface flex items-center justify-end gap-1">
                <button
                  className="p-2 rounded-md transition-colors disabled:opacity-40 vscode-icon-button"
                  onClick={() => moveSelectedField(-1)}
                  disabled={selectedFieldIndex <= 0}
                  title="Move field up"
                  type="button"
                >
                  <span className="codicon codicon-chevron-up"></span>
                </button>
                <button
                  className="p-2 rounded-md transition-colors disabled:opacity-40 vscode-icon-button"
                  onClick={() => moveSelectedField(1)}
                  disabled={
                    selectedFieldIndex < 0 ||
                    selectedFieldIndex >= fields.length - 1
                  }
                  title="Move field down"
                  type="button"
                >
                  <span className="codicon codicon-chevron-down"></span>
                </button>
              </div>
              <div
                ref={fieldsFocusRef}
                tabIndex={0}
                data-fields-table="true"
                className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
                style={{ overflowY: "auto", overflowX: "auto" }}
              >
                {fieldsInsertError ? (
                  <div
                    ref={fieldsErrorRef}
                    className="vscode-error px-4 py-2 text-xs"
                  >
                    {fieldsInsertError}
                  </div>
                ) : null}
                <table className="w-full text-left border-collapse table-fixed">
                  <colgroup>
                    <col className="w-[18%] min-w-[120px]" />
                    <col className="w-[14%] min-w-[100px]" />
                    <col className="w-[14%] min-w-[120px]" />
                    <col className="w-[14%] min-w-[110px]" />
                    <col className="w-[40%] min-w-[240px]" />
                  </colgroup>
                  <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                    <tr className="h-12">
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Name
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Bit(s)
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Access
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Reset
                      </th>
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y vscode-border text-sm">
                    {fields.map((field, idx) => {
                      const bits = toBits(field);
                      const color = getFieldColor(
                        field.name || `field${idx}`,
                        field.bit_offset,
                      );
                      const resetDisplay =
                        field.reset_value !== null &&
                        field.reset_value !== undefined
                          ? `0x${Number(field.reset_value).toString(16).toUpperCase()}`
                          : "";

                      // Helper to get a unique key for this field
                      const fieldKey =
                        field && field.name ? `${field.name}` : `idx-${idx}`;
                      const nameValue =
                        nameDrafts[fieldKey] ?? String(field.name ?? "");
                      const nameErr = nameErrors[fieldKey] ?? null;
                      // Use preview range if available (during Ctrl+drag), otherwise use draft or computed
                      const previewRange = dragPreviewRanges[idx];
                      const bitsValue = previewRange
                        ? `[${previewRange[0]}:${previewRange[1]}]`
                        : (bitsDrafts[idx] ?? bits);
                      const bitsErr = bitsErrors[idx] ?? null;
                      const resetValue =
                        resetDrafts[idx] ?? (resetDisplay || "0x0");
                      const resetErr = resetErrors[idx] ?? null;

                      return (
                        <tr
                          key={idx}
                          data-field-idx={idx}
                          className={`group transition-colors border-l-4 border-transparent h-12 ${idx === selectedFieldIndex ? "vscode-focus-border vscode-row-selected" : idx === hoveredFieldIndex ? "vscode-focus-border vscode-row-hover" : ""}`}
                          style={{ position: "relative" }}
                          onMouseEnter={() => {
                            setHoveredFieldIndex(idx);
                          }}
                          onMouseLeave={() => setHoveredFieldIndex(null)}
                          onClick={() => {
                            setSelectedFieldIndex(idx);
                            setHoveredFieldIndex(idx);
                            setActiveCell((prev) => ({
                              rowIndex: idx,
                              key: prev.key,
                            }));
                            ensureDraftsInitialized(idx);
                          }}
                          id={`row-${field.name?.toLowerCase().replace(/[^a-z0-9_]/g, "-")}`}
                        >
                          <>
                            <td
                              data-col-key="name"
                              className={`px-6 py-2 font-medium align-middle ${activeCell.rowIndex === idx && activeCell.key === "name" ? "vscode-cell-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                ensureDraftsInitialized(idx);
                                setSelectedFieldIndex(idx);
                                setHoveredFieldIndex(idx);
                                setSelectedEditKey("name");
                                setActiveCell({ rowIndex: idx, key: "name" });
                              }}
                            >
                              <div className="flex flex-col justify-center">
                                <div className="flex items-center gap-2 h-10">
                                  <div
                                    className={`w-2.5 h-2.5 rounded-sm`}
                                    style={{
                                      backgroundColor:
                                        color === "gray"
                                          ? "#e5e7eb"
                                          : (FIELD_COLORS &&
                                              FIELD_COLORS[color]) ||
                                            color,
                                    }}
                                  ></div>
                                  <VSCodeTextField
                                    data-edit-key="name"
                                    className="flex-1"
                                    value={nameValue}
                                    onFocus={() => {
                                      ensureDraftsInitialized(idx);
                                      setSelectedFieldIndex(idx);
                                      setHoveredFieldIndex(idx);
                                      setSelectedEditKey("name");
                                      setActiveCell({
                                        rowIndex: idx,
                                        key: "name",
                                      });
                                    }}
                                    onInput={(e: any) => {
                                      const next = String(e.target.value ?? "");
                                      setNameDrafts((prev) => ({
                                        ...prev,
                                        [fieldKey]: next,
                                      }));
                                      const err = validateVhdlIdentifier(next);
                                      setNameErrors((prev) => ({
                                        ...prev,
                                        [fieldKey]: err,
                                      }));
                                    }}
                                    onBlur={(e: any) => {
                                      const next = String(e.target.value ?? "");
                                      const err = validateVhdlIdentifier(next);
                                      if (!err) {
                                        onUpdate(
                                          ["fields", idx, "name"],
                                          next.trim(),
                                        );
                                      }
                                    }}
                                  />
                                </div>
                                {nameErr ? (
                                  <div className="text-xs vscode-error mt-1">
                                    {nameErr}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td
                              data-col-key="bits"
                              className={`px-4 py-2 font-mono vscode-muted align-middle ${activeCell.rowIndex === idx && activeCell.key === "bits" ? "vscode-cell-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                ensureDraftsInitialized(idx);
                                setSelectedFieldIndex(idx);
                                setHoveredFieldIndex(idx);
                                setSelectedEditKey("bits");
                                setActiveCell({ rowIndex: idx, key: "bits" });
                              }}
                            >
                              <div className="flex items-center h-10">
                                <div className="flex flex-col w-full">
                                  <VSCodeTextField
                                    data-edit-key="bits"
                                    className="w-full font-mono"
                                    value={bitsValue}
                                    onFocus={() => {
                                      ensureDraftsInitialized(idx);
                                      setSelectedFieldIndex(idx);
                                      setHoveredFieldIndex(idx);
                                      setSelectedEditKey("bits");
                                      setActiveCell({
                                        rowIndex: idx,
                                        key: "bits",
                                      });
                                    }}
                                    onInput={(e: any) => {
                                      const next = String(e.target.value ?? "");
                                      setBitsDrafts((prev) => ({
                                        ...prev,
                                        [idx]: next,
                                      }));
                                      let err = validateBitsString(next);
                                      // Overfill validation
                                      if (!err) {
                                        const thisWidth = parseBitsWidth(next);
                                        if (thisWidth !== null) {
                                          // Calculate total bits used if this field is set to new value
                                          let total = 0;
                                          for (
                                            let i = 0;
                                            i < fields.length;
                                            ++i
                                          ) {
                                            if (i === idx) {
                                              total += thisWidth;
                                            } else {
                                              // Use draft if present, else current
                                              const b =
                                                bitsDrafts[i] ??
                                                toBits(fields[i]);
                                              const w = parseBitsWidth(b);
                                              if (w) {
                                                total += w;
                                              }
                                            }
                                          }
                                          const regSize = reg?.size || 32;
                                          if (total > regSize) {
                                            err = `Bit fields overflow register (${total} > ${regSize})`;
                                          }
                                        }
                                      }
                                      setBitsErrors((prev) => ({
                                        ...prev,
                                        [idx]: err,
                                      }));
                                      if (!err) {
                                        // Update this field's bits, and if overlap, repack subsequent fields
                                        const updatedFields = fields.map(
                                          (f, i) => {
                                            if (i !== idx) {
                                              return { ...f };
                                            }
                                            // Parse new bits
                                            const parsed = parseBitsInput(next);
                                            if (parsed) {
                                              return {
                                                ...f,
                                                bits: next,
                                                bit_offset: parsed.bit_offset,
                                                bit_width: parsed.bit_width,
                                                bit_range: parsed.bit_range,
                                              };
                                            } else {
                                              return { ...f, bits: next };
                                            }
                                          },
                                        );

                                        // Check for overlap with next field
                                        const curr = updatedFields[idx];
                                        const currMSB = curr.bit_range
                                          ? curr.bit_range[0]
                                          : curr.bit_offset +
                                            curr.bit_width -
                                            1;
                                        let prevMSB = currMSB;
                                        let prevLSB = curr.bit_offset;
                                        for (
                                          let i = idx + 1;
                                          i < updatedFields.length;
                                          ++i
                                        ) {
                                          const f = updatedFields[i];
                                          const width = f.bit_width || 1;
                                          const lsb = prevMSB + 1;
                                          const msb = lsb + width - 1;
                                          updatedFields[i] = {
                                            ...f,
                                            bit_offset: lsb,
                                            bit_width: width,
                                            bit_range: [msb, lsb],
                                            bits: formatBits(msb, lsb),
                                          };
                                          prevMSB = msb;
                                          prevLSB = lsb;
                                        }
                                        onUpdate(["fields"], updatedFields);
                                      }
                                    }}
                                  />
                                  {bitsErr ? (
                                    <div className="text-xs vscode-error mt-1">
                                      {bitsErr}
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            </td>
                            <td
                              data-col-key="access"
                              className={`px-4 py-2 align-middle ${activeCell.rowIndex === idx && activeCell.key === "access" ? "vscode-cell-active" : ""}`}
                              style={{
                                overflow: "visible",
                                position: "relative",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                ensureDraftsInitialized(idx);
                                setSelectedFieldIndex(idx);
                                setHoveredFieldIndex(idx);
                                setSelectedEditKey("access");
                                setActiveCell({ rowIndex: idx, key: "access" });
                              }}
                            >
                              <div className="flex items-center h-10">
                                <VSCodeDropdown
                                  data-edit-key="access"
                                  value={field.access || "read-write"}
                                  className="w-full"
                                  position="below"
                                  onFocus={() => {
                                    setSelectedFieldIndex(idx);
                                    setHoveredFieldIndex(idx);
                                    setSelectedEditKey("access");
                                    setActiveCell({
                                      rowIndex: idx,
                                      key: "access",
                                    });
                                  }}
                                  onInput={(e: any) =>
                                    onUpdate(
                                      ["fields", idx, "access"],
                                      e.target.value,
                                    )
                                  }
                                >
                                  {ACCESS_OPTIONS.map((opt) => (
                                    <VSCodeOption key={opt} value={opt}>
                                      {opt}
                                    </VSCodeOption>
                                  ))}
                                </VSCodeDropdown>
                              </div>
                            </td>
                            <td
                              data-col-key="reset"
                              className={`px-4 py-2 font-mono vscode-muted align-middle ${activeCell.rowIndex === idx && activeCell.key === "reset" ? "vscode-cell-active" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                ensureDraftsInitialized(idx);
                                setSelectedFieldIndex(idx);
                                setHoveredFieldIndex(idx);
                                setSelectedEditKey("reset");
                                setActiveCell({ rowIndex: idx, key: "reset" });
                              }}
                            >
                              <div className="flex flex-col justify-center h-10">
                                <VSCodeTextField
                                  data-edit-key="reset"
                                  className="w-full font-mono"
                                  value={resetValue}
                                  onFocus={() => {
                                    ensureDraftsInitialized(idx);
                                    setSelectedFieldIndex(idx);
                                    setHoveredFieldIndex(idx);
                                    setSelectedEditKey("reset");
                                    setActiveCell({
                                      rowIndex: idx,
                                      key: "reset",
                                    });
                                  }}
                                  onInput={(e: any) => {
                                    const raw = String(e.target.value ?? "");
                                    setResetDrafts((prev) => ({
                                      ...prev,
                                      [idx]: raw,
                                    }));

                                    const trimmed = raw.trim();
                                    if (!trimmed) {
                                      setResetErrors((prev) => ({
                                        ...prev,
                                        [idx]: null,
                                      }));
                                      onUpdate(
                                        ["fields", idx, "reset_value"],
                                        null,
                                      );
                                      return;
                                    }

                                    const parsed = parseReset(raw);
                                    const err = validateResetForField(
                                      field,
                                      parsed,
                                    );
                                    setResetErrors((prev) => ({
                                      ...prev,
                                      [idx]: err,
                                    }));
                                    if (err) {
                                      return;
                                    }
                                    if (parsed !== null) {
                                      onUpdate(
                                        ["fields", idx, "reset_value"],
                                        parsed,
                                      );
                                    }
                                  }}
                                />
                                {resetErr ? (
                                  <div className="text-xs vscode-error mt-1">
                                    {resetErr}
                                  </div>
                                ) : null}
                              </div>
                            </td>
                            <td
                              data-col-key="description"
                              className={`px-6 py-2 vscode-muted align-middle ${activeCell.rowIndex === idx && activeCell.key === "description" ? "vscode-cell-active" : ""}`}
                              style={{ width: "40%", minWidth: "240px" }}
                              onClick={(e) => {
                                e.stopPropagation();
                                ensureDraftsInitialized(idx);
                                setSelectedFieldIndex(idx);
                                setHoveredFieldIndex(idx);
                                setSelectedEditKey("description");
                                setActiveCell({
                                  rowIndex: idx,
                                  key: "description",
                                });
                              }}
                            >
                              <div className="flex items-center h-10">
                                <VSCodeTextArea
                                  data-edit-key="description"
                                  className="w-full"
                                  style={{
                                    height: "40px",
                                    minHeight: "40px",
                                    resize: "none",
                                  }}
                                  rows={1}
                                  value={field.description || ""}
                                  onFocus={() => {
                                    setSelectedFieldIndex(idx);
                                    setHoveredFieldIndex(idx);
                                    setSelectedEditKey("description");
                                    setActiveCell({
                                      rowIndex: idx,
                                      key: "description",
                                    });
                                  }}
                                  onInput={(e: any) =>
                                    onUpdate(
                                      ["fields", idx, "description"],
                                      e.target.value,
                                    )
                                  }
                                />
                              </div>
                            </td>
                          </>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <KeyboardShortcutsButton context="register" />
        </div>
      );
    }

    if (selectedType === "memoryMap") {
      const map = selectedObject;
      const blocks = map.address_blocks || map.addressBlocks || [];

      const toHex = (n: number) =>
        `0x${Math.max(0, n).toString(16).toUpperCase()}`;

      const getBlockColor = (idx: number) => {
        return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
      };

      return (
        <div className="flex flex-col w-full h-full min-h-0">
          {/* Memory Map Header and Address Visualizer */}
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
            {/* <div className="absolute inset-0 fpga-grid-bg bg-[size:24px_24px] pointer-events-none"></div> */}
            <div className="flex justify-between items-start relative z-10">
              <div>
                <h2 className="text-2xl font-bold font-mono tracking-tight">
                  {map.name || "Memory Map"}
                </h2>
                <p className="vscode-muted text-sm mt-1 max-w-2xl">
                  {map.description || "Address space layout"}
                </p>
              </div>
            </div>
            <div className="w-full relative z-10 mt-2 select-none">
              <AddressMapVisualizer
                blocks={blocks}
                hoveredBlockIndex={hoveredBlockIndex}
                setHoveredBlockIndex={setHoveredBlockIndex}
                onBlockClick={onNavigateToBlock}
              />
            </div>
          </div>
          {/* Address Blocks Table */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface min-h-0 flex flex-col">
              <div
                ref={blocksFocusRef}
                tabIndex={0}
                data-blocks-table="true"
                className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
              >
                {blocksInsertError ? (
                  <div className="vscode-error px-4 py-2 text-xs">
                    {blocksInsertError}
                  </div>
                ) : null}
                <table className="w-full text-left border-collapse table-fixed">
                  <colgroup>
                    <col className="w-[25%] min-w-[200px]" />
                    <col className="w-[20%] min-w-[120px]" />
                    <col className="w-[15%] min-w-[100px]" />
                    <col className="w-[15%] min-w-[100px]" />
                    <col className="w-[25%]" />
                  </colgroup>
                  <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                    <tr className="h-12">
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Name
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Base Address
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Size
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Usage
                      </th>
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y vscode-border text-sm">
                    {blocks.map((block: any, idx: number) => {
                      const color = getBlockColor(idx);
                      const base = block.base_address ?? block.offset ?? 0;
                      const size = calculateBlockSize(block);

                      return (
                        <tr
                          key={idx}
                          data-block-idx={idx}
                          className={`group transition-colors border-l-4 border-transparent h-12 ${
                            idx === selectedBlockIndex
                              ? "vscode-focus-border vscode-row-selected"
                              : idx === hoveredBlockIndex
                                ? "vscode-focus-border vscode-row-hover"
                                : ""
                          }`}
                          onMouseEnter={() => setHoveredBlockIndex(idx)}
                          onMouseLeave={() => setHoveredBlockIndex(null)}
                          onClick={() => {
                            setSelectedBlockIndex(idx);
                            setHoveredBlockIndex(idx);
                            setBlockActiveCell((prev) => ({
                              rowIndex: idx,
                              key: prev.key,
                            }));
                          }}
                        >
                          <td
                            data-col-key="name"
                            className={`px-6 py-2 font-medium align-middle ${blockActiveCell.rowIndex === idx && blockActiveCell.key === "name" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBlockIndex(idx);
                              setHoveredBlockIndex(idx);
                              setBlockActiveCell({
                                rowIndex: idx,
                                key: "name",
                              });
                            }}
                          >
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2.5 h-2.5 rounded-sm"
                                style={{
                                  backgroundColor: FIELD_COLORS[color] || color,
                                }}
                              ></div>
                              <VSCodeTextField
                                data-edit-key="name"
                                className="flex-1"
                                value={block.name || ""}
                                onBlur={(e: any) =>
                                  onUpdate(
                                    ["addressBlocks", idx, "name"],
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          </td>
                          <td
                            data-col-key="base"
                            className={`px-4 py-2 font-mono vscode-muted align-middle ${blockActiveCell.rowIndex === idx && blockActiveCell.key === "base" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBlockIndex(idx);
                              setHoveredBlockIndex(idx);
                              setBlockActiveCell({
                                rowIndex: idx,
                                key: "base",
                              });
                            }}
                          >
                            <VSCodeTextField
                              data-edit-key="base"
                              className="w-full font-mono"
                              value={toHex(base)}
                              onInput={(e: any) => {
                                const val = Number.parseInt(e.target.value, 0);
                                if (!Number.isNaN(val)) {
                                  onUpdate(
                                    ["addressBlocks", idx, "offset"],
                                    val,
                                  );
                                }
                              }}
                            />
                          </td>
                          <td
                            data-col-key="size"
                            className={`px-4 py-2 font-mono vscode-muted align-middle ${blockActiveCell.rowIndex === idx && blockActiveCell.key === "size" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBlockIndex(idx);
                              setHoveredBlockIndex(idx);
                              setBlockActiveCell({
                                rowIndex: idx,
                                key: "size",
                              });
                            }}
                          >
                            {size < 1024
                              ? `${size}B`
                              : `${(size / 1024).toFixed(1)}KB`}
                          </td>
                          <td
                            data-col-key="usage"
                            className={`px-4 py-2 align-middle ${blockActiveCell.rowIndex === idx && blockActiveCell.key === "usage" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBlockIndex(idx);
                              setHoveredBlockIndex(idx);
                              setBlockActiveCell({
                                rowIndex: idx,
                                key: "usage",
                              });
                            }}
                          >
                            <span className="px-2 py-0.5 rounded text-xs font-medium vscode-badge whitespace-nowrap">
                              {block.usage || "register"}
                            </span>
                          </td>
                          <td
                            data-col-key="description"
                            className={`px-6 py-2 vscode-muted align-middle ${blockActiveCell.rowIndex === idx && blockActiveCell.key === "description" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedBlockIndex(idx);
                              setHoveredBlockIndex(idx);
                              setBlockActiveCell({
                                rowIndex: idx,
                                key: "description",
                              });
                            }}
                          >
                            <VSCodeTextArea
                              data-edit-key="description"
                              className="w-full"
                              rows={1}
                              value={block.description || ""}
                              onInput={(e: any) =>
                                onUpdate(
                                  ["addressBlocks", idx, "description"],
                                  e.target.value,
                                )
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
          <KeyboardShortcutsButton context="memoryMap" />
        </div>
      );
    }

    if (selectedType === "block") {
      const block = selectedObject;
      const registers = block.registers || [];
      const baseAddress = block.base_address ?? block.offset ?? 0;

      const toHex = (n: number) =>
        `0x${Math.max(0, n).toString(16).toUpperCase()}`;

      const getRegColor = (idx: number) => {
        return FIELD_COLOR_KEYS[idx % FIELD_COLOR_KEYS.length];
      };

      return (
        <div className="flex flex-col w-full h-full min-h-0">
          {/* Address Block Header and Register Visualizer */}
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
            {/* <div className="absolute inset-0 fpga-grid-bg bg-[size:24px_24px] pointer-events-none"></div> */}
            <div className="flex justify-between items-start relative z-10">
              <div>
                <h2 className="text-2xl font-bold font-mono tracking-tight">
                  {block.name || "Address Block"}
                </h2>
                <p className="vscode-muted text-sm mt-1 max-w-2xl">
                  {block.description || `Base: ${toHex(baseAddress)}`} •{" "}
                  {block.usage || "register"}
                </p>
              </div>
            </div>
            <div className="w-full relative z-10 mt-2 select-none">
              <RegisterMapVisualizer
                registers={registers}
                hoveredRegIndex={hoveredRegIndex}
                setHoveredRegIndex={setHoveredRegIndex}
                baseAddress={baseAddress}
                onReorderRegisters={(newRegs) =>
                  onUpdate(["registers"], newRegs)
                }
                onRegisterClick={onNavigateToRegister}
              />
            </div>
          </div>
          {/* Registers Table */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface min-h-0 flex flex-col">
              <div
                ref={regsFocusRef}
                tabIndex={0}
                data-regs-table="true"
                className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
              >
                {regsInsertError ? (
                  <div className="vscode-error px-4 py-2 text-xs">
                    {regsInsertError}
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
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Name
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Offset
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Access
                      </th>
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Description
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y vscode-border text-sm">
                    {registers.map((reg: any, idx: number) => {
                      const color = getRegColor(idx);
                      const offset =
                        reg.address_offset ?? reg.offset ?? idx * 4;

                      return (
                        <tr
                          key={idx}
                          data-reg-idx={idx}
                          className={`group transition-colors border-l-4 border-transparent h-12 ${
                            idx === selectedRegIndex
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
                            setRegActiveCell((prev) => ({
                              rowIndex: idx,
                              key: prev.key,
                            }));
                          }}
                        >
                          <td
                            data-col-key="name"
                            className={`px-6 py-2 font-medium align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "name" ? "vscode-cell-active" : ""}`}
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
                                style={{
                                  backgroundColor: FIELD_COLORS[color] || color,
                                }}
                              ></div>
                              <VSCodeTextField
                                data-edit-key="name"
                                className="flex-1"
                                value={reg.name || ""}
                                onBlur={(e: any) =>
                                  onUpdate(
                                    ["registers", idx, "name"],
                                    e.target.value,
                                  )
                                }
                              />
                            </div>
                          </td>
                          <td
                            data-col-key="offset"
                            className={`px-4 py-2 font-mono vscode-muted align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "offset" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setHoveredRegIndex(idx);
                              setRegActiveCell({
                                rowIndex: idx,
                                key: "offset",
                              });
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
                          <td
                            data-col-key="access"
                            className={`px-4 py-2 align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "access" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setHoveredRegIndex(idx);
                              setRegActiveCell({
                                rowIndex: idx,
                                key: "access",
                              });
                            }}
                          >
                            <VSCodeDropdown
                              data-edit-key="access"
                              className="w-full"
                              value={reg.access || "read-write"}
                              onInput={(e: any) =>
                                onUpdate(
                                  ["registers", idx, "access"],
                                  e.target.value,
                                )
                              }
                            >
                              {ACCESS_OPTIONS.map((opt) => (
                                <VSCodeOption key={opt} value={opt}>
                                  {opt}
                                </VSCodeOption>
                              ))}
                            </VSCodeDropdown>
                          </td>
                          <td
                            data-col-key="description"
                            className={`px-6 py-2 vscode-muted align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "description" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setHoveredRegIndex(idx);
                              setRegActiveCell({
                                rowIndex: idx,
                                key: "description",
                              });
                            }}
                          >
                            <VSCodeTextArea
                              data-edit-key="description"
                              className="w-full"
                              rows={1}
                              value={reg.description || ""}
                              onInput={(e: any) =>
                                onUpdate(
                                  ["registers", idx, "description"],
                                  e.target.value,
                                )
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

    // =====================================================
    // REGISTER ARRAY VIEW
    // =====================================================
    if (selectedType === "array") {
      const arr = selectedObject;
      const nestedRegisters = arr.registers || [];
      const baseOffset = arr.address_offset ?? 0;

      const toHex = (n: number) =>
        `0x${Math.max(0, n).toString(16).toUpperCase()}`;

      return (
        <div className="flex flex-col w-full h-full min-h-0">
          {/* Array Header */}
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0">
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-2xl font-bold font-mono tracking-tight">
                  {arr.name || "Register Array"}
                </h2>
                <p className="vscode-muted text-sm mt-1 max-w-2xl">
                  {arr.description || "Register array"} • {arr.count || 1}{" "}
                  instances × {arr.stride || 4} bytes
                </p>
              </div>
            </div>

            {/* Array Properties */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 vscode-surface-alt p-4 rounded-lg">
              <div>
                <label className="text-xs vscode-muted block mb-1">Name</label>
                <VSCodeTextField
                  value={arr.name || ""}
                  onInput={(e: any) => onUpdate(["name"], e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <label className="text-xs vscode-muted block mb-1">
                  Base Offset
                </label>
                <span className="font-mono text-sm">{toHex(baseOffset)}</span>
              </div>
              <div>
                <label className="text-xs vscode-muted block mb-1">Count</label>
                <VSCodeTextField
                  value={String(arr.count || 1)}
                  onInput={(e: any) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) {
                      onUpdate(["count"], val);
                    }
                  }}
                  className="w-24"
                />
              </div>
              <div>
                <label className="text-xs vscode-muted block mb-1">
                  Stride (bytes)
                </label>
                <VSCodeTextField
                  value={String(arr.stride || 4)}
                  onInput={(e: any) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val) && val > 0) {
                      onUpdate(["stride"], val);
                    }
                  }}
                  className="w-24"
                />
              </div>
            </div>

            {/* Array Address Summary */}
            <div className="text-sm vscode-muted">
              <span className="font-mono">
                {toHex(baseOffset)} →{" "}
                {toHex(baseOffset + (arr.count || 1) * (arr.stride || 4) - 1)}
              </span>
              <span className="ml-2">
                ({(arr.count || 1) * (arr.stride || 4)} bytes total)
              </span>
            </div>

            {/* Register Map Visualizer for nested registers */}
            <div className="w-full relative z-10 mt-4 select-none">
              <RegisterMapVisualizer
                registers={nestedRegisters}
                hoveredRegIndex={hoveredRegIndex}
                setHoveredRegIndex={setHoveredRegIndex}
                baseAddress={0}
                onReorderRegisters={(newRegs) =>
                  onUpdate(["registers"], newRegs)
                }
                onRegisterClick={(idx) => {
                  setSelectedRegIndex(idx);
                  setHoveredRegIndex(idx);
                }}
              />
            </div>
          </div>

          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface min-h-0 flex flex-col">
              <div
                ref={regsFocusRef}
                tabIndex={0}
                data-registers-table="true"
                className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
                onKeyDown={(e) => {
                  const scrollToCell = (rowIndex: number, key: string) => {
                    window.setTimeout(() => {
                      const row = document.querySelector(
                        `tr[data-reg-idx="${rowIndex}"]`,
                      );
                      row?.scrollIntoView({ block: "nearest" });
                      const cell = row?.querySelector(
                        `td[data-col-key="${key}"]`,
                      );
                      cell?.scrollIntoView({
                        block: "nearest",
                        inline: "nearest",
                      });
                    }, 0);
                  };

                  const keyLower = e.key.toLowerCase();
                  if (e.altKey) {
                    /* ... same ... */
                  }

                  const vimToArrow: Record<string, string> = {
                    h: "ArrowLeft",
                    j: "ArrowDown",
                    k: "ArrowUp",
                    l: "ArrowRight",
                  };
                  const normalizedKey = vimToArrow[keyLower] ?? e.key;
                  const isArrow = [
                    "ArrowUp",
                    "ArrowDown",
                    "ArrowLeft",
                    "ArrowRight",
                  ].includes(normalizedKey);
                  const isEdit =
                    normalizedKey === "F2" ||
                    keyLower === "e" ||
                    keyLower === "enter";
                  const isDelete = keyLower === "d" || e.key === "Delete";
                  const isInsertAfter = keyLower === "o" && !e.shiftKey;
                  const isInsertBefore = keyLower === "o" && e.shiftKey;

                  if (
                    !isArrow &&
                    !isEdit &&
                    !isDelete &&
                    !isInsertAfter &&
                    !isInsertBefore
                  )
                    return;
                  if (e.ctrlKey || e.metaKey) return;

                  const target = e.target as HTMLElement | null;
                  const isTypingTarget = !!target?.closest(
                    'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown',
                  );
                  if (isTypingTarget) return;

                  const currentRow =
                    selectedRegIndex >= 0 ? selectedRegIndex : 0;

                  if (isInsertAfter || isInsertBefore) {
                    e.preventDefault();
                    e.stopPropagation();
                    let maxN = 0;
                    for (const r of nestedRegisters) {
                      const match = r.name?.match(/^reg(\d+)$/i);
                      if (match) maxN = Math.max(maxN, parseInt(match[1], 10));
                    }
                    const newName = `reg${maxN + 1}`;
                    const selIdx =
                      selectedRegIndex >= 0
                        ? selectedRegIndex
                        : nestedRegisters.length - 1;
                    const selected = nestedRegisters[selIdx];
                    const selectedOffset =
                      selected?.address_offset ?? selected?.offset ?? 0;
                    const newOffset = isInsertAfter
                      ? selectedOffset + 4
                      : Math.max(0, selectedOffset - 4);

                    const newReg = {
                      name: newName,
                      offset: newOffset,
                      address_offset: newOffset,
                      access: "read-write",
                      description: "",
                      fields: [
                        {
                          name: "data",
                          bits: "[31:0]",
                          access: "read-write",
                          description: "",
                        },
                      ],
                    };

                    let newRegs;
                    let newIdx;
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
                    if (currentRow < 0 || currentRow >= nestedRegisters.length)
                      return;
                    e.preventDefault();
                    e.stopPropagation();
                    const newRegs = nestedRegisters.filter(
                      (_: any, idx: number) => idx !== currentRow,
                    );
                    onUpdate(["registers"], newRegs);
                    const nextRow =
                      currentRow > 0
                        ? currentRow - 1
                        : newRegs.length > 0
                          ? 0
                          : -1;
                    setSelectedRegIndex(nextRow);
                    setHoveredRegIndex(nextRow);
                    return;
                  }

                  if (isArrow) {
                    e.preventDefault();
                    const isVertical =
                      normalizedKey === "ArrowUp" ||
                      normalizedKey === "ArrowDown";
                    const delta =
                      normalizedKey === "ArrowUp" ||
                      normalizedKey === "ArrowLeft"
                        ? -1
                        : 1;
                    if (isVertical) {
                      const next = Math.max(
                        0,
                        Math.min(
                          nestedRegisters.length - 1,
                          currentRow + delta,
                        ),
                      );
                      setSelectedRegIndex(next);
                      setHoveredRegIndex(next);
                      setRegActiveCell({
                        rowIndex: next,
                        key: regActiveCell.key,
                      });
                      scrollToCell(next, regActiveCell.key);
                    } else {
                      // Horizontal nav
                      const REG_COLUMN_ORDER = [
                        "name",
                        "offset",
                        "access",
                        "description",
                      ];
                      const currentKey = regActiveCell.key;
                      const currentCol = Math.max(
                        0,
                        REG_COLUMN_ORDER.indexOf(currentKey),
                      );
                      const nextCol = Math.max(
                        0,
                        Math.min(
                          REG_COLUMN_ORDER.length - 1,
                          currentCol + delta,
                        ),
                      );
                      const nextKey = REG_COLUMN_ORDER[nextCol] as any;
                      setRegActiveCell({ rowIndex: currentRow, key: nextKey });
                      scrollToCell(currentRow, nextKey);
                    }
                  }

                  if (isEdit) {
                    e.preventDefault();
                    e.stopPropagation();
                    setRegActiveCell({
                      rowIndex: currentRow,
                      key: regActiveCell.key,
                    });
                  }
                }}
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
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Name
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Offset
                      </th>
                      <th className="px-4 py-3 border-b vscode-border align-middle">
                        Access
                      </th>
                      <th className="px-6 py-3 border-b vscode-border align-middle">
                        Description
                      </th>
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
                          className={`group transition-colors border-l-4 border-transparent h-12 ${
                            isSelected
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
                            setRegActiveCell((prev) => ({
                              rowIndex: idx,
                              key: prev.key,
                            }));
                          }}
                        >
                          {/* NAME */}
                          <td
                            data-col-key="name"
                            className={`px-6 py-2 font-medium align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "name" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setRegActiveCell({ rowIndex: idx, key: "name" });
                            }}
                          >
                            {regActiveCell.rowIndex === idx &&
                            regActiveCell.key === "name" ? (
                              <VSCodeTextField
                                value={reg.name || ""}
                                onInput={(e: any) =>
                                  onUpdate(
                                    ["registers", idx, "name"],
                                    e.target.value,
                                  )
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
                            className={`px-4 py-2 font-mono text-xs align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "offset" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setRegActiveCell({
                                rowIndex: idx,
                                key: "offset",
                              });
                            }}
                          >
                            {regActiveCell.rowIndex === idx &&
                            regActiveCell.key === "offset" ? (
                              <VSCodeTextField
                                value={String(regOffset)}
                                onInput={(e: any) => {
                                  const val = parseInt(e.target.value, 10);
                                  if (!isNaN(val) && val >= 0) {
                                    onUpdate(["registers", idx, "offset"], val);
                                    onUpdate(
                                      ["registers", idx, "address_offset"],
                                      val,
                                    );
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
                            className={`px-4 py-2 text-xs align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "access" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setRegActiveCell({
                                rowIndex: idx,
                                key: "access",
                              });
                            }}
                          >
                            {regActiveCell.rowIndex === idx &&
                            regActiveCell.key === "access" ? (
                              <VSCodeDropdown
                                value={reg.access || "read-write"}
                                onInput={(e: any) =>
                                  onUpdate(
                                    ["registers", idx, "access"],
                                    e.target.value,
                                  )
                                }
                                className="w-full"
                              >
                                {["read-write", "read-only", "write-only"].map(
                                  (opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ),
                                )}
                              </VSCodeDropdown>
                            ) : (
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-semibold bg-opacity-20 ${
                                  reg.access === "read-only"
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
                            className={`px-6 py-2 align-middle ${regActiveCell.rowIndex === idx && regActiveCell.key === "description" ? "vscode-cell-active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedRegIndex(idx);
                              setRegActiveCell({
                                rowIndex: idx,
                                key: "description",
                              });
                            }}
                          >
                            {regActiveCell.rowIndex === idx &&
                            regActiveCell.key === "description" ? (
                              <VSCodeTextField
                                value={reg.description || ""}
                                onInput={(e: any) =>
                                  onUpdate(
                                    ["registers", idx, "description"],
                                    e.target.value,
                                  )
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
                        <td
                          colSpan={4}
                          className="px-4 py-8 text-center vscode-muted"
                        >
                          No nested registers. Press{" "}
                          <kbd className="px-1 rounded vscode-surface-alt">
                            o
                          </kbd>{" "}
                          to add one.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex-none p-4 bg-vscode-editor-background border-t vscode-border flex justify-between items-center">
              <p className="text-xs vscode-muted">
                These registers are replicated {arr.count || 1} times at{" "}
                {arr.stride || 4}-byte intervals.
              </p>
              <KeyboardShortcutsButton context="array" />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="p-6 vscode-muted">Select an item to view details</div>
    );
  },
);

export default DetailsPanel;
