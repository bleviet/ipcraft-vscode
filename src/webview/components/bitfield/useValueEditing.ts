import { useEffect, useMemo, useRef, useState } from 'react';
import { hexDigitsForBits } from './utils';

interface UseValueEditingOptions {
  registerSize: number;
  registerValue: number;
  parseRegisterValue: (text: string, view: 'hex' | 'dec') => number | null;
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

  // The "0x" prefix is rendered as a static label next to the field (see
  // ValueBar), so the editable draft holds bare digits: hex digits are
  // zero-padded to the register width so e.g. a 32-bit register always
  // reads "00000000" rather than "0", making it obvious which nibble to edit.
  const registerValueText = useMemo(() => {
    if (valueView === 'dec') {
      return registerValue.toString(10);
    }
    return registerValue.toString(16).toUpperCase().padStart(hexDigitsForBits(registerSize), '0');
  }, [registerValue, valueView, registerSize]);

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
    const parsed = parseRegisterValue(valueDraft, valueView);
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
