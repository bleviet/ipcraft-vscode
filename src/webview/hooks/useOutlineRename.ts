import { useCallback } from 'react';
import type { MutableRefObject } from 'react';
import { YamlPathResolver, type YamlPath } from '../services/YamlPathResolver';
import { YamlService } from '../services/YamlService';

interface OutlineRenameOptions {
  rawTextRef: MutableRefObject<string>;
  updateRawText: (text: string) => void;
  sendUpdate: (text: string) => void;
}

export function useOutlineRename({ rawTextRef, updateRawText, sendUpdate }: OutlineRenameOptions) {
  return useCallback(
    (path: YamlPath, newName: string) => {
      const currentText = rawTextRef.current;
      const rootObj = YamlService.safeParse(currentText);
      if (!rootObj) {
        console.warn('Cannot apply rename: YAML parse failed');
        return;
      }

      const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
      const fullPath: YamlPath = [...selectionRootPath, ...path];

      try {
        YamlPathResolver.setAtPath(root, fullPath, newName);
        const newText = YamlService.dump(root);
        updateRawText(newText);
        sendUpdate(newText);
      } catch (err) {
        console.warn('Failed to apply rename:', err);
      }
    },
    [rawTextRef, sendUpdate, updateRawText]
  );
}
