import { useCallback, useRef, useState } from 'react';
import { parseMemoryMap } from '../../domain/parse';
import type { NormalizedMemoryMap, MemoryMapRootStyle } from '../../domain/internal.types';

/**
 * Hook for managing memory map state including YAML parsing and normalization
 */
export function useMemoryMapState() {
  const [memoryMap, setMemoryMap] = useState<NormalizedMemoryMap | null>(null);
  const [rootStyle, setRootStyle] = useState<MemoryMapRootStyle>('standalone');
  const [rawText, setRawText] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>('');

  // Use refs for values that need to be accessed in callbacks
  const rawTextRef = useRef<string>('');

  const applyYamlUpdate = useCallback(
    (text: string, options?: { filename?: string; clearMemoryMapOnError?: boolean }) => {
      rawTextRef.current = text;
      setRawText(text);

      if (options?.filename) {
        setFileName(options.filename);
      }

      try {
        setMemoryMap((prevMap) => {
          const parsedDoc = parseMemoryMap(text, prevMap ?? undefined);
          setRootStyle(parsedDoc.rootStyle);
          return parsedDoc.map;
        });
        setParseError(null);
      } catch (err) {
        console.error('parseMemoryMap FAILED:', err);
        const message = err instanceof Error ? err.message : String(err);
        setParseError(message);
        if (options?.clearMemoryMapOnError) {
          setMemoryMap(null);
        }
      }
    },
    []
  );

  /**
   * Update the memory map from YAML text
   */
  const updateFromYaml = useCallback(
    (text: string, filename?: string) => {
      applyYamlUpdate(text, { filename, clearMemoryMapOnError: true });
    },
    [applyYamlUpdate]
  );

  /**
   * Update the raw YAML text (for programmatic updates)
   */
  const updateRawText = useCallback(
    (text: string) => {
      applyYamlUpdate(text, { clearMemoryMapOnError: false });
    },
    [applyYamlUpdate]
  );

  return {
    memoryMap,
    rootStyle,
    rawText,
    rawTextRef,
    parseError,
    fileName,
    updateFromYaml,
    updateRawText,
  };
}
