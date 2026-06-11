import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { YamlPathResolver, type YamlPath } from '../services/YamlPathResolver';
import { YamlService } from '../services/YamlService';
import type { Selection } from './useSelection';
import { applyFieldOperation } from '../services/FieldOperationService';
import { recomputeBitfieldLayout, type LayoutField } from '../algorithms/LayoutEngine';
import { sanitizeFieldForYaml } from '../services/YamlSanitizer';

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

      if (path[0] === '__op' && selection.type === 'register') {
        // Compute the resulting fields array on the plain object, then write
        // only that array back so the rest of the document keeps its
        // formatting and comments.
        applyFieldOperation({
          path,
          value,
          root,
          selectionRootPath,
          selection,
        });
        const registerPath = [...selectionRootPath, ...selection.path];
        const reg = YamlPathResolver.getAtPath(root, registerPath) as
          | Record<string, unknown>
          | undefined;
        let fields = Array.isArray(reg?.fields) ? (reg.fields as Record<string, unknown>[]) : [];
        // For field-move, repack bitfields only within the affected register
        // to maintain contiguous layout without disturbing other registers.
        if (String(path[1] ?? '') === 'field-move' && fields.length > 0) {
          const regWidth = typeof reg?.size === 'number' && reg.size > 0 ? reg.size : 32;
          fields = recomputeBitfieldLayout(fields as LayoutField[], regWidth).map((f) =>
            sanitizeFieldForYaml(f as Record<string, unknown>)
          );
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
