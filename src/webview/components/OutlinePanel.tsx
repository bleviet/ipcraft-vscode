import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { NormalizedMemoryMap, NormalizedRegister } from '../../domain/internal.types';
import { toHex } from '../utils/formatUtils';
import { OutlineHeader } from './outline/index';
import {
  type BlockNode as BlockModel,
  type OutlineSelection,
  type YamlPath,
  isArrayNode,
} from './outline/types';
import { ROOT_ID, arrayRegisterId, blockId } from './outline/outlineIds';
import { buildVisibleSelections } from './outline/buildVisibleSelections';
import { useOutlineKeyboard } from './outline/useOutlineKeyboard';
import OutlineTreeNodes from './outline/OutlineTreeNodes';

interface OutlineProps {
  memoryMap: NormalizedMemoryMap;
  selectedId: string | null;
  onSelect: (selection: OutlineSelection) => void;
  onRename?: (path: YamlPath, newName: string) => void;
  onRegisterAction?: (
    blockIndex: number,
    regIndex: number,
    action: 'insertBefore' | 'insertAfter' | 'delete',
    kind?: 'register' | 'flat-array' | 'array'
  ) => void;
}

export type OutlineHandle = {
  focus: () => void;
};

const Outline = React.forwardRef<OutlineHandle, OutlineProps>(
  ({ memoryMap, selectedId, onSelect, onRename, onRegisterAction }, ref) => {
    const memoryMapName = memoryMap.name || 'Memory Map';

    const allIds = useMemo(() => {
      const ids = new Set<string>([ROOT_ID]);
      (memoryMap.addressBlocks ?? []).forEach((block, blockIdx) => {
        const blockNodeId = blockId(blockIdx);
        ids.add(blockNodeId);
        const regs = block.registers ?? [];
        regs.forEach((reg: NormalizedRegister, regIdx: number) => {
          if (reg.__kind === 'array') {
            ids.add(arrayRegisterId(blockIdx, regIdx));
          }
        });
      });
      return ids;
    }, [memoryMap]);

    const [expanded, setExpanded] = useState<Set<string>>(allIds);
    const [query, setQuery] = useState('');
    const treeFocusRef = useRef<HTMLDivElement | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const outlineContextMenuRef = useRef<HTMLDivElement | null>(null);
    const [outlineContextMenu, setOutlineContextMenu] = useState<{
      x: number;
      y: number;
      blockIndex: number;
      regIndex: number;
    } | null>(null);

    useEffect(() => {
      if (!outlineContextMenu) {
        return;
      }
      const handlePointerDown = (e: PointerEvent) => {
        if (
          outlineContextMenuRef.current &&
          !outlineContextMenuRef.current.contains(e.target as Node)
        ) {
          setOutlineContextMenu(null);
        }
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setOutlineContextMenu(null);
        }
      };
      document.addEventListener('pointerdown', handlePointerDown);
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        document.removeEventListener('pointerdown', handlePointerDown);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }, [outlineContextMenu]);

    useEffect(() => {
      if (!selectedId) {
        return;
      }
      const el = treeFocusRef.current?.querySelector<HTMLElement>(
        `[data-outline-id="${CSS.escape(selectedId)}"]`
      );
      el?.scrollIntoView({ block: 'nearest' });
    }, [selectedId]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          treeFocusRef.current?.focus();
        },
      }),
      []
    );

    const toggleExpand = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      const newExpanded = new Set(expanded);
      if (newExpanded.has(id)) {
        newExpanded.delete(id);
      } else {
        newExpanded.add(id);
      }
      setExpanded(newExpanded);
    };

    const startEditing = (id: string, currentName: string) => {
      if (!onRename) {
        return;
      }
      setEditingId(id);
      setEditingValue(currentName);
      setTimeout(() => {
        editInputRef.current?.focus();
        editInputRef.current?.select();
      }, 0);
    };

    const commitEdit = (path: YamlPath) => {
      if (!onRename || !editingId) {
        return;
      }
      const trimmed = editingValue.trim();
      if (trimmed) {
        onRename([...path, 'name'], trimmed);
      }
      setEditingId(null);
      setEditingValue('');
      treeFocusRef.current?.focus();
    };

    const cancelEdit = () => {
      setEditingId(null);
      setEditingValue('');
      treeFocusRef.current?.focus();
    };

    const renderNameOrEdit = (id: string, name: string, path: YamlPath, className?: string) => {
      if (editingId === id) {
        return (
          <input
            ref={editInputRef}
            type="text"
            className="outline-inline-edit px-1 py-0 text-sm rounded border"
            style={{
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              borderColor: 'var(--vscode-focusBorder)',
              minWidth: '80px',
              width: `${Math.max(80, editingValue.length * 8)}px`,
            }}
            value={editingValue}
            onChange={(e) => setEditingValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commitEdit(path);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelEdit();
              }
            }}
            onBlur={() => commitEdit(path)}
            onClick={(e) => e.stopPropagation()}
          />
        );
      }
      return <span className={className}>{name}</span>;
    };

    const filteredBlocks = useMemo<Array<{ block: BlockModel; index: number }>>(() => {
      const q = query.trim().toLowerCase();
      const blocks = (memoryMap.addressBlocks ?? []).map((block, index) => ({
        block: block,
        index,
      }));
      if (!q) {
        return blocks;
      }

      return blocks.filter(({ block }) => {
        if ((block.name ?? '').toLowerCase().includes(q)) {
          return true;
        }
        const regs = block.registers ?? [];
        return regs.some((r: NormalizedRegister) => {
          if (!r) {
            return false;
          }
          if (
            String(r.name ?? '')
              .toLowerCase()
              .includes(q)
          ) {
            return true;
          }
          if (isArrayNode(r)) {
            return (r.registers ?? []).some((rr) =>
              String(rr.name ?? '')
                .toLowerCase()
                .includes(q)
            );
          }
          return false;
        });
      });
    }, [memoryMap, query]);

    const rootId = ROOT_ID;
    const isRootExpanded = expanded.has(rootId);
    const isRootSelected = selectedId === rootId;

    const visibleSelections = useMemo(() => {
      return buildVisibleSelections({
        memoryMap,
        memoryMapName,
        expanded,
        filteredBlocks,
      });
    }, [memoryMap, memoryMapName, expanded, filteredBlocks]);

    const onTreeKeyDown = useOutlineKeyboard({
      editingId,
      selectedId,
      rootId,
      visibleSelections,
      onSelect,
      onRename,
      startEditing,
      memoryMap,
      setExpanded,
    });

    return (
      <>
        <OutlineHeader
          query={query}
          onQueryChange={setQuery}
          isAllExpanded={expanded.size === allIds.size}
          onToggleAll={() => {
            if (expanded.size === allIds.size) {
              setExpanded(new Set(['root']));
            } else {
              setExpanded(new Set(allIds));
            }
          }}
        />
        <div className="flex-1 overflow-y-auto py-2">
          <div className="px-3 mb-2 text-xs font-bold vscode-muted uppercase tracking-wider">
            Memory Map
          </div>
          <div
            ref={treeFocusRef}
            tabIndex={0}
            role="tree"
            aria-label="Memory map outline"
            onKeyDown={onTreeKeyDown}
            className="outline-none focus:outline-none"
          >
            <div
              className={`tree-item ${isRootSelected ? 'selected' : ''} gap-2 text-sm`}
              role="treeitem"
              aria-expanded={isRootExpanded}
              aria-selected={isRootSelected}
              data-outline-id={rootId}
              onClick={() => {
                treeFocusRef.current?.focus();
                onSelect({
                  id: rootId,
                  type: 'memoryMap',
                  object: memoryMap,
                  breadcrumbs: [memoryMapName],
                  path: [],
                });
              }}
              onDoubleClick={() => startEditing(rootId, memoryMapName)}
            >
              <span
                className={`codicon codicon-chevron-${isRootExpanded ? 'down' : 'right'} text-[16px] ${
                  isRootSelected ? '' : 'opacity-70'
                }`}
                onClick={(e) => toggleExpand(rootId, e)}
              ></span>
              <span
                className={`codicon codicon-map text-[16px] ${isRootSelected ? '' : 'opacity-70'}`}
                title="Memory Map"
                style={{ color: 'var(--vscode-symbolIcon-namespaceForeground)' }}
              ></span>
              {renderNameOrEdit(rootId, memoryMapName, [], 'flex-1')}
            </div>
            {isRootExpanded && (
              <OutlineTreeNodes
                memoryMap={memoryMap}
                memoryMapName={memoryMapName}
                filteredBlocks={filteredBlocks}
                selectedId={selectedId}
                expanded={expanded}
                onToggleExpand={toggleExpand}
                onFocusTree={() => treeFocusRef.current?.focus()}
                onSelect={onSelect}
                renderNameOrEdit={renderNameOrEdit}
                startEditing={startEditing}
                onRegisterContextMenu={
                  onRegisterAction
                    ? (bi, ri, x, y) =>
                        setOutlineContextMenu({ x, y, blockIndex: bi, regIndex: ri })
                    : undefined
                }
              />
            )}
          </div>
        </div>
        <div className="outline-footer p-3 text-xs vscode-muted flex justify-between">
          <span>{filteredBlocks.length} Items</span>
          <span>Base: {toHex(memoryMap.addressBlocks?.[0]?.baseAddress ?? 0)}</span>
        </div>
        {outlineContextMenu && onRegisterAction && (
          <div
            ref={outlineContextMenuRef}
            className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm py-1"
            style={{ left: outlineContextMenu.x, top: outlineContextMenu.y }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
              Insert Above
            </div>
            <button
              className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'insertBefore',
                  'register'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-symbol-field text-xs" />
              Register
            </button>
            <button
              className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'insertBefore',
                  'flat-array'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-symbol-array text-xs" />
              Flat Array
            </button>
            <button
              className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'insertBefore',
                  'array'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-symbol-struct text-xs" />
              Nested Array
            </button>

            <div className="border-t vscode-border my-1" />

            <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
              Insert Below
            </div>
            <button
              className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'insertAfter',
                  'register'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-symbol-field text-xs" />
              Register
            </button>
            <button
              className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'insertAfter',
                  'flat-array'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-symbol-array text-xs" />
              Flat Array
            </button>
            <button
              className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'insertAfter',
                  'array'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-symbol-struct text-xs" />
              Nested Array
            </button>

            <div className="border-t vscode-border my-0.5" />

            <button
              className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
              style={{ color: 'var(--vscode-errorForeground)' }}
              onClick={() => {
                onRegisterAction(
                  outlineContextMenu.blockIndex,
                  outlineContextMenu.regIndex,
                  'delete'
                );
                setOutlineContextMenu(null);
              }}
            >
              <span className="codicon codicon-trash text-xs" />
              Delete
            </button>
          </div>
        )}
      </>
    );
  }
);

export default Outline;
