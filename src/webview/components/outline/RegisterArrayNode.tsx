import React from 'react';
import { AddressBlock, Register } from '../../types/memoryMap';
import { toHex } from '../../utils/formatUtils';
import FieldNode from './FieldNode';
import RegisterNode from './RegisterNode';
import {
  OutlineSelection,
  RegisterArrayNode as RegisterArrayNodeModel,
  RenderNameOrEdit,
  YamlPath,
} from './types';

interface RegisterArrayNodeProps {
  arrayNode: RegisterArrayNodeModel;
  block: AddressBlock;
  blockIndex: number;
  regIndex: number;
  memoryMapName: string;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onFocusTree: () => void;
  onSelect: (selection: OutlineSelection) => void;
  renderNameOrEdit: RenderNameOrEdit;
}

const RegisterArrayNode = ({
  arrayNode,
  block,
  blockIndex,
  regIndex,
  memoryMapName,
  selectedId,
  expanded,
  onToggleExpand,
  onFocusTree,
  onSelect,
  renderNameOrEdit,
}: RegisterArrayNodeProps) => {
  const id = `block-${blockIndex}-arrreg-${regIndex}`;
  const isSelected = selectedId === id;
  const isExpanded = expanded.has(id);

  const start = (block.base_address ?? 0) + (arrayNode.address_offset ?? 0);
  const end = start + Math.max(1, arrayNode.count) * Math.max(1, arrayNode.stride) - 1;

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
            object: arrayNode,
            breadcrumbs: [memoryMapName || 'Memory Map', block.name, arrayNode.name],
            path: ['addressBlocks', blockIndex, 'registers', regIndex],
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
        {renderNameOrEdit(id, arrayNode.name, [
          'addressBlocks',
          blockIndex,
          'registers',
          regIndex,
        ])}{' '}
        <span className="opacity-50">
          @ {toHex(start)}-{toHex(end)} [{arrayNode.count}]
        </span>
      </div>

      {isExpanded && (
        <div>
          {Array.from({ length: arrayNode.count }).map((_, elementIndex) => {
            const elementId = `${id}-el-${elementIndex}`;
            const elementBase = start + elementIndex * arrayNode.stride;
            const isElementSelected = selectedId === elementId;
            return (
              <div key={elementId}>
                <FieldNode
                  id={elementId}
                  isSelected={isElementSelected}
                  label={`${arrayNode.name}[${elementIndex}] `}
                  suffix={<span className="opacity-50">@ {toHex(elementBase)}</span>}
                  onClick={() => {
                    onFocusTree();
                    onSelect({
                      id: elementId,
                      type: 'array',
                      object: {
                        ...arrayNode,
                        __element_index: elementIndex,
                        __element_base: elementBase,
                      },
                      breadcrumbs: [
                        memoryMapName || 'Memory Map',
                        block.name,
                        `${arrayNode.name}[${elementIndex}]`,
                      ],
                      path: ['addressBlocks', blockIndex, 'registers', regIndex],
                    });
                  }}
                  paddingLeft="60px"
                />

                {arrayNode.registers?.map((reg: Register, childIndex) => {
                  const childId = `${elementId}-reg-${childIndex}`;
                  const isChildSelected = selectedId === childId;
                  const absolute = elementBase + (reg.address_offset ?? 0);
                  const path: YamlPath = [
                    'addressBlocks',
                    blockIndex,
                    'registers',
                    regIndex,
                    'registers',
                    childIndex,
                  ];
                  return (
                    <RegisterNode
                      key={childId}
                      id={childId}
                      isSelected={isChildSelected}
                      onClick={() => {
                        onFocusTree();
                        onSelect({
                          id: childId,
                          type: 'register',
                          object: reg,
                          breadcrumbs: [
                            memoryMapName || 'Memory Map',
                            block.name,
                            `${arrayNode.name}[${elementIndex}]`,
                            reg.name,
                          ],
                          path,
                          meta: {
                            absoluteAddress: absolute,
                            relativeOffset: reg.address_offset ?? 0,
                          },
                        });
                      }}
                      paddingLeft="80px"
                      name={renderNameOrEdit(childId, reg.name, path)}
                      offsetLabel={`@ ${toHex(absolute)}`}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RegisterArrayNode;
