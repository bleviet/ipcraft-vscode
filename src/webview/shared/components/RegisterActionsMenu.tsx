import React, { useEffect } from 'react';
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition';

export type RegisterInsertKind = 'register' | 'flat-array' | 'array';

export interface RegisterActionsMenuProps {
  position: { x: number; y: number } | null;
  onInsert: (where: 'above' | 'below', kind: RegisterInsertKind) => void;
  onDelete: () => void;
  onClose: () => void;
}

const INSERT_ITEMS: Array<{ kind: RegisterInsertKind; icon: string; label: string }> = [
  { kind: 'register', icon: 'codicon-symbol-field', label: 'Register' },
  { kind: 'flat-array', icon: 'codicon-symbol-array', label: 'Flat Array' },
  { kind: 'array', icon: 'codicon-symbol-struct', label: 'Nested Array' },
];

/**
 * Rich actions menu for a register row, matching the memory-map outline kebab menu.
 * Offers Insert Above / Insert Below (Register, Flat Array, Nested Array) and Delete.
 */
export function RegisterActionsMenu({
  position,
  onInsert,
  onDelete,
  onClose,
}: RegisterActionsMenuProps) {
  const { menuRef, adjusted } = useClampedMenuPosition(position);

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
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [position, onClose]);

  if (!adjusted) {
    return null;
  }

  const renderInsertGroup = (where: 'above' | 'below') => (
    <>
      <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
        Insert {where === 'above' ? 'Above' : 'Below'}
      </div>
      {INSERT_ITEMS.map((item) => (
        <button
          key={`${where}-${item.kind}`}
          className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
          onClick={() => {
            onInsert(where, item.kind);
            onClose();
          }}
        >
          <span className={`codicon ${item.icon} text-xs`} />
          {item.label}
        </button>
      ))}
    </>
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm py-1"
      style={{ left: adjusted.x, top: adjusted.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {renderInsertGroup('above')}
      <div className="border-t vscode-border my-1" />
      {renderInsertGroup('below')}
      <div className="border-t vscode-border my-0.5" />
      <button
        className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
        style={{ color: 'var(--vscode-errorForeground)' }}
        onClick={() => {
          onDelete();
          onClose();
        }}
      >
        <span className="codicon codicon-trash text-xs" />
        Delete
      </button>
    </div>
  );
}
