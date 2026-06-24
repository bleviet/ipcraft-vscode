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
import { useClampedMenuPosition } from '../shared/hooks/useClampedMenuPosition';

function parseAddressString(val: string): number | null {
  const cleaned = val.trim();
  if (!cleaned) {
    return null;
  }

  // Try standard direct parsing (handles decimal and 0x prefix)
  const direct = Number(cleaned);
  if (Number.isFinite(direct)) {
    return direct;
  }

  // Handle trailing 'h' or 'H' (e.g. 1000h, 40h)
  if (/^[0-9a-fA-F]+[hH]$/.test(cleaned)) {
    const hexVal = parseInt(cleaned.slice(0, -1), 16);
    if (!isNaN(hexVal)) {
      return hexVal;
    }
  }

  // Handle 'h' or 'H' prefix or quote format (e.g. h1000, 'h1000, 16'h1000)
  const hexPrefixMatch = cleaned.match(/(?:'?[hH])([0-9a-fA-F]+)$/);
  if (hexPrefixMatch) {
    const hexVal = parseInt(hexPrefixMatch[1], 16);
    if (!isNaN(hexVal)) {
      return hexVal;
    }
  }

  return null;
}

interface OutlineProps {
  memoryMap: NormalizedMemoryMap;
  selectedId: string | null;
  onSelect: (selection: OutlineSelection) => void;
  onRename?: (path: YamlPath, newName: string | number) => void;
  onRegisterAction?: (
    blockIndex: number,
    regIndex: number | undefined,
    action: 'insertBefore' | 'insertAfter' | 'delete',
    kind?: 'register' | 'flat-array' | 'array',
    parentRegIndex?: number
  ) => void;
  onBlockAction?: (
    blockIndex: number,
    action: 'insertBefore' | 'insertAfter' | 'delete',
    kind?: 'block' | 'ram'
  ) => void;
}

export type OutlineHandle = {
  focus: () => void;
};

const Outline = React.forwardRef<OutlineHandle, OutlineProps>(
  ({ memoryMap, selectedId, onSelect, onRename, onRegisterAction, onBlockAction }, ref) => {
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

    const [editingBaseId, setEditingBaseId] = useState<string | null>(null);
    const [editingBaseValue, setEditingBaseValue] = useState('');
    const editBaseInputRef = useRef<HTMLInputElement | null>(null);
    const [outlineContextMenu, setOutlineContextMenu] = useState<{
      x: number;
      y: number;
      blockIndex: number;
      regIndex?: number;
      parentRegIndex?: number;
    } | null>(null);

    const outlineMenuPos = useClampedMenuPosition(
      outlineContextMenu ? { x: outlineContextMenu.x, y: outlineContextMenu.y } : null
    );

    useEffect(() => {
      if (!outlineContextMenu) {
        return;
      }
      const handlePointerDown = (e: PointerEvent) => {
        if (
          outlineMenuPos.menuRef.current &&
          !outlineMenuPos.menuRef.current.contains(e.target as Node)
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

    const startEditingBase = (id: string, currentAddress: number) => {
      if (!onRename) {
        return;
      }
      setEditingBaseId(id);
      setEditingBaseValue(`0x${currentAddress.toString(16).toUpperCase()}`);
      setTimeout(() => {
        editBaseInputRef.current?.focus();
        editBaseInputRef.current?.select();
      }, 0);
    };

    const commitEditBase = (path: YamlPath) => {
      if (!onRename || !editingBaseId) {
        return;
      }
      const parsed = parseAddressString(editingBaseValue);
      if (parsed !== null && parsed >= 0) {
        const trimmed = editingBaseValue.trim();
        const isHexInput =
          trimmed.startsWith('0x') || trimmed.startsWith('0X') || /[hH]$/.test(trimmed);
        if (isHexInput) {
          onRename([...path, 'baseAddress'], `0x${parsed.toString(16).toUpperCase()}`);
        } else {
          onRename([...path, 'baseAddress'], parsed);
        }
      }
      setEditingBaseId(null);
      setEditingBaseValue('');
      treeFocusRef.current?.focus();
    };

    const cancelEditBase = () => {
      setEditingBaseId(null);
      setEditingBaseValue('');
      treeFocusRef.current?.focus();
    };

    const renderBaseAddressOrEdit = (id: string, baseAddress: number, path: YamlPath) => {
      if (editingBaseId === id) {
        return (
          <input
            ref={editBaseInputRef}
            type="text"
            className="outline-inline-edit px-1 py-0 text-sm font-mono rounded border shrink-0"
            style={{
              background: 'var(--vscode-input-background)',
              color: 'var(--vscode-input-foreground)',
              borderColor: 'var(--vscode-focusBorder)',
              minWidth: '80px',
              width: `${Math.max(80, editingBaseValue.length * 8)}px`,
            }}
            value={editingBaseValue}
            onChange={(e) => setEditingBaseValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                commitEditBase(path);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                cancelEditBase();
              }
            }}
            onBlur={() => commitEditBase(path)}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        );
      }
      return (
        <span
          className="text-[10px] vscode-muted font-mono shrink-0 cursor-pointer hover:underline"
          title="Double click to change base address"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditingBase(id, baseAddress);
          }}
        >
          @ 0x{baseAddress.toString(16).toUpperCase()}
        </span>
      );
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
      return <span className={`${className ?? ''} truncate min-w-[1ch]`}>{name}</span>;
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
      editingId: editingId ?? editingBaseId,
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
                className={`codicon codicon-chevron-${isRootExpanded ? 'down' : 'right'} text-[16px] shrink-0 ${
                  isRootSelected ? '' : 'opacity-70'
                }`}
                onClick={(e) => toggleExpand(rootId, e)}
              ></span>
              <span
                className={`codicon codicon-map text-[16px] shrink-0 ${isRootSelected ? '' : 'opacity-70'}`}
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
                renderBaseAddressOrEdit={renderBaseAddressOrEdit}
                startEditing={startEditing}
                onRegisterContextMenu={
                  onRegisterAction
                    ? (bi, ri, x, y, parentRegIndex) =>
                        setOutlineContextMenu({
                          x,
                          y,
                          blockIndex: bi,
                          regIndex: ri,
                          parentRegIndex,
                        })
                    : undefined
                }
                onBlockContextMenu={
                  onBlockAction
                    ? (bi, x, y) => setOutlineContextMenu({ x, y, blockIndex: bi })
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
        {outlineContextMenu && (onRegisterAction ?? onBlockAction) && (
          <div
            ref={outlineMenuPos.menuRef}
            className="fixed z-[200] min-w-[160px] rounded-lg shadow-xl border vscode-border vscode-surface overflow-hidden text-sm py-1"
            style={{
              left: (outlineMenuPos.adjusted ?? outlineContextMenu).x,
              top: (outlineMenuPos.adjusted ?? outlineContextMenu).y,
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {outlineContextMenu.parentRegIndex !== undefined ? (
              // Inside a register array or flat array context
              outlineContextMenu.regIndex === undefined ? (
                // Array element node context menu: only allow to insert register
                <>
                  <button
                    className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                    onClick={() => {
                      onRegisterAction?.(
                        outlineContextMenu.blockIndex,
                        undefined,
                        'insertAfter',
                        'register',
                        outlineContextMenu.parentRegIndex
                      );
                      setOutlineContextMenu(null);
                    }}
                  >
                    <span className="codicon codicon-symbol-field text-xs" />
                    Insert Register
                  </button>
                </>
              ) : (
                // Child register node context menu: only allow to insert register (above/below) and delete
                <>
                  <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                    Insert Above
                  </div>
                  <button
                    className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                    onClick={() => {
                      onRegisterAction?.(
                        outlineContextMenu.blockIndex,
                        outlineContextMenu.regIndex,
                        'insertBefore',
                        'register',
                        outlineContextMenu.parentRegIndex
                      );
                      setOutlineContextMenu(null);
                    }}
                  >
                    <span className="codicon codicon-symbol-field text-xs" />
                    Register
                  </button>

                  <div className="border-t vscode-border my-1" />

                  <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                    Insert Below
                  </div>
                  <button
                    className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                    onClick={() => {
                      onRegisterAction?.(
                        outlineContextMenu.blockIndex,
                        outlineContextMenu.regIndex,
                        'insertAfter',
                        'register',
                        outlineContextMenu.parentRegIndex
                      );
                      setOutlineContextMenu(null);
                    }}
                  >
                    <span className="codicon codicon-symbol-field text-xs" />
                    Register
                  </button>

                  <div className="border-t vscode-border my-0.5" />

                  <button
                    className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                    style={{ color: 'var(--vscode-errorForeground)' }}
                    onClick={() => {
                      onRegisterAction?.(
                        outlineContextMenu.blockIndex,
                        outlineContextMenu.regIndex,
                        'delete',
                        undefined,
                        outlineContextMenu.parentRegIndex
                      );
                      setOutlineContextMenu(null);
                    }}
                  >
                    <span className="codicon codicon-trash text-xs" />
                    Delete
                  </button>
                </>
              )
            ) : outlineContextMenu.regIndex === undefined ? (
              // Address Block context menu
              <>
                <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                  Insert Above
                </div>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onBlockAction?.(outlineContextMenu.blockIndex, 'insertBefore', 'block');
                    setOutlineContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-package text-xs" />
                  Address Block
                </button>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onBlockAction?.(outlineContextMenu.blockIndex, 'insertBefore', 'ram');
                    setOutlineContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-database text-xs" />
                  RAM
                </button>

                <div className="border-t vscode-border my-1" />

                <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                  Insert Below
                </div>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onBlockAction?.(outlineContextMenu.blockIndex, 'insertAfter', 'block');
                    setOutlineContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-package text-xs" />
                  Address Block
                </button>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onBlockAction?.(outlineContextMenu.blockIndex, 'insertAfter', 'ram');
                    setOutlineContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-database text-xs" />
                  RAM
                </button>

                <div className="border-t vscode-border my-0.5" />

                <button
                  className="w-full text-left px-4 py-2 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  style={{ color: 'var(--vscode-errorForeground)' }}
                  onClick={() => {
                    onBlockAction?.(outlineContextMenu.blockIndex, 'delete');
                    setOutlineContextMenu(null);
                  }}
                >
                  <span className="codicon codicon-trash text-xs" />
                  Delete
                </button>
              </>
            ) : (
              // Register/RegisterArray context menu
              <>
                <div className="px-3 py-1 text-xs font-semibold vscode-muted bg-[var(--vscode-editorWidget-background)] uppercase tracking-wider">
                  Insert Above
                </div>
                <button
                  className="w-full text-left px-4 py-1.5 flex items-center gap-2 cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)] transition-colors"
                  onClick={() => {
                    onRegisterAction?.(
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
                    onRegisterAction?.(
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
                    onRegisterAction?.(
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
                    onRegisterAction?.(
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
                    onRegisterAction?.(
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
                    onRegisterAction?.(
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
                    onRegisterAction?.(
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
              </>
            )}
          </div>
        )}
      </>
    );
  }
);

export default Outline;
