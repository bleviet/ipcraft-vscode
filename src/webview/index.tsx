import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { createRoot } from 'react-dom/client';
import Outline, { type OutlineHandle } from './components/OutlinePanel';
import {
  blockId,
  registerId,
  arrayRegisterId,
  arrayElementRegisterId,
} from './components/outline/outlineIds';
import type { OutlineReorder } from './components/outline/types';
import DetailsPanel, { type DetailsPanelHandle } from './components/DetailsPanel';
import { vscode } from './vscode';
import { useMemoryMapState } from './hooks/useMemoryMapState';
import { useSelection } from './hooks/useSelection';
import { useYamlSync } from './hooks/useYamlSync';
import { useSelectionResolver } from './hooks/useSelectionResolver';
import { useSelectionLifecycle } from './hooks/useSelectionLifecycle';
import { useOutlineRename } from './hooks/useOutlineRename';
import { useDetailsNavigation } from './hooks/useDetailsNavigation';
import { useYamlUpdateHandler } from './hooks/useYamlUpdateHandler';
import { useLayoutToggle } from './hooks/useLayoutToggle';
import { DebugModeProvider } from './hooks/useDebugMode';
import { insertElement, deleteElement } from './algorithms/MutationService';
import { recomputeRegisterLayout } from './algorithms/LayoutEngine';
import type { LayoutMemoryMap, LayoutRegister } from './algorithms/LayoutEngine';
import { YamlService } from './services/YamlService';
import { YamlPathResolver } from './services/YamlPathResolver';
import { serializeValue } from '../domain/serialize';
import { canonicalizeLegacyKeys } from '../domain/parse';
import { calculateBlockSize } from './utils/blockSize';
import type { YamlPath } from './types/editor';

/** Effective register width (bits) of a block-like object. */
function blockRegWidth(block: Record<string, unknown> | undefined): number {
  const raw = block?.defaultRegWidth;
  return typeof raw === 'number' && raw > 0 ? raw : 32;
}
import '@vscode/codicons/dist/codicon.css';
import './index.css';

/**
 * Main application component
 */
