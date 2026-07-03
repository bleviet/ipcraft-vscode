import React, { useEffect } from 'react';
import { useClampedMenuPosition } from '../hooks/useClampedMenuPosition';
import { WIDTH_FUNCTION_HELP, WIDTH_EXPR_OPERATORS_NOTE } from '../utils/widthFunctionHelp';

export interface WidthFunctionHelpMenuProps {
  position: { x: number; y: number } | null;
  onClose: () => void;
}

/**
 * Reference popover listing every predefined width-expression function
 * (clog2, log2, ceil, floor, abs, min, max), shown from WidthField's info
 * button. Modeled on RegisterActionsMenu's themed fixed-position menu.
 */
export function WidthFunctionHelpMenu({ position, onClose }: WidthFunctionHelpMenuProps) {
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
      className="fixed z-[200] min-w-[280px] max-w-[360px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm py-2"
      style={{ left: adjusted.x, top: adjusted.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pb-1.5 text-xs font-semibold vscode-muted uppercase tracking-wider">
        Width Expression Functions
      </div>
      <div className="px-3 flex flex-col gap-2 max-h-[320px] overflow-y-auto">
        {(Object.keys(WIDTH_FUNCTION_HELP) as Array<keyof typeof WIDTH_FUNCTION_HELP>).map(
          (name) => {
            const entry = WIDTH_FUNCTION_HELP[name];
            return (
              <div key={name}>
                <div
                  className="font-mono text-xs"
                  style={{
                    color:
                      'var(--vscode-symbolIcon-functionForeground, var(--vscode-editor-foreground))',
                  }}
                >
                  {entry.signature}
                </div>
                <div className="text-xs vscode-muted">{entry.description}</div>
                <div className="font-mono text-[11px] vscode-muted opacity-70">
                  e.g. {entry.example}
                </div>
              </div>
            );
          }
        )}
      </div>
      <div className="border-t vscode-border mt-2 pt-1.5 px-3 text-[11px] vscode-muted opacity-80">
        {WIDTH_EXPR_OPERATORS_NOTE}
      </div>
    </div>
  );
}
