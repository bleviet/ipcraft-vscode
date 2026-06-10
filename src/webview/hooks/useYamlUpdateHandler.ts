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
        applyFieldOperation({
          path,
          value,
          root,
          selectionRootPath,
          selection,
        });
        // For field-move, repack bitfields only within the affected register
        // to maintain contiguous layout without disturbing other registers.
        if (String(path[1] ?? '') === 'field-move') {
          const registerPath = [...selectionRootPath, ...selection.path];
          const reg = YamlPathResolver.getAtPath(root, registerPath) as
            | Record<string, unknown>
            | undefined;
          if (reg && Array.isArray(reg.fields) && reg.fields.length > 0) {
            const regWidth = typeof reg.size === 'number' && reg.size > 0 ? reg.size : 32;
            const updatedFields = recomputeBitfieldLayout(
              reg.fields as LayoutField[],
              regWidth
            ).map((f) => sanitizeFieldForYaml(f as Record<string, unknown>));
            YamlPathResolver.setAtPath(root, [...registerPath, 'fields'], updatedFields);
          }
        }
        const newText = YamlService.dump(root);
        updateRawText(newText);
        sendUpdate(newText);
        return;
      }

      const fullPath: YamlPath = [...selectionRootPath, ...selection.path, ...path];
      try {
        YamlPathResolver.setAtPath(root, fullPath, value);
        const newText = YamlService.dump(root);
        updateRawText(newText);
        sendUpdate(newText);
      } catch (err) {
        console.warn('Failed to apply update:', err);
      }
    },
    [rawTextRef, selectionRef, sendUpdate, updateRawText]
  );
}
