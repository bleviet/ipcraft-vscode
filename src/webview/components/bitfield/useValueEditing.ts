import { useEffect, useMemo, useState } from 'react';

interface UseValueEditingOptions {
  registerSize: number;
  registerValue: number;
  parseRegisterValue: (text: string) => number | null;
  maxForBits: (bitCount: number) => number;
  applyRegisterValue: (value: number) => void;
}

export function useValueEditing({
  registerSize,
  registerValue,
  parseRegisterValue,
  maxForBits,
  applyRegisterValue,
}: UseValueEditingOptions) {
  const [valueView, setValueView] = useState<'hex' | 'dec'>('hex');
  const [valueDraft, setValueDraft] = useState<string>('');
  const [valueEditing, setValueEditing] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);

  const registerValueText = useMemo(() => {
    if (valueView === 'dec') {
      return registerValue.toString(10);
    }
    return `0x${registerValue.toString(16).toUpperCase()}`;
  }, [registerValue, valueView]);

  useEffect(() => {
    if (valueEditing) {
      return;
    }
    setValueDraft(registerValueText);
    setValueError(null);
  }, [registerValueText, valueEditing]);

  const validateRegisterValue = (v: number | null): string | null => {
    if (v === null) {
      return 'Value is required';
    }
    if (!Number.isFinite(v)) {
      return 'Invalid number';
    }
    if (v < 0) {
      return 'Value must be >= 0';
    }
    const max = maxForBits(registerSize);
    if (v > max) {
      return `Value too large for ${registerSize} bit(s)`;
    }
    return null;
  };

  const commitRegisterValueDraft = () => {
    const parsed = parseRegisterValue(valueDraft);
    const err = validateRegisterValue(parsed);
    setValueError(err);
    if (err || parsed === null) {
      return;
    }
    applyRegisterValue(parsed);
  };

  return {
    valueView,
    setValueView,
    valueDraft,
    setValueDraft,
    valueEditing,
    setValueEditing,
    valueError,
    setValueError,
    registerValueText,
    validateRegisterValue,
    commitRegisterValueDraft,
  };
}
