import { useState, useCallback } from 'react';
import type { BitFieldRecord } from '../types/editor';
import { fieldToBitsString } from '../utils/BitFieldUtils';
import { formatResetDisplay } from '../shared/utils/fieldValidation';

export function useFieldDrafts() {
  const [bitsDrafts, setBitsDrafts] = useState<Record<string, string>>({});
  const [bitsErrors, setBitsErrors] = useState<Record<string, string | null>>({});

  const [resetDrafts, setResetDrafts] = useState<Record<string, string>>({});
  const [resetErrors, setResetErrors] = useState<Record<string, string | null>>({});

  const ensureDraftsInitialized = useCallback((rowId: string, field: BitFieldRecord) => {
    if (!field) {
      return;
    }

    setBitsDrafts((prev) =>
      prev[rowId] !== undefined ? prev : { ...prev, [rowId]: fieldToBitsString(field) }
    );
    setResetDrafts((prev) => {
      if (prev[rowId] !== undefined) {
        return prev;
      }
      return { ...prev, [rowId]: formatResetDisplay(field) };
    });
  }, []);

  const clearAllDrafts = useCallback(() => {
    setBitsDrafts({});
    setBitsErrors({});
    setResetDrafts({});
    setResetErrors({});
  }, []);

  return {
    bitsDrafts,
    setBitsDrafts,
    bitsErrors,
    setBitsErrors,
    resetDrafts,
    setResetDrafts,
    resetErrors,
    setResetErrors,
    ensureDraftsInitialized,
    clearAllDrafts,
  };
}