const App = () => {
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const sidebarResizingRef = useRef(false);
  const registerLayout = useLayoutToggle();
  const blockLayout = useLayoutToggle();
  const memoryMapLayout = useLayoutToggle();
  const arrayLayout = useLayoutToggle();

  const { memoryMap, rawTextRef, parseError, updateFromYaml, updateRawText } = useMemoryMapState();
  const {
    selectedId,
    selectedType,
    selectedObject,
    selectionMeta,
    selectionRef,
    handleSelect,
    goBack,
  } = useSelection();
  const { sendUpdate } = useYamlSync(vscode, updateFromYaml);

  useEffect(() => {
    // Expose for testing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    (window as any).__RENDER__ = (text: string) => {
      updateFromYaml(text);
    };
    vscode?.postMessage({ type: 'ready' });
  }, [updateFromYaml]);

  const outlineRef = useRef<OutlineHandle | null>(null);
  const detailsRef = useRef<DetailsPanelHandle | null>(null);

  const resolveFromSelection = useSelectionResolver(memoryMap);
  const handleOutlineRename = useOutlineRename({ rawTextRef, updateRawText, sendUpdate });
  const handleUpdate = useYamlUpdateHandler({
    selectionRef,
    rawTextRef,
    updateRawText,
    sendUpdate,
  });

  const { navigateToRegister, navigateToBlock } = useDetailsNavigation({
    memoryMap,
    selectedObject,
    selectionRef,
    handleSelect,
  });

  useSelectionLifecycle({
    memoryMap,
    selectionRef,
    handleSelect,
    resolveFromSelection,
  });

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [goBack]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const keyLower = (e.key || '').toLowerCase();
      if (!e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (keyLower !== 'h' && keyLower !== 'l') {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (keyLower === 'h') {
        outlineRef.current?.focus();
        return;
      }
      if (keyLower === 'l') {
        detailsRef.current?.focus();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleRegisterAction = (
    blockIndex: number,
    regIndex: number | undefined,
    action: 'insertBefore' | 'insertAfter' | 'delete',
    kind?: 'register' | 'flat-array' | 'array',
    parentRegIndex?: number
  ) => {
    const rootObj = YamlService.safeParse(rawTextRef.current);
    if (!rootObj) {
      return;
    }
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const rawMapObj = (
      selectionRootPath.length > 0 ? YamlPathResolver.getAtPath(root, selectionRootPath) : root
    ) as Record<string, unknown>;
    // The mutation services operate on the canonical camelCase model. Canonicalize
    // legacy snake_case keys (preserving any custom metadata) so structural edits
    // on legacy files work instead of reporting "Block not found". The write path
    // (YamlService.applyPathEdits) maps the canonical path back onto the on-disk
    // key, so a legacy file is edited in place without a duplicate key.
    const mapObj = canonicalizeLegacyKeys(rawMapObj) as LayoutMemoryMap;

    const targetIdx = regIndex ?? -1;

    let result;
    if (action === 'delete') {
      result = deleteElement(mapObj, 'register', targetIdx, {
        blockIndex,
        registerIndex: parentRegIndex,
      });
    } else {
      result = insertElement(
        mapObj,
        'register',
        action === 'insertBefore' ? 'before' : 'after',
        targetIdx,
        { blockIndex, registerIndex: parentRegIndex },
        kind
      );
    }

    if (result.errors.length === 0) {
      // Write only the affected registers array so the rest of the
      // document keeps its formatting and comments.
      const blocks = (result.memoryMap.addressBlocks ?? []) as Record<string, unknown>[];
      const block = blocks[blockIndex];
      if (!block) {
        return;
      }
      const width = blockRegWidth(block);

      const edits = [];

      if (parentRegIndex !== undefined) {
        const parentReg = (block.registers as Record<string, unknown>[])?.[parentRegIndex];
        if (!parentReg) {
          return;
        }
        const regs = (Array.isArray(parentReg.registers) ? parentReg.registers : []) as Record<
          string,
          unknown
        >[];
        const value = regs.map((r) => serializeValue(r, width) as Record<string, unknown>);
        edits.push({
          path: [
            ...selectionRootPath,
            'addressBlocks',
            blockIndex,
            'registers',
            parentRegIndex,
            'registers',
          ],
          value,
        });

        if (parentReg.stride !== undefined) {
          edits.push({
            path: [
              ...selectionRootPath,
              'addressBlocks',
              blockIndex,
              'registers',
              parentRegIndex,
              'stride',
            ],
            value: parentReg.stride,
          });
        }
      } else {
        const regs = (Array.isArray(block.registers) ? block.registers : []) as Record<
          string,
          unknown
        >[];
        const value = regs.map((r) => serializeValue(r, width) as Record<string, unknown>);
        edits.push({
          path: [...selectionRootPath, 'addressBlocks', blockIndex, 'registers'],
          value,
        });
      }

      const newText = YamlService.applyPathEdits(rawTextRef.current, edits);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
      }

      if (action !== 'delete' && result.newIndex !== -1) {
        const blocks = result.memoryMap.addressBlocks ?? [];
        const block = blocks[blockIndex];
        const mapName = result.memoryMap.name ?? 'Memory Map';

        if (parentRegIndex !== undefined) {
          const parentReg = (block?.registers as Record<string, unknown>[])?.[parentRegIndex];
          const newReg = (parentReg?.registers as Record<string, unknown>[])?.[result.newIndex];
          if (block && parentReg && newReg) {
            let elementIndex = 0;
            if (selectedId) {
              const match = selectedId.match(/arrreg-\d+-el-(\d+)/);
              if (match) {
                elementIndex = parseInt(match[1], 10);
              }
            }
            const id = arrayElementRegisterId(
              blockIndex,
              parentRegIndex,
              elementIndex,
              result.newIndex
            );
            const blockBase = Number(block.baseAddress ?? 0);
            const arrOff = Number(parentReg.offset ?? 0);
            const elementBase = blockBase + arrOff + elementIndex * Number(parentReg.stride ?? 4);
            const absolute = elementBase + Number(newReg.offset ?? 0);
            handleSelect({
              id,
              type: 'register',
              object: newReg,
              breadcrumbs: [
                mapName,
                block.name ?? '',
                `${parentReg.name}[${elementIndex}]`,
                String(newReg.name),
              ],
              path: [
                'addressBlocks',
                blockIndex,
                'registers',
                parentRegIndex,
                'registers',
                result.newIndex,
              ],
              meta: {
                absoluteAddress: absolute,
                relativeOffset: Number(newReg.offset ?? 0),
              },
            });
          }
        } else {
          const newReg = (block?.registers as Record<string, unknown>[])?.[result.newIndex];
          if (block && newReg) {
            const isArray = newReg.__kind === 'array' || kind === 'array';
            const id = isArray
              ? arrayRegisterId(blockIndex, result.newIndex)
              : registerId(blockIndex, result.newIndex);
            const blockBase = Number(block.baseAddress ?? 0);
            const absolute = blockBase + Number(newReg.offset ?? 0);
            handleSelect({
              id,
              type: isArray ? 'array' : 'register',
              object: newReg,
              breadcrumbs: [mapName, block.name ?? '', String(newReg.name)],
              path: ['addressBlocks', blockIndex, 'registers', result.newIndex],
              meta: {
                absoluteAddress: absolute,
                relativeOffset: Number(newReg.offset ?? 0),
              },
            });
          }
        }
      }
    }
  };

  const handleBlockAction = (
    blockIndex: number,
    action: 'insertBefore' | 'insertAfter' | 'delete',
    kind?: 'block' | 'ram'
  ) => {
    const rootObj = YamlService.safeParse(rawTextRef.current);
    if (!rootObj) {
      return;
    }
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const rawMapObj = (
      selectionRootPath.length > 0 ? YamlPathResolver.getAtPath(root, selectionRootPath) : root
    ) as Record<string, unknown>;
    // Canonicalize legacy keys (preserving custom metadata) before the
    // camelCase-only mutation service. The write path maps canonical paths back
    // onto the on-disk key.
    const mapObj = canonicalizeLegacyKeys(rawMapObj) as LayoutMemoryMap;

    let result;
    if (action === 'delete') {
      result = deleteElement(mapObj, 'block', blockIndex);
    } else {
      result = insertElement(
        mapObj,
        'block',
        action === 'insertBefore' ? 'before' : 'after',
        blockIndex,
        undefined,
        kind
      );
    }

    if (result.errors.length === 0) {
      const blocks = (result.memoryMap.addressBlocks ?? []) as Record<string, unknown>[];
      const sanitized = blocks.map((b) => serializeValue(b) as Record<string, unknown>);
      const newText = YamlService.applyPathEdits(rawTextRef.current, [
        {
          path: [...selectionRootPath, 'addressBlocks'],
          value: sanitized,
        },
      ]);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
      }

      if (action !== 'delete' && result.newIndex !== -1) {
        const blocks = result.memoryMap.addressBlocks ?? [];
        const newBlock = blocks[result.newIndex];
        if (newBlock) {
          const mapName = result.memoryMap.name ?? 'Memory Map';
          const id = blockId(result.newIndex);
          handleSelect({
            id,
            type: 'block',
            object: newBlock,
            breadcrumbs: [mapName, newBlock.name ?? ''],
            path: ['addressBlocks', result.newIndex],
          });
        }
      }
    }
  };

  // Outline drag-to-reorder. Reuses the same YAML write path as the insert
  // actions (applyPathEdits + recomputeRegisterLayout for offset repack on
  // register moves). Only same-sibling-group moves reach here (see
  // useOutlineDragReorder).
  const handleReorder = (p: OutlineReorder) => {
    const rootObj = YamlService.safeParse(rawTextRef.current);
    if (!rootObj) {
      return;
    }
    const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
    const mapName =
      (YamlPathResolver.getAtPath(root, selectionRootPath) as LayoutMemoryMap | undefined)?.name ??
      'Memory Map';

    const computeInsertIdx = (fromIdx: number, toIdx: number) => {
      let insertIdx = toIdx;
      if (p.position === 'after') {
        insertIdx++;
      }
      if (fromIdx < insertIdx) {
        insertIdx--;
      }
      return insertIdx;
    };

    if (p.kind === 'block') {
      const blocks = (YamlPathResolver.getAtPath(root, [...selectionRootPath, 'addressBlocks']) ??
        []) as Record<string, unknown>[];
      if (p.fromIdx < 0 || p.fromIdx >= blocks.length || p.toIdx < 0 || p.toIdx >= blocks.length) {
        return;
      }
      const newBlocks = [...blocks];
      const insertIdx = computeInsertIdx(p.fromIdx, p.toIdx);
      const [moved] = newBlocks.splice(p.fromIdx, 1);
      newBlocks.splice(insertIdx, 0, moved);
      const sanitized = newBlocks.map((b) => serializeValue(b) as Record<string, unknown>);
      const newText = YamlService.applyPathEdits(rawTextRef.current, [
        { path: [...selectionRootPath, 'addressBlocks'], value: sanitized },
      ]);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
        const movedBlock = newBlocks[insertIdx];
        handleSelect({
          id: blockId(insertIdx),
          type: 'block',
          object: movedBlock,
          breadcrumbs: [mapName, String(movedBlock?.name ?? '')],
          path: ['addressBlocks', insertIdx],
        });
      }
      return;
    }

    if (p.kind === 'arrayRegister') {
      // Reorder a register within a register array's child template. Offsets
      // repack within the array element (its own width), then the array's
      // footprint is unchanged so sibling registers stay put.
      const arrayPath = [
        ...selectionRootPath,
        'addressBlocks',
        p.blockIndex,
        'registers',
        p.arrayIndex,
      ];
      const arrayNode = YamlPathResolver.getAtPath(root, arrayPath) as
        | Record<string, unknown>
        | undefined;
      const childRegs = (arrayNode?.registers ?? []) as Record<string, unknown>[];
      if (
        p.fromIdx < 0 ||
        p.fromIdx >= childRegs.length ||
        p.toIdx < 0 ||
        p.toIdx >= childRegs.length
      ) {
        return;
      }
      const newChildRegs = [...childRegs];
      const insertIdx = computeInsertIdx(p.fromIdx, p.toIdx);
      const [movedChild] = newChildRegs.splice(p.fromIdx, 1);
      newChildRegs.splice(insertIdx, 0, movedChild);

      const width = blockRegWidth(arrayNode);
      const laidOut = recomputeRegisterLayout(newChildRegs as LayoutRegister[], width);
      const sanitizedRegs = laidOut.map(
        (r) => serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
      );
      const newText = YamlService.applyPathEdits(rawTextRef.current, [
        { path: [...arrayPath, 'registers'], value: sanitizedRegs },
      ]);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
        const block = YamlPathResolver.getAtPath(root, [
          ...selectionRootPath,
          'addressBlocks',
          p.blockIndex,
        ]) as Record<string, unknown> | undefined;
        const base = Number(block?.baseAddress ?? 0) + Number(arrayNode?.offset ?? 0);
        handleSelect({
          id: arrayRegisterId(p.blockIndex, p.arrayIndex),
          type: 'array',
          object: { ...arrayNode, registers: sanitizedRegs },
          breadcrumbs: [mapName, String(block?.name ?? ''), String(arrayNode?.name ?? '')],
          path: ['addressBlocks', p.blockIndex, 'registers', p.arrayIndex],
          meta: { absoluteAddress: base, relativeOffset: Number(arrayNode?.offset ?? 0) },
        });
      }
      return;
    }

    // register reorder within a block
    const blockPath = [...selectionRootPath, 'addressBlocks', p.blockIndex];
    const block = YamlPathResolver.getAtPath(root, blockPath) as
      | Record<string, unknown>
      | undefined;
    const regs = (block?.registers ?? []) as Record<string, unknown>[];
    if (p.fromIdx < 0 || p.fromIdx >= regs.length || p.toIdx < 0 || p.toIdx >= regs.length) {
      return;
    }
    const newRegs = [...regs];
    const insertIdx = computeInsertIdx(p.fromIdx, p.toIdx);
    const [movedReg] = newRegs.splice(p.fromIdx, 1);
    newRegs.splice(insertIdx, 0, movedReg);

    const width = blockRegWidth(block);
    const laidOut = recomputeRegisterLayout(newRegs as LayoutRegister[], width);
    const sanitizedRegs = laidOut.map(
      (r) => serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
    );
    const newText = YamlService.applyPathEdits(rawTextRef.current, [
      { path: [...blockPath, 'registers'], value: sanitizedRegs },
    ]);
    if (newText !== rawTextRef.current) {
      updateRawText(newText);
      sendUpdate(newText);
      const movedIsArray =
        (newRegs[insertIdx] as Record<string, unknown> | undefined)?.__kind === 'array';
      const id = movedIsArray
        ? arrayRegisterId(p.blockIndex, insertIdx)
        : registerId(p.blockIndex, insertIdx);
      handleSelect({
        id,
        type: 'block',
        object: block,
        breadcrumbs: [mapName, String(block?.name ?? ''), String(movedReg?.name ?? '')],
        path: ['addressBlocks', p.blockIndex],
        meta: { activeRegisterIndex: insertIdx, focusDetails: true },
      });
    }
  };

  // Wraps handleUpdate for array-level structure changes (insert/delete/
  // reorder from BlockEditor or MemoryMapEditor). The structural edit, the
  // layout repack and schema sanitization are applied in a single pass
  // producing exactly one document update: sending two updates back-to-back
  // can corrupt the file when the second edit races the first one in the
  // extension host.
  const handleUpdateWithRepack = useCallback(
    (path: (string | number)[], value: unknown) => {
      const isBlocksWrite = path[0] === 'addressBlocks' && path.length === 1;
      const isRegistersWrite = path[0] === 'registers' && path.length === 1;
      const isStrideOrCountEdit =
        path.length === 1 && (path[0] === 'stride' || path[0] === 'count');

      // Stride/count edits on a register array change its footprint, so the
      // offsets of every sibling register after it must be re-stamped. A plain
      // handleUpdate would write only the scalar and leave stale offsets behind.
      if (isStrideOrCountEdit) {
        const selection = selectionRef.current;
        if (selection?.type === 'array') {
          const rootObj = YamlService.safeParse(rawTextRef.current);
          if (rootObj) {
            const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
            // Stamp the new stride/count onto the parsed array node so the
            // layout engine accounts for the updated footprint.
            const arrayPath = [...selectionRootPath, ...selection.path];
            const arrayNode = YamlPathResolver.getAtPath(root, arrayPath) as
              | Record<string, unknown>
              | undefined;
            if (arrayNode) {
              arrayNode[path[0] as string] = value;

              // The container (block for top-level arrays, parent array for
              // nested ones) holds the sibling registers needing offset repack.
              const containerPath = [...selectionRootPath, ...selection.path.slice(0, -2)];
              const container = YamlPathResolver.getAtPath(root, containerPath) as
                | Record<string, unknown>
                | undefined;
              if (container && Array.isArray(container.registers)) {
                const width = blockRegWidth(container);
                const laidOut = recomputeRegisterLayout(
                  container.registers as LayoutRegister[],
                  width
                );
                const sanitizedRegs = laidOut.map(
                  (r) =>
                    serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
                );
                const edits: { path: YamlPath; value: unknown }[] = [
                  { path: [...containerPath, 'registers'], value: sanitizedRegs },
                ];
                const newText = YamlService.applyPathEdits(rawTextRef.current, edits);
                if (newText !== rawTextRef.current) {
                  updateRawText(newText);
                  sendUpdate(newText);
                }
              }
            }
          }
          return;
        }
        // Non-array stride/count edit: fall through to the plain update path.
      }

      if (!isRegistersWrite && !isBlocksWrite) {
        handleUpdate(path, value);
        return;
      }

      const selection = selectionRef.current;
      if (!selection) {
        return;
      }
      const rootObj = YamlService.safeParse(rawTextRef.current);
      if (!rootObj) {
        return;
      }
      const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
      const fullPath = [...selectionRootPath, ...selection.path, ...path];

      const edits: { path: YamlPath; value: unknown }[] = [];
      let sanitizedValue: unknown;
      if (isRegistersWrite) {
        // Find the container whose registers are being edited.
        const containerPath = [...selectionRootPath, ...selection.path];

        const container = YamlPathResolver.getAtPath(root, containerPath) as
          | Record<string, unknown>
          | undefined;

        const width = blockRegWidth(container);
        const laidOut = recomputeRegisterLayout((value ?? []) as LayoutRegister[], width);
        sanitizedValue = laidOut.map(
          (r) => serializeValue(r as Record<string, unknown>, width) as Record<string, unknown>
        );

        edits.push({ path: fullPath, value: sanitizedValue });

        // Auto-expand stride for Register Arrays if footprint exceeds current stride
        if (container && (container.count !== undefined || container.__kind === 'array')) {
          const footprint = calculateBlockSize({ registers: laidOut });
          const currentStride = typeof container.stride === 'number' ? container.stride : 4;
          if (footprint > currentStride) {
            const newStride = Math.ceil(footprint / 4) * 4;
            edits.push({ path: [...containerPath, 'stride'], value: newStride });
          }
        }
      } else {
        // Block-level writes carry base addresses already computed by the
        // insertion service; just sanitize to schema keys.
        sanitizedValue = ((value ?? []) as Record<string, unknown>[]).map(
          (b) => serializeValue(b) as Record<string, unknown>
        );
        edits.push({ path: fullPath, value: sanitizedValue });
      }

      const newText = YamlService.applyPathEdits(rawTextRef.current, edits);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
      }
    },
    [handleUpdate, selectionRef, rawTextRef, updateRawText, sendUpdate]
  );

  /**
   * Render error state
   */
  if (parseError) {
    return (
      <div className="flex items-center justify-center h-screen vscode-surface">
        <div className="text-center p-8">
          <span className="codicon codicon-error text-6xl mb-4 block opacity-50"></span>
          <h2 className="text-xl font-semibold mb-2">Parse Error</h2>
          <p className="text-sm opacity-75">{parseError}</p>
        </div>
      </div>
    );
  }

  /**
   * Render loading state
   */
  if (!memoryMap) {
    return (
      <div className="flex items-center justify-center h-screen vscode-surface">
        <div className="text-center">
          <span className="codicon codicon-loading codicon-modifier-spin text-4xl opacity-50"></span>
          <p className="mt-4 text-sm opacity-75">Loading memory map...</p>
        </div>
      </div>
    );
  }

  /**
   * Main UI
   */
  return (
    <main className="flex-1 flex overflow-hidden relative">
      {/* Toggle strip — always visible, never overlaps content */}
      <div className="sidebar-toggle-strip">
        <button
          className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          title={sidebarOpen ? 'Hide outline' : 'Show outline'}
          aria-label={sidebarOpen ? 'Hide outline' : 'Show outline'}
        >
          <span
            className={`codicon text-base ${sidebarOpen ? 'codicon-layout-sidebar-left' : 'codicon-layout-sidebar-left-off'}`}
          ></span>
        </button>
        <button
          className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button"
          style={{ marginTop: 'auto', marginBottom: '8px' }}
          onClick={() => vscode?.postMessage({ type: 'command', command: 'reportIssue' })}
          title="Report Issue / Send Feedback"
          aria-label="Report Issue / Send Feedback"
        >
          <span className="codicon codicon-feedback text-base"></span>
        </button>
      </div>

      {/* Sidebar backdrop for mobile */}
      {sidebarOpen && (
        <div className="sidebar-backdrop active" onClick={() => setSidebarOpen(false)} />
      )}
      <aside
        className={`sidebar flex flex-col shrink-0 overflow-y-auto ${sidebarOpen ? 'sidebar-open' : ''}`}
        style={{ width: sidebarWidth }}
      >
        <Outline
          ref={outlineRef}
          memoryMap={memoryMap}
          selectedId={selectedId}
          onSelect={handleSelect}
          onRename={handleOutlineRename}
          onRegisterAction={handleRegisterAction}
          onBlockAction={handleBlockAction}
          onReorder={handleReorder}
        />
        <div
          className="sidebar-resize-handle"
          aria-hidden="true"
          onPointerDown={(e) => {
            e.preventDefault();
            sidebarResizingRef.current = true;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!sidebarResizingRef.current) {
              return;
            }
            setSidebarWidth(Math.min(600, Math.max(260, e.clientX)));
          }}
          onPointerUp={() => {
            sidebarResizingRef.current = false;
          }}
        />
      </aside>
      <section className="flex-1 overflow-hidden min-w-0">
        <DetailsPanel
          ref={detailsRef}
          selectedType={selectedType}
          selectedObject={selectedObject}
          selectionMeta={selectionMeta}
          onUpdate={handleUpdateWithRepack}
          onNavigateToRegister={navigateToRegister}
          onNavigateToBlock={navigateToBlock}
          registerLayout={registerLayout.layout}
          toggleRegisterLayout={registerLayout.toggle}
          blockLayout={blockLayout.layout}
          toggleBlockLayout={blockLayout.toggle}
          memoryMapLayout={memoryMapLayout.layout}
          toggleMemoryMapLayout={memoryMapLayout.toggle}
          arrayLayout={arrayLayout.layout}
          toggleArrayLayout={arrayLayout.toggle}
        />
      </section>
    </main>
  );
};

/**
 * Error boundary for catching React errors
 */
class ErrorBoundary extends React.Component<
  { children: ReactNode },
  { error: unknown; info: unknown }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error, info: null };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ error, info });
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: 'var(--vscode-inputValidation-errorBackground, #fff0f0)',
            color: 'var(--vscode-errorForeground, #b91c1c)',
            padding: 32,
            fontFamily: 'var(--vscode-editor-font-family, monospace)',
          }}
        >
          <h2 style={{ fontWeight: 'bold' }}>UI Error</h2>
          <div>{(this.state.error as Error)?.message || String(this.state.error)}</div>
          {!!this.state.info && (
            <pre style={{ marginTop: 16, fontSize: 12 }}>
              {(this.state.info as { componentStack?: string })?.componentStack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Application bootstrap
 */
const rootElement = document.getElementById('root');
if (rootElement) {
  // Disable default right-click menu except on inputs
  document.addEventListener(
    'contextmenu',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
    },
    { capture: true }
  );

  const root = createRoot(rootElement);
  root.render(
    <ErrorBoundary>
      <DebugModeProvider>
        <App />
      </DebugModeProvider>
    </ErrorBoundary>
  );
}
