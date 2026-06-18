import React from 'react';
import type { NormalizedMemoryMap, NormalizedRegister } from '../../../domain/internal.types';
import { toHex } from '../../utils/formatUtils';
import { BlockNode as OutlineBlockNode, RegisterArrayNode, RegisterNode } from '.';
import {
  BlockNode as BlockModel,
  OutlineSelection,
  RegisterInsertKind,
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
  startEditing?: (id: string, name: string) => void;
  onRegisterContextMenu?: (blockIndex: number, regIndex: number, x: number, y: number) => void;
  onBlockContextMenu?: (blockIndex: number, x: number, y: number) => void;
  onInsertRegisterAtGap?: (blockIndex: number, gapIndex: number, kind: RegisterInsertKind) => void;
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
  onRegisterContextMenu?: (blockIndex: number, regIndex: number, x: number, y: number) => void,
  rowIdx?: number
) {
  const id = registerId(blockIndex, regIndex);
  const isSelected = selectedId === id;
  const block = memoryMap.addressBlocks?.[blockIndex];
  const blockBase = Number(block?.baseAddress ?? 0);
  const regOff = Number(reg.offset ?? 0);
  const absolute = blockBase + regOff;
  const path: YamlPath = ['addressBlocks', blockIndex, 'registers', regIndex];

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
      rowIdx={rowIdx}
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
  startEditing,
  onRegisterContextMenu,
  onBlockContextMenu,
  onInsertRegisterAtGap,
}: OutlineTreeNodesProps) => {
  return (
    <>
      {filteredBlocks.map(({ block, index: blockIndex }) => {
        const id = blockId(blockIndex);
        const isExpanded = expanded.has(id);
        const isSelected = selectedId === id;
        const regsAny = block.registers ?? [];

        return (
          <OutlineBlockNode
            key={id}
            id={id}
            block={block}
            blockIndex={blockIndex}
            isSelected={isSelected}
            isExpanded={isExpanded}
            onInsertRegisterAtGap={onInsertRegisterAtGap}
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
            onContextMenu={
              onBlockContextMenu
                ? (e) => {
                    e.preventDefault();
                    onBlockContextMenu(blockIndex, e.clientX, e.clientY);
                  }
                : undefined
            }
            name={renderNameOrEdit(id, block.name, ['addressBlocks', blockIndex], 'flex-1')}
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
                onRegisterContextMenu,
                idx
              );
            })}
          </OutlineBlockNode>
        );
      })}
    </>
  );
};

export default OutlineTreeNodes;
