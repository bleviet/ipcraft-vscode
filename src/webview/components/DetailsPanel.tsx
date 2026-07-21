/**
 * DetailsPanel — thin routing coordinator.
 *
 * Determines which sub-editor to show based on selectedType, handles the
 * array-element masquerade pattern, and exposes a focus() imperative handle.
 * All rendering / editing logic lives in the sub-components.
 */
import React, { useImperativeHandle, useMemo, useRef } from 'react';
import { RegisterDef } from '../types/memoryMap';
import type { YamlUpdateHandler, YamlPath } from '../types/editor';

import { RegisterEditor } from './register/RegisterEditor';
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
  blockLayout: 'stacked' | 'side-by-side';
  toggleBlockLayout: () => void;
  memoryMapLayout: 'stacked' | 'side-by-side';
  toggleMemoryMapLayout: () => void;
  arrayLayout: 'stacked' | 'side-by-side';
  toggleArrayLayout: () => void;
  selectionMeta?: {
    absoluteAddress?: number;
    relativeOffset?: number;
    focusDetails?: boolean;
    activeRegisterIndex?: number;
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
    memoryMapLayout,
    toggleMemoryMapLayout,
    arrayLayout,
    toggleArrayLayout,
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

    if (registers.length === 0) {
      // Flat register array: every element shares one bit-field template, so an
      // element edits the array's own fields directly (no path remapping).
      selectedType = 'register';
      selectedObject = arr;

      if (arr.__element_base !== undefined) {
        selectionMeta = {
          ...(rawSelectionMeta ?? {}),
          absoluteAddress: arr.__element_base as number,
        };
      }
    } else if (registers.length === 1) {
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
        selectedObject = { ...arr, baseAddress: arr.__element_base };
        selectionMeta = {
          ...(rawSelectionMeta ?? {}),
          absoluteAddress: arr.__element_base as number,
        };
      }
      // Updates to ['registers', idx, prop] work natively on the Array object.
    }
  }

  // -----------------------------------------------------------------------
  // Imperative handle — forward focus() to the active sub-editor's
  // keyboard table container. Every sub-editor renders exactly one
  // container tagged with a data-*-table="true" attribute (from
  // useTableEditorState / useFieldEditor); the BitFieldVisualizer also
  // has tabIndex={0} but is NOT a valid focus target for panel
  // switching, so we scope the query to the table markers.
  // -----------------------------------------------------------------------
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        const container = wrapperRef.current?.querySelector<HTMLElement>(
          '[data-fields-table], [data-blocks-table], [data-regs-table], [data-registers-table]'
        );
        container?.focus();
      },
    }),
    []
  );

  // -----------------------------------------------------------------------
  // Derived: normalised fields for the register view
  // -----------------------------------------------------------------------
  const isRegister = selectedType === 'register' && !!selectedObject;
  const reg = isRegister ? (selectedObject as RegisterDef) : null;

  const fields = useMemo(() => reg?.fields ?? [], [reg?.fields]);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (!selectedObject) {
    return (
      <div
        ref={wrapperRef}
        className="flex items-center justify-center h-full vscode-muted text-sm"
      >
        Select an item to view details
      </div>
    );
  }

  if (selectedType === 'register' && reg) {
    return (
      <div ref={wrapperRef} className="h-full">
        <RegisterEditor
          register={reg}
          fields={fields}
          selectionMeta={selectionMeta}
          registerLayout={registerLayout}
          toggleRegisterLayout={toggleRegisterLayout}
          onUpdate={onUpdate}
        />
      </div>
    );
  }

  if (selectedType === 'memoryMap') {
    return (
      <div ref={wrapperRef} className="h-full">
        <MemoryMapEditor
          memoryMap={selectedObject as Parameters<typeof MemoryMapEditor>[0]['memoryMap']}
          memoryMapLayout={memoryMapLayout}
          toggleMemoryMapLayout={toggleMemoryMapLayout}
          selectionMeta={selectionMeta}
          onUpdate={onUpdate}
          onNavigateToBlock={onNavigateToBlock}
        />
      </div>
    );
  }

  if (selectedType === 'block') {
    return (
      <div ref={wrapperRef} className="h-full">
        <BlockEditor
          block={selectedObject as Parameters<typeof BlockEditor>[0]['block']}
          registerLayout={registerLayout}
          toggleRegisterLayout={toggleRegisterLayout}
          selectionMeta={selectionMeta}
          onUpdate={onUpdate}
          onNavigateToRegister={onNavigateToRegister}
        />
      </div>
    );
  }

  if (selectedType === 'array') {
    return (
      <div ref={wrapperRef} className="h-full">
        <RegisterArrayEditor
          registerArray={
            selectedObject as Parameters<typeof RegisterArrayEditor>[0]['registerArray']
          }
          arrayLayout={arrayLayout}
          toggleArrayLayout={toggleArrayLayout}
          selectionMeta={selectionMeta}
          onUpdate={onUpdate}
        />
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="flex items-center justify-center h-full vscode-muted text-sm">
      Select an item to view details
    </div>
  );
});

DetailsPanel.displayName = 'DetailsPanel';

export default DetailsPanel;
