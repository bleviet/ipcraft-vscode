import React from 'react';
import type { NormalizedMemoryMap, NormalizedRegister } from '../../../domain/internal.types';
import { toHex } from '../../utils/formatUtils';
import { BlockNode as OutlineBlockNode, RegisterArrayNode, RegisterNode } from '.';
import { calculateBlockSize } from '../../utils/blockSize';
import {
  BlockNode as BlockModel,
  OutlineSelection,
  RenderNameOrEdit,
  YamlPath,
  isArrayNode,
} from './types';
import { blockId, registerId, arrayRegisterId } from './outlineIds';

interface OutlineTreeNodesProps {
  memoryMap: NormalizedMemoryMap;
  memoryMapName: string;
  filteredBlocks: Array<{ block: BlockModel; index: number }>;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onFocusTree: () => void;
  onSelect: (selection: OutlineSelection) => void;
  renderNameOrEdit: RenderNameOrEdit;
  renderBaseAddressOrEdit?: (id: string, baseAddress: number, path: YamlPath) => React.ReactNode;
  startEditing?: (id: string, name: string) => void;
  onRegisterContextMenu?: (
    blockIndex: number,
    regIndex: number | undefined,
    x: number,
    y: number,
    parentRegIndex?: number
  ) => void;
  onBlockContextMenu?: (blockIndex: number, x: number, y: number) => void;
}

function renderLeafRegister(
  memoryMap: NormalizedMemoryMap,
  memoryMapName: string,
  selectedId: string | null,
  onFocusTree: () => void,
  onSelect: (selection: OutlineSelection) => void,
  renderNameOrEdit: RenderNameOrEdit,
  startEditing: ((id: string, name: string) => void) | undefined,
  reg: NormalizedRegister,
  blockIndex: number,
  regIndex: number,
  paddingLeft = '40px',
  onRegisterContextMenu?: (
    blockIndex: number,
    regIndex: number | undefined,
    x: number,
    y: number,
    parentRegIndex?: number
  ) => void
) {
  const id = registerId(blockIndex, regIndex);
  const isSelected = selectedId === id;
  const block = memoryMap.addressBlocks?.[blockIndex];
  const blockBase = Number(block?.baseAddress ?? 0);
  const regOff = Number(reg.offset ?? 0);
  const absolute = blockBase + regOff;
  const path: YamlPath = ['addressBlocks', blockIndex, 'registers', regIndex];

  const actionButton = onRegisterContextMenu ? (
    <button
      className={`${
        isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
      } transition-opacity p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center shrink-0 ml-auto`}
      onClick={(e) => {
        e.stopPropagation();
        onRegisterContextMenu(blockIndex, regIndex, e.clientX, e.clientY);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      title="More Actions..."
      aria-label="More Actions..."
    >
      <span className="codicon codicon-kebab-vertical text-sm" />
    </button>
  ) : undefined;

  return (
    <RegisterNode
      key={id}
      id={id}
      isSelected={isSelected}
      onClick={() => {
        onFocusTree();
        onSelect({
          id,
          type: 'register',
          object: reg,
          breadcrumbs: [memoryMapName, memoryMap.addressBlocks?.[blockIndex]?.name ?? '', reg.name],
          path,
          meta: {
            absoluteAddress: absolute,
            relativeOffset: reg.offset,
          },
        });
      }}
      onDoubleClick={() => startEditing?.(id, reg.name ?? '')}
      paddingLeft={paddingLeft}
      name={renderNameOrEdit(id, reg.name, path, 'flex-1')}
      offsetLabel={`@ ${toHex(absolute)}`}
      actionButton={actionButton}
      onContextMenu={
        onRegisterContextMenu
          ? (e) => {
              e.preventDefault();
              onRegisterContextMenu(blockIndex, regIndex, e.clientX, e.clientY);
            }
          : undefined
      }
    />
  );
}

const OutlineTreeNodes = ({
  memoryMap,
  memoryMapName,
  filteredBlocks,
  selectedId,
  expanded,
  onToggleExpand,
  onFocusTree,
  onSelect,
  renderNameOrEdit,
  renderBaseAddressOrEdit,
  startEditing,
  onRegisterContextMenu,
  onBlockContextMenu,
}: OutlineTreeNodesProps) => {
  const overlappingBlockIndices = React.useMemo(() => {
    const blocks = memoryMap.addressBlocks ?? [];
    const overlaps = new Set<number>();

    const ranges = blocks.map((block) => {
      const start = Number(block.baseAddress ?? 0);
      const size = Math.max(1, calculateBlockSize(block));
      const end = start + size - 1;
      return { start, end };
    });

    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        if (Math.max(a.start, b.start) <= Math.min(a.end, b.end)) {
          overlaps.add(i);
          overlaps.add(j);
        }
      }
    }
    return overlaps;
  }, [memoryMap]);

  return (
    <>
      {filteredBlocks.map(({ block, index: blockIndex }) => {
        const id = blockId(blockIndex);
        const isExpanded = expanded.has(id);
        const isSelected = selectedId === id;
        const regsAny = block.registers ?? [];

        const actionButton = onBlockContextMenu ? (
          <button
            className={`${
              isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            } transition-opacity p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center shrink-0 ml-auto`}
            onClick={(e) => {
              e.stopPropagation();
              onBlockContextMenu(blockIndex, e.clientX, e.clientY);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title="More Actions..."
            aria-label="More Actions..."
          >
            <span className="codicon codicon-kebab-vertical text-sm" />
          </button>
        ) : undefined;

        return (
          <OutlineBlockNode
            key={id}
            id={id}
            block={block}
            isSelected={isSelected}
            isExpanded={isExpanded}
            isOverlapping={overlappingBlockIndices.has(blockIndex)}
            onClick={() => {
              onFocusTree();
              onSelect({
                id,
                type: 'block',
                object: block,
                breadcrumbs: [memoryMapName, block.name],
                path: ['addressBlocks', blockIndex],
              });
            }}
            onToggleExpand={(e) => onToggleExpand(id, e)}
            onDoubleClick={() => startEditing?.(id, block.name ?? '')}
            name={renderNameOrEdit(id, block.name, ['addressBlocks', blockIndex], 'flex-1')}
            baseAddress={
              renderBaseAddressOrEdit
                ? renderBaseAddressOrEdit(id, block.baseAddress, ['addressBlocks', blockIndex])
                : undefined
            }
            actionButton={actionButton}
            onContextMenu={
              onBlockContextMenu
                ? (e) => {
                    e.preventDefault();
                    onBlockContextMenu(blockIndex, e.clientX, e.clientY);
                  }
                : undefined
            }
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
                    memoryMapName={memoryMapName}
                    selectedId={selectedId}
                    expanded={expanded}
                    onToggleExpand={onToggleExpand}
                    onFocusTree={onFocusTree}
                    onSelect={onSelect}
                    onDoubleClick={() =>
                      startEditing?.(arrayRegisterId(blockIndex, idx), node.name ?? '')
                    }
                    renderNameOrEdit={renderNameOrEdit}
                    startEditing={startEditing}
                    onRegisterContextMenu={onRegisterContextMenu}
                  />
                );
              }
              return renderLeafRegister(
                memoryMap,
                memoryMapName,
                selectedId,
                onFocusTree,
                onSelect,
                renderNameOrEdit,
                startEditing,
                node,
                blockIndex,
                idx,
                '40px',
                onRegisterContextMenu
              );
            })}
          </OutlineBlockNode>
        );
      })}
    </>
  );
};

export default OutlineTreeNodes;
