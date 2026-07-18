import React, { useEffect, useState } from 'react';
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition';

export interface AnchoredPickerMenuItem {
  /**
   * `null` represents a "clear selection" entry (e.g. "-- none --"). Kept
   * distinct from `string` rather than an empty-string sentinel so callers
   * do not need a magic-value convention.
   */
  value: string | null;
  label: string;
}

export interface AnchoredPickerMenuProps {
  position: { x: number; y: number } | null;
  items: AnchoredPickerMenuItem[];
  selectedValue: string | null;
  onSelect: (value: string | null) => void;
  onClose: () => void;
}

/**
 * Fixed-position anchored menu for picking one value from a short list.
 * Same proven pattern as `TableContextMenu`/`RegisterActionsMenu`: fixed
 * positioning escapes scroll containers and sticky headers entirely, so it
 * has no clipping problem by construction.
 */
export function AnchoredPickerMenu({
  position,
  items,
  selectedValue,
  onSelect,
  onClose,
}: AnchoredPickerMenuProps) {
  const { menuRef, adjusted } = useClampedMenuPosition(position);
  const [highlightIndex, setHighlightIndex] = useState(0);

  // Reset the keyboard highlight to the currently selected item whenever the
  // menu (re)opens at a new position.
  useEffect(() => {
    if (!position) {
      return;
    }
    const selectedIndex = items.findIndex((item) => item.value === selectedValue);
    setHighlightIndex(Math.max(0, selectedIndex));
    // Deliberately keyed on `position` only: this should reset the highlight
    // when the menu opens/moves, not on every items/selectedValue identity
    // change (those are recomputed on each render of the caller).
  }, [position]);

  useEffect(() => {
    if (!position) {
      return;
    }
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIndex((i) => Math.min(items.length - 1, i + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const item = items[highlightIndex];
        if (item) {
          onSelect(item.value);
          onClose();
        }
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [position, onClose, onSelect, items, highlightIndex, menuRef]);

  if (!adjusted) {
    return null;
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] min-w-[160px] max-h-[280px] overflow-y-auto rounded-lg shadow-xl border vscode-border vscode-surface text-sm py-1"
      style={{ left: adjusted.x, top: adjusted.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={item.value ?? '__none__'}
          type="button"
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors ${
            i === highlightIndex ? 'bg-[var(--vscode-list-hoverBackground)]' : ''
          }`}
          onClick={() => {
            onSelect(item.value);
            onClose();
          }}
        >
          <span
            className={`codicon codicon-check text-xs shrink-0 ${
              item.value === selectedValue ? '' : 'opacity-0'
            }`}
          />
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
