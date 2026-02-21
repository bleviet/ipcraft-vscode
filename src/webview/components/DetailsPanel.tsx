/**
 * DetailsPanel — thin routing coordinator.
 *
 * Determines which sub-editor to show based on selectedType, handles the
 * array-element masquerade pattern, and exposes a focus() imperative handle.
 * All rendering / editing logic lives in the sub-components.
 */
import React, { useImperativeHandle, useMemo, useRef } from 'react';
import { Register } from '../types/memoryMap';
import type { YamlUpdateHandler, YamlPath } from '../types/editor';

import { RegisterEditor, RegisterEditorHandle } from './register/RegisterEditor';
import { MemoryMapEditor } from './memorymap/MemoryMapEditor';
import { BlockEditor } from './memorymap/BlockEditor';
import { RegisterArrayEditor } from './memorymap/RegisterArrayEditor';

// ---------------------------------------------------------------------------
// Public types (kept here so importers don't need to change)
// ---------------------------------------------------------------------------

export interface DetailsPanelProps {
  selectedType: 'memoryMap' | 'block' | 'register' | 'array' | null;
  selectedObject: unknown;
  registerLayout: 'stacked' | 'side-by-side';
  toggleRegisterLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
  };
  onUpdate: YamlUpdateHandler;
  onNavigateToRegister?: (regIndex: number) => void;
  onNavigateToBlock?: (blockIndex: number) => void;
}

export type DetailsPanelHandle = {
  focus: () => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DetailsPanel = React.forwardRef<DetailsPanelHandle, DetailsPanelProps>((props, ref) => {
  const {
    selectedType: rawSelectedType,
    selectedObject: rawSelectedObject,
    selectionMeta: rawSelectionMeta,
    registerLayout,
    toggleRegisterLayout,
    onUpdate: rawOnUpdate,
    onNavigateToRegister,
    onNavigateToBlock,
  } = props;

  // -----------------------------------------------------------------------
  // Array-element masquerade
  // When selecting a specific element of an array (e.g. TIMER[0]) we render
  // it as either a register view (single-register arrays) or a block view
  // (multi-register arrays) so the user sees the correct editor.
  // -----------------------------------------------------------------------
  let selectedType = rawSelectedType;
  let selectedObject = rawSelectedObject;
  let selectionMeta = rawSelectionMeta;
  let onUpdate = rawOnUpdate;

  if (
    rawSelectedType === 'array' &&
    (rawSelectedObject as Record<string, unknown>)?.__element_index !== undefined
  ) {
    const arr = rawSelectedObject as Record<string, unknown> & { registers?: unknown[] };
    const registers: unknown[] = (arr.registers as unknown[]) || [];

    if (registers.length === 1) {
      // Single Register: Masquerade as a single Register View
      selectedType = 'register';
      selectedObject = registers[0];

      if (arr.__element_base !== undefined) {
        selectionMeta = {
          ...(rawSelectionMeta ?? {}),
          absoluteAddress: arr.__element_base as number,
        };
      }

      onUpdate = (path: YamlPath, value: unknown) => {
        rawOnUpdate(['registers', 0, ...path], value);
      };
    } else {
      // Multiple Registers: Masquerade as a Block View
      selectedType = 'block';
      selectedObject = arr;

      if (arr.__element_base !== undefined) {
        selectedObject = { ...arr, base_address: arr.__element_base };
        selectionMeta = {
          ...(rawSelectionMeta ?? {}),
          absoluteAddress: arr.__element_base as number,
        };
      }
      // Updates to ['registers', idx, prop] work natively on the Array object.
    }
  }

  // -----------------------------------------------------------------------
  // Imperative handle — forward focus() to the active sub-editor
  // -----------------------------------------------------------------------
  const registerEditorRef = useRef<RegisterEditorHandle | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (selectedType === 'register') {
          registerEditorRef.current?.focus();
        }
        // MemoryMapEditor, BlockEditor and RegisterArrayEditor manage focus
        // internally via their own focusDetails handling.
      },
    }),
    [selectedType]
  );

  // -----------------------------------------------------------------------
  // Derived: normalised fields for the register view
  // -----------------------------------------------------------------------
  const isRegister = selectedType === 'register' && !!selectedObject;
  const reg = isRegister ? (selectedObject as Register) : null;

  const fields = useMemo(() => {
    if (!reg?.fields) {
      return [];
    }
    return reg.fields.map((f) => {
      if (f.bit_range) {
        return f;
      }
      if (f.bit_offset !== undefined && f.bit_width !== undefined) {
        const lo = Number(f.bit_offset);
        const width = Number(f.bit_width);
        const hi = lo + width - 1;
        return { ...f, bit_range: [hi, lo] };
      }
      return f;
    });
  }, [reg?.fields]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!selectedObject) {
    return (
      <div className="flex items-center justify-center h-full vscode-muted text-sm">
        Select an item to view details
      </div>
    );
  }

  if (selectedType === 'register' && reg) {
    return (
      <RegisterEditor
        ref={registerEditorRef}
        register={reg}
        fields={fields}
        selectionMeta={selectionMeta}
        registerLayout={registerLayout}
        toggleRegisterLayout={toggleRegisterLayout}
        onUpdate={onUpdate}
      />
    );
  }

  if (selectedType === 'memoryMap') {
    return (
      <MemoryMapEditor
        memoryMap={selectedObject as Parameters<typeof MemoryMapEditor>[0]['memoryMap']}
        selectionMeta={selectionMeta}
        onUpdate={onUpdate}
        onNavigateToBlock={onNavigateToBlock}
      />
    );
  }

  if (selectedType === 'block') {
    return (
      <BlockEditor
        block={selectedObject as Parameters<typeof BlockEditor>[0]['block']}
        selectionMeta={selectionMeta}
        onUpdate={onUpdate}
        onNavigateToRegister={onNavigateToRegister}
      />
    );
  }

  if (selectedType === 'array') {
    return (
      <RegisterArrayEditor
        registerArray={selectedObject as Parameters<typeof RegisterArrayEditor>[0]['registerArray']}
        onUpdate={onUpdate}
      />
    );
  }

  return (
    <div className="flex items-center justify-center h-full vscode-muted text-sm">
      Select an item to view details
    </div>
  );
});

DetailsPanel.displayName = 'DetailsPanel';

export default DetailsPanel;
