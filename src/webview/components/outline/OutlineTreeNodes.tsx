import React from 'react';
import type { NormalizedMemoryMap, NormalizedRegister } from '../../../domain/internal.types';
import { toHex } from '../../utils/formatUtils';
import { FIELD_COLORS, getFieldColor } from '../../shared/colors';
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
import type { OutlineDragProps, OutlinePreviewMove } from './useOutlineDragReorder';
import { computeReorderPreview } from '../../utils/reorderPreview';

interface OutlineTreeNodesProps {
  memoryMap: NormalizedMemoryMap;
  memoryMapName: string;
  filteredBlocks: Array<{ block: BlockModel; index: number }>;
  query: string;
  selectedId: string | null;
  expanded: Set<string>;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
  onFocusTree: () => void;
  onSelect: (selection: OutlineSelection) => void;
  renderNameOrEdit: RenderNameOrEdit;
  renderBaseAddressOrEdit?: (id: string, baseAddress: number, path: YamlPath) => React.ReactNode;
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
  onBlockContextMenu?: (blockIndex: number, x: number, y: number) => void;
  getDragProps?: (id: string) => OutlineDragProps;
  /** Live drag-reorder preview; reflows the affected sibling group's order. */
  previewMove?: OutlinePreviewMove | null;
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
  ) => void,
  getDragProps?: (id: string) => OutlineDragProps
) {
  const color = FIELD_COLORS[getFieldColor(reg.name ?? '')];
  const id = registerId(blockIndex, regIndex);
  const isSelected = selectedId === id;
  const block = memoryMap.addressBlocks?.[blockIndex];
  const blockBase = Number(block?.baseAddress ?? 0);
  const regOff = Number(reg.offset ?? 0);
  const absolute = blockBase + regOff;
  // The register name cell still edits at the register path.
  const path: YamlPath = ['addressBlocks', blockIndex, 'registers', regIndex];
  // Selecting a register opens its owning block's master-detail with the
  // register pre-selected, rather than a separate full-page register view.
  const blockPath: YamlPath = ['addressBlocks', blockIndex];

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
          type: 'block',
          object: block,
          breadcrumbs: [memoryMapName, memoryMap.addressBlocks?.[blockIndex]?.name ?? '', reg.name],
          path: blockPath,
          meta: {
            absoluteAddress: absolute,
            relativeOffset: reg.offset,
            activeRegisterIndex: regIndex,
            focusDetails: true,
          },
        });
      }}
      onDoubleClick={() => startEditing?.(id, reg.name ?? '')}
      paddingLeft={paddingLeft}
      color={color}
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
      drag={getDragProps?.(id)}
    />
  );
}

const OutlineTreeNodes = ({
  memoryMap,
  memoryMapName,
  filteredBlocks,
  query,
  selectedId,
  expanded,
  onToggleExpand,
  onFocusTree,
  onSelect,
  renderNameOrEdit,
  renderBaseAddressOrEdit,
  renderArrayDimsOrEdit,
  startEditing,
  onRegisterContextMenu,
  onBlockContextMenu,
  getDragProps,
  previewMove,
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

  const q = query.trim().toLowerCase();

  // Live drag-reorder preview: while a block is being dragged (and no search
  // filter is narrowing the list), reflow the blocks into the prospective drop
  // order. Each block keeps its real index, so ids/selection/commit are intact.
  const blockDisplay = React.useMemo(() => {
    if (q || previewMove?.kind !== 'block') {
      return filteredBlocks;
    }
    return computeReorderPreview(
      filteredBlocks.length,
      previewMove.fromIdx,
      previewMove.toIdx,
      previewMove.after
    ).map((i) => filteredBlocks[i]);
  }, [filteredBlocks, previewMove, q]);

  return (
    <>
      {blockDisplay.map(({ block, index: blockIndex }) => {
        const id = blockId(blockIndex);
        const isExpanded = expanded.has(id);
        const isSelected = selectedId === id;
        const regsAny = block.registers ?? [];
        const blockMatches = !q || (block.name ?? '').toLowerCase().includes(q);
        // Reflow this block's registers when one of them is being dragged.
        const regOrder =
          !q && previewMove?.kind === 'register' && previewMove.blockIndex === blockIndex
            ? computeReorderPreview(
                regsAny.length,
                previewMove.fromIdx,
                previewMove.toIdx,
                previewMove.after
              )
            : regsAny.map((_, i) => i);

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
            drag={getDragProps?.(id)}
          >
            {regOrder.map((idx) => {
              const node = regsAny[idx];
              if (!blockMatches) {
                const nodeMatches = isArrayNode(node)
                  ? String(node.name ?? '')
                      .toLowerCase()
                      .includes(q) ||
                    (node.registers ?? []).some((rr) =>
                      String(rr.name ?? '')
                        .toLowerCase()
                        .includes(q)
                    )
                  : String(node.name ?? '')
                      .toLowerCase()
                      .includes(q);
                if (!nodeMatches) {
                  return null;
                }
              }
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
                    color={FIELD_COLORS[getFieldColor(node.name ?? '')]}
                    renderNameOrEdit={renderNameOrEdit}
                    renderArrayDimsOrEdit={renderArrayDimsOrEdit}
                    startEditing={startEditing}
                    onRegisterContextMenu={onRegisterContextMenu}
                    drag={getDragProps?.(arrayRegisterId(blockIndex, idx))}
                    getDragProps={getDragProps}
                    previewMove={previewMove}
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
                getDragProps
              );
            })}
          </OutlineBlockNode>
        );
      })}
    </>
  );
};

export default OutlineTreeNodes;
