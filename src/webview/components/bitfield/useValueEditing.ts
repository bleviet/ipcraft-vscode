import { useEffect, useMemo, useRef, useState } from 'react';

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

  // This hook only writes registerValue on commit (blur/Enter in ValueBar),
  // never on every keystroke, and every commit flips `valueEditing` to false
  // in the same batched render. So a `registerValue` change observed while
  // still editing can only be external (undo/redo, or another edit to the
  // underlying fields) -- never an echo of this draft's own typing -- and
  // must be adopted immediately rather than left stale until blur.
  const lastRegisterValueRef = useRef(registerValue);

  useEffect(() => {
    if (!valueEditing) {
      lastRegisterValueRef.current = registerValue;
      setValueDraft(registerValueText);
      setValueError(null);
      return;
    }
    if (registerValue !== lastRegisterValueRef.current) {
      lastRegisterValueRef.current = registerValue;
      setValueDraft(registerValueText);
      setValueError(null);
    }
  }, [registerValueText, valueEditing, registerValue]);

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
