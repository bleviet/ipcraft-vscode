import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { YamlPathResolver, type YamlPath } from '../services/YamlPathResolver';
import { YamlService } from '../services/YamlService';
import type { Selection } from './useSelection';
import { applyFieldOperation } from '../services/FieldOperationService';
import { reorderBitfieldLayout, type LayoutField } from '../algorithms/LayoutEngine';
import { serializeValue } from '../../domain/serialize';

interface YamlUpdateHandlerOptions {
  selectionRef: MutableRefObject<Selection | null>;
  rawTextRef: MutableRefObject<string>;
  updateRawText: (text: string) => void;
  sendUpdate: (text: string) => void;
}

export function useYamlUpdateHandler({
  selectionRef,
  rawTextRef,
  updateRawText,
  sendUpdate,
}: YamlUpdateHandlerOptions) {
  return useCallback(
    (path: YamlPath, value: unknown) => {
      const selection = selectionRef.current;
      if (!selection) {
        return;
      }

      const rootObj = YamlService.safeParse(rawTextRef.current);
      if (!rootObj) {
        console.warn('Cannot apply update: YAML parse failed');
        return;
      }

      const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);

      // Flat register arrays and registers expose the same bit-field editor, so
      // their field operations route through the same fields-array writer. When
      // a block is selected (master-detail), the operation carries a
      // `__regIndex` pointing at the active register within the block.
      const opPayload = (value ?? {}) as Record<string, unknown>;
      const hasRegIndex = typeof opPayload.__regIndex === 'number';
      if (
        path[0] === '__op' &&
        (selection.type === 'register' ||
          selection.type === 'array' ||
          (selection.type === 'block' && hasRegIndex))
      ) {
        // The register the fields belong to: either the selection itself, or a
        // register nested under the selected block.
        const regSubPath: YamlPath = hasRegIndex
          ? [...selection.path, 'registers', opPayload.__regIndex as number]
          : selection.path;
        // Strip the routing-only __regIndex before the operation reads payload.
        const opValue = hasRegIndex
          ? (() => {
              const { __regIndex: _ignored, ...rest } = opPayload;
              return rest;
            })()
          : value;
        // Compute the resulting fields array on the plain object, then write
        // only that array back so the rest of the document keeps its
        // formatting and comments.
        applyFieldOperation({
          path,
          value: opValue,
          root,
          selectionRootPath,
          selection,
          registerSubPath: regSubPath,
        });
        const registerPath = [...selectionRootPath, ...regSubPath];
        const reg = YamlPathResolver.getAtPath(root, registerPath) as
          | Record<string, unknown>
          | undefined;
        let fields = Array.isArray(reg?.fields) ? (reg.fields as Record<string, unknown>[]) : [];
        // For field-move, swap adjacent field segments in bit-space while
        // preserving gaps, rather than packing contiguously.
        if (String(path[1] ?? '') === 'field-move' && fields.length > 0) {
          const regWidth = typeof reg?.size === 'number' && reg.size > 0 ? reg.size : 32;
          const payload = opValue as { index?: number; delta?: number } | null;
          const fromIdx = typeof payload?.index === 'number' ? payload.index : -1;
          const delta = typeof payload?.delta === 'number' ? payload.delta : 0;
          const movedIdx = fromIdx + delta;
          const direction: 'lsb' | 'msb' = delta < 0 ? 'lsb' : 'msb';
          fields = reorderBitfieldLayout(
            fields as LayoutField[],
            movedIdx,
            direction,
            regWidth
          ).map((f) => serializeValue(f as Record<string, unknown>) as Record<string, unknown>);
        }
        const newText = YamlService.applyPathEdits(rawTextRef.current, [
          { path: [...registerPath, 'fields'], value: fields },
        ]);
        if (newText !== rawTextRef.current) {
          updateRawText(newText);
          sendUpdate(newText);
        }
        return;
      }

      const fullPath: YamlPath = [...selectionRootPath, ...selection.path, ...path];
      const newText = YamlService.applyPathEdits(rawTextRef.current, [{ path: fullPath, value }]);
      if (newText !== rawTextRef.current) {
        updateRawText(newText);
        sendUpdate(newText);
      }
    },
    [rawTextRef, selectionRef, sendUpdate, updateRawText]
  );
}
