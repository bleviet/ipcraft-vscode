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
    (path: YamlPath, newName: string | number) => {
      const currentText = rawTextRef.current;
      const rootObj = YamlService.safeParse(currentText);
      if (!rootObj) {
        console.warn('Cannot apply rename: YAML parse failed');
        return;
      }

      const { selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);
      const fullPath: YamlPath = [...selectionRootPath, ...path];

      const newText = YamlService.applyPathEdits(currentText, [{ path: fullPath, value: newName }]);
      if (newText !== currentText) {
        updateRawText(newText);
        sendUpdate(newText);
      }
    },
    [rawTextRef, sendUpdate, updateRawText]
  );
}
