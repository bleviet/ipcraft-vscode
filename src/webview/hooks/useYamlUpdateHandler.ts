import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { YamlPathResolver, type YamlPath } from '../services/YamlPathResolver';
import { YamlService } from '../services/YamlService';
import type { Selection } from './useSelection';
import { applyFieldOperation } from '../services/FieldOperationService';

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
