import { useEffect, useMemo, useRef, useState } from 'react';
import { hexDigitsForBits } from './utils';
import { BitVector } from '../../../dataInspector/BitVector';

interface UseValueEditingOptions {
  registerSize: number;
  registerValue: BitVector;
  parseRegisterValue: (text: string, view: 'hex' | 'dec') => BitVector | null;
  applyRegisterValue: (value: BitVector) => string | null | void;
}

export function useValueEditing({
  registerSize,
  registerValue,
  parseRegisterValue,
  applyRegisterValue,
}: UseValueEditingOptions) {
  const [valueView, setValueView] = useState<'hex' | 'dec'>('hex');
  const [valueDraft, setValueDraft] = useState<string>('');
  const [valueEditing, setValueEditing] = useState(false);
  const [valueError, setValueError] = useState<string | null>(null);
  const commitErrorRef = useRef<string | null>(null);

  // The "0x" prefix is rendered as a static label next to the field (see
  // ValueBar), so the editable draft holds bare digits: hex digits are
  // zero-padded to the register width so e.g. a 32-bit register always
  // reads "00000000" rather than "0", making it obvious which nibble to edit.
  const registerValueText = useMemo(() => {
    if (valueView === 'dec') {
      return registerValue.toBigInt()?.toString(10) ?? '';
    }
    const hex = registerValue.toHex() ?? registerValue.toBigInt()?.toString(16) ?? '';
    return hex.toUpperCase().padStart(hexDigitsForBits(registerSize), '0');
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
      setValueError(commitErrorRef.current);
      commitErrorRef.current = null;
      return;
    }
    if (!registerValue.equals(lastRegisterValueRef.current)) {
      lastRegisterValueRef.current = registerValue;
      setValueDraft(registerValueText);
      setValueError(null);
    }
  }, [registerValueText, valueEditing, registerValue]);

  const validateRegisterValue = (v: BitVector | null): string | null => {
    if (v === null) {
      return 'Value is required';
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
    const applyError = applyRegisterValue(parsed) ?? null;
    commitErrorRef.current = applyError;
    setValueError(applyError);
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
