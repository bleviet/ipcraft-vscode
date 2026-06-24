import React, { useEffect } from 'react';
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition';

export interface TableContextMenuProps {
  position: { x: number; y: number } | null;
  onInsertAbove?: () => void;
  onInsertBelow?: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function TableContextMenu({
  position,
  onInsertAbove,
  onInsertBelow,
  onDelete,
  onClose,
}: TableContextMenuProps) {
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

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm"
      style={{ left: adjusted.x, top: adjusted.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {onInsertAbove && (
        <button
          className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
          onClick={() => {
            onInsertAbove();
            onClose();
          }}
        >
          <span className="codicon codicon-arrow-up text-xs" />
          Insert Above
        </button>
      )}
      {onInsertBelow && (
        <button
          className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
          onClick={() => {
            onInsertBelow();
            onClose();
          }}
        >
          <span className="codicon codicon-arrow-down text-xs" />
          Insert Below
        </button>
      )}
      {(onInsertAbove ?? onInsertBelow) && <div className="border-t vscode-border my-0.5" />}
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
