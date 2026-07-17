import React from 'react';
import type { NormalizedAddressBlock } from '../../../domain/internal.types';
import { toHex } from '../../utils/formatUtils';
import { FIELD_COLORS, getFieldColor } from '../../shared/colors';
import FieldNode from './FieldNode';
import RegisterNode from './RegisterNode';
import type { OutlineDragProps, OutlinePreviewMove } from './useOutlineDragReorder';
import { computeReorderPreview } from '../../utils/reorderPreview';
import {
  OutlineSelection,
  RegisterArrayNode as RegisterArrayNodeModel,
  RenderNameOrEdit,
  YamlPath,
} from './types';

interface RegisterArrayNodeProps {
  arrayNode: RegisterArrayNodeModel;
  block: NormalizedAddressBlock;
  blockIndex: number;
  regIndex: number;
  memoryMapName: string;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onFocusTree: () => void;
  onSelect: (selection: OutlineSelection) => void;
  onDoubleClick?: () => void;
  /** Swatch color (hex), stable per array name — see getFieldColor. */
  color?: string;
  renderNameOrEdit: RenderNameOrEdit;
  renderArrayDimsOrEdit?: (
    id: string,
    count: number,
    stride: number,
    path: YamlPath
  ) => React.ReactNode;
  startEditing?: (id: string, name: string) => void;
  onRegisterContextMenu?: (
    blockIndex: number,
    regIndex: number | undefined,
    x: number,
    y: number,
    parentRegIndex?: number
  ) => void;
  drag?: OutlineDragProps;
  /** Drag props factory so the array's child registers become reorderable. */
  getDragProps?: (id: string) => OutlineDragProps;
  /** Live drag-reorder preview; reflows the array's child registers. */
  previewMove?: OutlinePreviewMove | null;
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
  onDoubleClick,
  color,
  renderNameOrEdit,
  renderArrayDimsOrEdit,
  startEditing,
  onRegisterContextMenu,
  drag,
  getDragProps,
  previewMove,
}: RegisterArrayNodeProps) => {
  const id = `block-${blockIndex}-arrreg-${regIndex}`;
  const isSelected = selectedId === id;
  const isExpanded = expanded.has(id);
  const childRegs = arrayNode.registers ?? [];

  const blockBase = block.baseAddress;
  const arrOff = arrayNode.offset;
  const start = Number(blockBase) + Number(arrOff);

  return (
    <div key={id}>
      <div
        data-outline-id={id}
        className={`tree-item ${isSelected ? 'selected' : ''} gap-2 text-sm group`}
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
            meta: {
              absoluteAddress: start,
              relativeOffset: Number(arrayNode.offset ?? 0),
            },
          });
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={
          onRegisterContextMenu
            ? (e) => {
                e.preventDefault();
                onRegisterContextMenu(blockIndex, regIndex, e.clientX, e.clientY);
              }
            : undefined
        }
        onPointerMove={drag?.onRowPointerMove}
        onPointerEnter={drag?.onRowPointerEnter}
        style={{
          ...(drag?.isDragging
            ? {
                // Theme-aware ring (focusBorder is defined for both dark and light
                // themes) so the dragged node stays clearly visible while the tree
                // reflows around it.
                boxShadow: 'inset 0 0 0 2px var(--vscode-focusBorder)',
                opacity: 0.85,
                // The dragged row must not capture pointer events, or it would flip
                // the drop target as the reordered list slides it under the cursor.
                pointerEvents: 'none' as const,
              }
            : {}),
        }}
      >
        <div style={{ paddingLeft: '40px' }} className="flex items-center gap-2 flex-grow min-w-0">
          {drag?.dragHandle}
          <span
            className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'} shrink-0`}
            onClick={(e) => onToggleExpand(id, e)}
            style={{ cursor: 'pointer' }}
          ></span>
          {color && (
            <span
              className="w-2 h-2 shrink-0 border border-dashed"
              style={{ backgroundColor: color, borderColor: 'var(--ipcraft-pattern-border)' }}
              aria-hidden="true"
            />
          )}
          <span
            className="codicon codicon-symbol-array shrink-0"
            title="Register Array"
            style={{ color: 'var(--vscode-symbolIcon-arrayForeground)' }}
          ></span>
          {renderNameOrEdit(
            id,
            arrayNode.name,
            ['addressBlocks', blockIndex, 'registers', regIndex],
            'flex-1'
          )}
        </div>
        <span className="text-xs vscode-muted font-mono shrink-0 flex items-center gap-1">
          <span>@ {toHex(start)}</span>
          {renderArrayDimsOrEdit ? (
            renderArrayDimsOrEdit(id, arrayNode.count ?? 1, arrayNode.stride ?? 4, [
              'addressBlocks',
              blockIndex,
              'registers',
              regIndex,
            ])
          ) : (
            <span>[{arrayNode.count}]</span>
          )}
        </span>
        {onRegisterContextMenu && (
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
        )}
      </div>

      {isExpanded && (
        <div>
          {Array.from({ length: arrayNode.count ?? 1 }).map((_, elementIndex) => {
            const elementId = `${id}-el-${elementIndex}`;
            const elementBase = start + elementIndex * (arrayNode.stride ?? 4);
            const isElementSelected = selectedId === elementId;
            const elementActionButton = onRegisterContextMenu ? (
              <button
                className={`${
                  isElementSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                } transition-opacity p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center shrink-0 ml-auto`}
                onClick={(e) => {
                  e.stopPropagation();
                  onRegisterContextMenu(blockIndex, undefined, e.clientX, e.clientY, regIndex);
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
                  iconTitle="Array Element"
                  iconStyle={{ color: 'var(--vscode-symbolIcon-enumeratorForeground)' }}
                  actionButton={elementActionButton}
                  onContextMenu={
                    onRegisterContextMenu
                      ? (e) => {
                          e.preventDefault();
                          onRegisterContextMenu(
                            blockIndex,
                            undefined,
                            e.clientX,
                            e.clientY,
                            regIndex
                          );
                        }
                      : undefined
                  }
                />

                {(previewMove?.kind === 'arrayRegister' &&
                previewMove.blockIndex === blockIndex &&
                previewMove.arrayIndex === regIndex &&
                previewMove.elementIndex === elementIndex
                  ? computeReorderPreview(
                      childRegs.length,
                      previewMove.fromIdx,
                      previewMove.toIdx,
                      previewMove.after
                    )
                  : childRegs.map((_, i) => i)
                ).map((childIndex: number) => {
                  const reg = childRegs[childIndex];
                  const childId = `${elementId}-reg-${childIndex}`;
                  const isChildSelected = selectedId === childId;
                  const absolute = elementBase + reg.offset;
                  const path: YamlPath = [
                    'addressBlocks',
                    blockIndex,
                    'registers',
                    regIndex,
                    'registers',
                    childIndex,
                  ];

                  const childActionButton = onRegisterContextMenu ? (
                    <button
                      className={`${
                        isChildSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      } transition-opacity p-0.5 rounded hover:bg-[var(--vscode-toolbar-hoverBackground)] text-[var(--vscode-foreground)] flex items-center justify-center shrink-0 ml-auto`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRegisterContextMenu(
                          blockIndex,
                          childIndex,
                          e.clientX,
                          e.clientY,
                          regIndex
                        );
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
                      key={childId}
                      id={childId}
                      drag={getDragProps?.(childId)}
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
                            relativeOffset: reg.offset,
                          },
                        });
                      }}
                      onDoubleClick={() => startEditing?.(childId, reg.name ?? '')}
                      paddingLeft="80px"
                      color={FIELD_COLORS[getFieldColor(reg.name ?? '')]}
                      name={renderNameOrEdit(childId, reg.name, path)}
                      offsetLabel={`@ ${toHex(absolute)}`}
                      actionButton={childActionButton}
                      onContextMenu={
                        onRegisterContextMenu
                          ? (e) => {
                              e.preventDefault();
                              onRegisterContextMenu(
                                blockIndex,
                                childIndex,
                                e.clientX,
                                e.clientY,
                                regIndex
                              );
                            }
                          : undefined
                      }
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
