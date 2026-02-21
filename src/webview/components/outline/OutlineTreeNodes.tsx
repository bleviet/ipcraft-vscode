import React from 'react';
import { MemoryMap, Register, RegisterArray } from '../../types/memoryMap';
import { toHex } from '../../utils/formatUtils';
import { BlockNode as OutlineBlockNode, RegisterArrayNode, RegisterNode } from '.';
import {
  BlockNode as BlockModel,
  OutlineSelection,
  RenderNameOrEdit,
  YamlPath,
  isArrayNode,
} from './types';
import { blockId, registerArrayId, registerId } from './outlineIds';

interface OutlineTreeNodesProps {
  memoryMap: MemoryMap;
  memoryMapName: string;
  filteredBlocks: Array<{ block: BlockModel; index: number }>;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onFocusTree: () => void;
  onSelect: (selection: OutlineSelection) => void;
  renderNameOrEdit: RenderNameOrEdit;
}

function renderLeafRegister(
  memoryMap: MemoryMap,
  memoryMapName: string,
  selectedId: string | null,
  onFocusTree: () => void,
  onSelect: (selection: OutlineSelection) => void,
  renderNameOrEdit: RenderNameOrEdit,
  reg: Register,
  blockIndex: number,
  regIndex: number,
  paddingLeft = '40px'
) {
  const id = registerId(blockIndex, regIndex);
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
        onFocusTree();
        onSelect({
          id,
          type: 'register',
          object: reg,
          breadcrumbs: [
            memoryMapName,
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
}

function renderArray(
  memoryMap: MemoryMap,
  memoryMapName: string,
  selectedId: string | null,
  expanded: Set<string>,
  onToggleExpand: (id: string, e: React.MouseEvent) => void,
  onFocusTree: () => void,
  onSelect: (selection: OutlineSelection) => void,
  renderNameOrEdit: RenderNameOrEdit,
  arr: RegisterArray,
  blockIndex: number,
  arrayIndex: number
) {
  const id = registerArrayId(blockIndex, arrayIndex);
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
          onFocusTree();
          onSelect({
            id,
            type: 'array',
            object: arr,
            breadcrumbs: [
              memoryMapName,
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
          onClick={(e) => onToggleExpand(id, e)}
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
            renderLeafRegister(
              memoryMap,
              memoryMapName,
              selectedId,
              onFocusTree,
              onSelect,
              renderNameOrEdit,
              reg,
              blockIndex,
              idx
            )
          )}
        </div>
      )}
    </div>
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
            isSelected={isSelected}
            isExpanded={isExpanded}
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
                    memoryMapName={memoryMapName}
                    selectedId={selectedId}
                    expanded={expanded}
                    onToggleExpand={onToggleExpand}
                    onFocusTree={onFocusTree}
                    onSelect={onSelect}
                    renderNameOrEdit={renderNameOrEdit}
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
                node,
                blockIndex,
                idx
              );
            })}
            {block.register_arrays?.map((arr: RegisterArray, idx: number) =>
              renderArray(
                memoryMap,
                memoryMapName,
                selectedId,
                expanded,
                onToggleExpand,
                onFocusTree,
                onSelect,
                renderNameOrEdit,
                arr,
                blockIndex,
                idx
              )
            )}
          </OutlineBlockNode>
        );
      })}
    </>
  );
};

export default OutlineTreeNodes;
