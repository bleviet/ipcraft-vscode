import { useState, useCallback } from 'react';
import type { BitFieldRecord } from '../types/editor';
import { fieldToBitsString } from '../utils/BitFieldUtils';

export function useFieldDrafts() {
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string | null>>({});

  const [bitsDrafts, setBitsDrafts] = useState<Record<string, string>>({});
  const [bitsErrors, setBitsErrors] = useState<Record<string, string | null>>({});

  const [resetDrafts, setResetDrafts] = useState<Record<string, string>>({});
  const [resetErrors, setResetErrors] = useState<Record<string, string | null>>({});

  const ensureDraftsInitialized = useCallback((rowId: string, field: BitFieldRecord) => {
    if (!field) {
      return;
    }

    setNameDrafts((prev) =>
      prev[rowId] !== undefined ? prev : { ...prev, [rowId]: String(field.name ?? '') }
    );
    setBitsDrafts((prev) =>
      prev[rowId] !== undefined ? prev : { ...prev, [rowId]: fieldToBitsString(field) }
    );
    setResetDrafts((prev) => {
      if (prev[rowId] !== undefined) {
        return prev;
      }
      const v = field?.reset_value;
      const display =
        v !== null && v !== undefined ? `0x${Number(v).toString(16).toUpperCase()}` : '0x0';
      return { ...prev, [rowId]: display };
    });
  }, []);

  const clearAllDrafts = useCallback(() => {
    setNameDrafts({});
    setNameErrors({});
    setBitsDrafts({});
    setBitsErrors({});
    setResetDrafts({});
    setResetErrors({});
  }, []);

  return {
    nameDrafts,
    setNameDrafts,
    nameErrors,
    setNameErrors,
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
