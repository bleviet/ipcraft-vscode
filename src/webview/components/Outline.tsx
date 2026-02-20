import React, { useImperativeHandle, useMemo, useRef, useState } from 'react';
import { MemoryMap, Register, RegisterArray } from '../types/memoryMap';
import { toHex } from '../utils/formatUtils';
import {
  BlockNode as OutlineBlockNode,
  OutlineHeader,
  RegisterArrayNode,
  RegisterNode,
} from './outline';
import {
  type BlockNode as BlockModel,
  type OutlineSelection,
  type YamlPath,
  isArrayNode,
} from './outline/types';

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
    const allIds = useMemo(() => {
      const ids = new Set<string>(['root']);
      (memoryMap.address_blocks ?? []).forEach((block, blockIdx) => {
        const blockId = `block-${blockIdx}`;
        ids.add(blockId);
        const regs = (block as BlockModel).registers ?? [];
        regs.forEach((reg: Register | { __kind?: string }, regIdx: number) => {
          if (reg?.__kind === 'array') {
            ids.add(`block-${blockIdx}-arrreg-${regIdx}`);
          }
        });
        ((block as BlockModel).register_arrays ?? []).forEach(
          (_: RegisterArray, arrIdx: number) => {
            ids.add(`block-${blockIdx}-arr-${arrIdx}`);
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

    const filteredBlocks = useMemo(() => {
      const q = query.trim().toLowerCase();
      const blocks = (memoryMap.address_blocks ?? []).map((block, index) => ({ block, index }));
      if (!q) {
        return blocks;
      }

      return blocks.filter(({ block }) => {
        if ((block.name ?? '').toLowerCase().includes(q)) {
          return true;
        }
        const regs = (block as BlockModel).registers ?? [];
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
        const arrays = (block as BlockModel).register_arrays ?? [];
        return arrays.some((a: RegisterArray) => (a.name ?? '').toLowerCase().includes(q));
      });
    }, [memoryMap, query]);

    const rootId = 'root';
    const isRootExpanded = expanded.has(rootId);
    const isRootSelected = selectedId === rootId;

    const visibleSelections = useMemo(() => {
      const items: OutlineSelection[] = [];

      items.push({
        id: rootId,
        type: 'memoryMap',
        object: memoryMap,
        breadcrumbs: [memoryMap.name || 'Memory Map'],
        path: [],
      });

      if (!expanded.has(rootId)) {
        return items;
      }

      filteredBlocks.forEach(({ block, index: blockIndex }) => {
        const blockId = `block-${blockIndex}`;
        items.push({
          id: blockId,
          type: 'block',
          object: block,
          breadcrumbs: [memoryMap.name || 'Memory Map', block.name],
          path: ['addressBlocks', blockIndex],
        });

        if (!expanded.has(blockId)) {
          return;
        }

        const regsAny = (block as BlockModel).registers ?? [];
        regsAny.forEach((node: unknown, regIndex: number) => {
          if (isArrayNode(node)) {
            const arr = node;
            const arrId = `block-${blockIndex}-arrreg-${regIndex}`;
            items.push({
              id: arrId,
              type: 'array',
              object: arr,
              breadcrumbs: [memoryMap.name || 'Memory Map', block.name, arr.name],
              path: ['addressBlocks', blockIndex, 'registers', regIndex],
            });

            if (!expanded.has(arrId)) {
              return;
            }

            const start = (block.base_address ?? 0) + (arr.address_offset ?? 0);
            Array.from({ length: arr.count }).forEach((_, elementIndex) => {
              const elementId = `${arrId}-el-${elementIndex}`;
              const elementBase = start + elementIndex * arr.stride;
              items.push({
                id: elementId,
                type: 'array',
                object: {
                  ...arr,
                  __element_index: elementIndex,
                  __element_base: elementBase,
                },
                breadcrumbs: [
                  memoryMap.name || 'Memory Map',
                  block.name,
                  `${arr.name}[${elementIndex}]`,
                ],
                path: ['addressBlocks', blockIndex, 'registers', regIndex],
              });

              (arr.registers ?? []).forEach((reg: Register, childIndex: number) => {
                const childId = `${elementId}-reg-${childIndex}`;
                const absolute = elementBase + (reg.address_offset ?? 0);
                items.push({
                  id: childId,
                  type: 'register',
                  object: reg,
                  breadcrumbs: [
                    memoryMap.name || 'Memory Map',
                    block.name,
                    `${arr.name}[${elementIndex}]`,
                    reg.name,
                  ],
                  path: [
                    'addressBlocks',
                    blockIndex,
                    'registers',
                    regIndex,
                    'registers',
                    childIndex,
                  ],
                  meta: {
                    absoluteAddress: absolute,
                    relativeOffset: reg.address_offset ?? 0,
                  },
                });
              });
            });
            return;
          }

          const reg = node as Register;
          const regId = `block-${blockIndex}-reg-${regIndex}`;
          const absolute = (block.base_address ?? 0) + (reg.address_offset ?? 0);
          items.push({
            id: regId,
            type: 'register',
            object: reg,
            breadcrumbs: [
              memoryMap.name || 'Memory Map',
              memoryMap.address_blocks?.[blockIndex]?.name ?? '',
              reg.name,
            ],
            path: ['addressBlocks', blockIndex, 'registers', regIndex],
            meta: {
              absoluteAddress: absolute,
              relativeOffset: reg.address_offset ?? 0,
            },
          });
        });

        ((block as BlockModel).register_arrays ?? []).forEach(
          (arr: RegisterArray, arrayIndex: number) => {
            const arrId = `block-${blockIndex}-arr-${arrayIndex}`;
            items.push({
              id: arrId,
              type: 'array',
              object: arr,
              breadcrumbs: [
                memoryMap.name || 'Memory Map',
                memoryMap.address_blocks?.[blockIndex]?.name ?? '',
                arr.name,
              ],
              path: ['addressBlocks', blockIndex, 'register_arrays', arrayIndex],
            });

            if (!expanded.has(arrId) || !Array.isArray(arr.registers)) {
              return;
            }

            arr.registers.forEach((reg: Register, regIndex: number) => {
              const regId = `block-${blockIndex}-reg-${regIndex}`;
              const absolute = (block.base_address ?? 0) + (reg.address_offset ?? 0);
              items.push({
                id: regId,
                type: 'register',
                object: reg,
                breadcrumbs: [
                  memoryMap.name || 'Memory Map',
                  memoryMap.address_blocks?.[blockIndex]?.name ?? '',
                  reg.name,
                ],
                path: ['addressBlocks', blockIndex, 'registers', regIndex],
                meta: {
                  absoluteAddress: absolute,
                  relativeOffset: reg.address_offset ?? 0,
                },
              });
            });
          }
        );
      });

      return items;
    }, [memoryMap, expanded, filteredBlocks]);

    const renderLeafRegister = (
      reg: Register,
      blockIndex: number,
      regIndex: number,
      paddingLeft = '40px'
    ) => {
      const id = `block-${blockIndex}-reg-${regIndex}`;
      const isSelected = selectedId === id;
      const block = memoryMap.address_blocks?.[blockIndex];
      const absolute = (block?.base_address ?? 0) + (reg.address_offset ?? 0);
      const path: YamlPath = ['addressBlocks', blockIndex, 'registers', regIndex];

      return (
        <RegisterNode
          key={id}
          id={id}
          isSelected={isSelected}
          onClick={() => {
            treeFocusRef.current?.focus();
            onSelect({
              id,
              type: 'register',
              object: reg,
              breadcrumbs: [
                memoryMap.name || 'Memory Map',
                memoryMap.address_blocks?.[blockIndex]?.name ?? '',
                reg.name,
              ],
              path,
              meta: {
                absoluteAddress: absolute,
                relativeOffset: reg.address_offset ?? 0,
              },
            });
          }}
          paddingLeft={paddingLeft}
          name={renderNameOrEdit(id, reg.name, path, 'flex-1')}
          offsetLabel={toHex(reg.address_offset)}
        />
      );
    };

    const renderArray = (arr: RegisterArray, blockIndex: number, arrayIndex: number) => {
      const id = `block-${blockIndex}-arr-${arrayIndex}`;
      const isSelected = selectedId === id;
      const isExpanded = expanded.has(id);

      return (
        <div key={id}>
          <div
            className={`tree-item ${isSelected ? 'selected' : ''}`}
            role="treeitem"
            aria-expanded={isExpanded}
            aria-selected={isSelected}
            onClick={() => {
              treeFocusRef.current?.focus();
              onSelect({
                id,
                type: 'array',
                object: arr,
                breadcrumbs: [
                  memoryMap.name || 'Memory Map',
                  memoryMap.address_blocks?.[blockIndex]?.name ?? '',
                  arr.name,
                ],
                path: ['addressBlocks', blockIndex, 'register_arrays', arrayIndex],
              });
            }}
            style={{ paddingLeft: '40px' }}
          >
            <span
              className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`}
              onClick={(e) => toggleExpand(id, e)}
              style={{ marginRight: '6px', cursor: 'pointer' }}
            ></span>
            <span className="codicon codicon-symbol-array" style={{ marginRight: '6px' }}></span>
            {renderNameOrEdit(id, arr.name, [
              'addressBlocks',
              blockIndex,
              'register_arrays',
              arrayIndex,
            ])}{' '}
            <span className="opacity-50">[{arr.count}]</span>
          </div>
          {isExpanded && Array.isArray(arr.registers) && (
            <div>
              {arr.registers.map((reg: Register, idx: number) =>
                renderLeafRegister(reg, blockIndex, idx)
              )}
            </div>
          )}
        </div>
      );
    };

    const renderBlock = (block: BlockModel, blockIndex: number) => {
      const id = `block-${blockIndex}`;
      const isExpanded = expanded.has(id);
      const isSelected = selectedId === id;
      const regsAny = block.registers ?? [];

      return (
        <OutlineBlockNode
          key={id}
          id={id}
          block={block}
          isSelected={isSelected}
          isExpanded={isExpanded}
          onClick={() => {
            treeFocusRef.current?.focus();
            onSelect({
              id,
              type: 'block',
              object: block,
              breadcrumbs: [memoryMap.name || 'Memory Map', block.name],
              path: ['addressBlocks', blockIndex],
            });
          }}
          onToggleExpand={(e) => toggleExpand(id, e)}
          name={renderNameOrEdit(id, block.name, ['addressBlocks', blockIndex])}
        >
          {regsAny.map((node, idx) => {
            if (isArrayNode(node)) {
              return (
                <RegisterArrayNode
                  key={`arrreg-${blockIndex}-${idx}`}
                  arrayNode={node}
                  block={block}
                  blockIndex={blockIndex}
                  regIndex={idx}
                  memoryMapName={memoryMap.name || 'Memory Map'}
                  selectedId={selectedId}
                  expanded={expanded}
                  onToggleExpand={toggleExpand}
                  onFocusTree={() => treeFocusRef.current?.focus()}
                  onSelect={onSelect}
                  renderNameOrEdit={renderNameOrEdit}
                />
              );
            }
            return renderLeafRegister(node, blockIndex, idx);
          })}
          {block.register_arrays?.map((arr: RegisterArray, idx: number) =>
            renderArray(arr, blockIndex, idx)
          )}
        </OutlineBlockNode>
      );
    };

    const onTreeKeyDown = (e: React.KeyboardEvent) => {
      if (editingId) {
        return;
      }

      const keyLower = (e.key || '').toLowerCase();
      const isDown = e.key === 'ArrowDown' || keyLower === 'j';
      const isUp = e.key === 'ArrowUp' || keyLower === 'k';
      const isToggleExpand = e.key === ' ' || (e.key === 'Enter' && !e.shiftKey);
      const isFocusDetails =
        (e.key === 'Enter' && !isToggleExpand) || e.key === 'ArrowRight' || keyLower === 'l';
      const isRename = e.key === 'F2' || keyLower === 'e';

      if (!isDown && !isUp && !isFocusDetails && !isToggleExpand && !isRename) {
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      const currentId = selectedId ?? rootId;
      const currentIndex = Math.max(
        0,
        visibleSelections.findIndex((s) => s.id === currentId)
      );
      const currentSel = visibleSelections[currentIndex] ?? visibleSelections[0];
      if (!currentSel) {
        return;
      }

      if (isRename && onRename) {
        e.preventDefault();
        e.stopPropagation();
        const name = (currentSel.object as { name?: string })?.name ?? '';
        if (name) {
          startEditing(currentId, name);
        }
        return;
      }

      if (isToggleExpand) {
        e.preventDefault();
        e.stopPropagation();

        const hasChildren = (() => {
          if (currentId === rootId) {
            return true;
          }
          if (currentId.startsWith('block-') && !currentId.includes('-reg-')) {
            const blockIdx = Number.parseInt(currentId.split('-')[1], 10);
            const block = memoryMap.address_blocks?.[blockIdx];
            return block && Array.isArray(block.registers) && block.registers.length > 0;
          }
          if (currentId.includes('-reg-') && currentId.split('-reg-')[1].includes('-')) {
            const parts = currentId.split('-');
            const blockIdx = Number.parseInt(parts[1], 10);
            const regIdx = Number.parseInt(parts[3], 10);
            const block = memoryMap.address_blocks?.[blockIdx];
            const reg = block?.registers?.[regIdx] as { count?: number } | undefined;
            return Boolean(reg && (reg.count ?? 0) > 1);
          }
          return false;
        })();

        if (hasChildren) {
          const newExpanded = new Set(expanded);
          if (newExpanded.has(currentId)) {
            newExpanded.delete(currentId);
          } else {
            newExpanded.add(currentId);
          }
          setExpanded(newExpanded);
        }
        return;
      }

      if (isFocusDetails) {
        e.preventDefault();
        e.stopPropagation();
        onSelect({
          ...currentSel,
          meta: { ...(currentSel.meta ?? {}), focusDetails: true },
        });
        return;
      }

      const nextIndex = isDown
        ? Math.min(visibleSelections.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
      const nextSel = visibleSelections[nextIndex];
      if (!nextSel) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onSelect({
        ...nextSel,
        meta: { ...(nextSel.meta ?? {}), focusDetails: false },
      });
    };

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
                  breadcrumbs: [memoryMap.name || 'Memory Map'],
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
              {renderNameOrEdit(rootId, memoryMap.name || 'Memory Map', [], 'flex-1')}
            </div>
            {isRootExpanded &&
              filteredBlocks.map(({ block, index }) => renderBlock(block as BlockModel, index))}
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
