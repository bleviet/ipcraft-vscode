import { useCallback, useRef, useState } from 'react';
import type { MemoryMap } from '../types/memoryMap';
import { YamlService } from '../services/YamlService';
import { DataNormalizer } from '../services/DataNormalizer';

function parseAndNormalize(text: string): MemoryMap {
  const parsed = YamlService.parse(text) as Record<string, unknown> | unknown[];

  let map: unknown;
  if (Array.isArray(parsed)) {
    map = parsed[0];
  } else if (parsed.memory_maps) {
    map = (parsed.memory_maps as unknown[])[0];
  } else {
    map = parsed;
  }

  return DataNormalizer.normalizeMemoryMap(map);
}

/**
 * Hook for managing memory map state including YAML parsing and normalization
 */
export function useMemoryMapState() {
  const [memoryMap, setMemoryMap] = useState<MemoryMap | null>(null);
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
        const normalized = parseAndNormalize(text);
        setMemoryMap(normalized);
        setParseError(null);
      } catch (err) {
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
    rawText,
    rawTextRef,
    parseError,
    fileName,
    updateFromYaml,
    updateRawText,
  };
}
