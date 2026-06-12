import { useState, useCallback } from 'react';
import type { BitFieldRecord } from '../types/editor';
import { fieldToBitsString } from '../utils/BitFieldUtils';

export function useFieldDrafts() {
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [nameErrors, setNameErrors] = useState<Record<string, string | null>>({});

  const [bitsDrafts, setBitsDrafts] = useState<Record<number, string>>({});
  const [bitsErrors, setBitsErrors] = useState<Record<number, string | null>>({});

  const [resetDrafts, setResetDrafts] = useState<Record<number, string>>({});
  const [resetErrors, setResetErrors] = useState<Record<number, string | null>>({});

  const ensureDraftsInitialized = useCallback((index: number, field: BitFieldRecord) => {
    if (!field) {
      return;
    }

    const key = field.name ? `${field.name}` : `idx-${index}`;
    setNameDrafts((prev) =>
      prev[key] !== undefined ? prev : { ...prev, [key]: String(field.name ?? '') }
    );
    setBitsDrafts((prev) =>
      prev[index] !== undefined ? prev : { ...prev, [index]: fieldToBitsString(field) }
    );
    setResetDrafts((prev) => {
      if (prev[index] !== undefined) {
        return prev;
      }
      const v = field?.reset_value;
      const display =
        v !== null && v !== undefined ? `0x${Number(v).toString(16).toUpperCase()}` : '0x0';
      return { ...prev, [index]: display };
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
