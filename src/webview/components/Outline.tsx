import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { MemoryMap, Register, RegisterArray } from '../types/memoryMap';
import { toHex } from '../utils/formatUtils';
import { OutlineHeader } from './outline';
import {
  type BlockNode as BlockModel,
  type OutlineSelection,
  type YamlPath,
  isArrayNode,
} from './outline/types';
import { ROOT_ID, arrayRegisterId, blockId, registerArrayId } from './outline/outlineIds';
import { buildVisibleSelections } from './outline/buildVisibleSelections';
import { useOutlineKeyboard } from './outline/useOutlineKeyboard';
import OutlineTreeNodes from './outline/OutlineTreeNodes';

interface OutlineProps {
  memoryMap: MemoryMap;
  selectedId: string | null;
  onSelect: (selection: OutlineSelection) => void;
  onRename?: (path: YamlPath, newName: string) => void;
}

export type OutlineHandle = {
  focus: () => void;
};

const Outline = React.forwardRef<OutlineHandle, OutlineProps>(
  ({ memoryMap, selectedId, onSelect, onRename }, ref) => {
    const memoryMapName = memoryMap.name || 'Memory Map';

    const allIds = useMemo(() => {
      const ids = new Set<string>([ROOT_ID]);
      (memoryMap.address_blocks ?? []).forEach((block, blockIdx) => {
        const blockNodeId = blockId(blockIdx);
        ids.add(blockNodeId);
        const regs = (block as BlockModel).registers ?? [];
        regs.forEach((reg: Register | { __kind?: string }, regIdx: number) => {
          if (reg?.__kind === 'array') {
            ids.add(arrayRegisterId(blockIdx, regIdx));
          }
        });
        ((block as BlockModel).register_arrays ?? []).forEach(
          (_: RegisterArray, arrIdx: number) => {
            ids.add(registerArrayId(blockIdx, arrIdx));
          }
        );
      });
      return ids;
    }, [memoryMap]);

    const [expanded, setExpanded] = useState<Set<string>>(allIds);
    const [query, setQuery] = useState('');
    const treeFocusRef = useRef<HTMLDivElement | null>(null);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const editInputRef = useRef<HTMLInputElement | null>(null);

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
      const blocks = (memoryMap.address_blocks ?? []).map((block, index) => ({
        block: block as BlockModel,
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
        if (
          regs.some((r: Register | { name?: string }) => {
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
          })
        ) {
          return true;
        }
        const arrays = block.register_arrays ?? [];
        return arrays.some((a: RegisterArray) => (a.name ?? '').toLowerCase().includes(q));
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
            >
              <span
                className={`codicon codicon-chevron-${isRootExpanded ? 'down' : 'right'} text-[16px] ${
                  isRootSelected ? '' : 'opacity-70'
                }`}
                onClick={(e) => toggleExpand(rootId, e)}
              ></span>
              <span
                className={`codicon codicon-map text-[16px] ${isRootSelected ? '' : 'opacity-70'}`}
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
              />
            )}
          </div>
        </div>
        <div className="outline-footer p-3 text-xs vscode-muted flex justify-between">
          <span>{filteredBlocks.length} Items</span>
          <span>Base: {toHex(memoryMap.address_blocks?.[0]?.base_address ?? 0)}</span>
        </div>
      </>
    );
  }
);

export default Outline;
