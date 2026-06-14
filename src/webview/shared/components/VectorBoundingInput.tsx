import React, { useState, useEffect, useRef } from 'react';

export interface VectorBoundingInputProps {
  editKey: string;
  value: string;
  registerSize: number;
  hasError?: boolean;
  onInput: (value: string) => void;
  onFocus?: () => void;
  cancelEditRef?: React.MutableRefObject<boolean>;
  className?: string;
}

export const VectorBoundingInput: React.FC<VectorBoundingInputProps> = ({
  editKey,
  value,
  registerSize,
  hasError = false,
  onInput,
  onFocus,
  cancelEditRef,
  className = '',
}) => {
  const [localMsb, setLocalMsb] = useState('');
  const [localLsb, setLocalLsb] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const msbRef = useRef<HTMLInputElement>(null);
  const lsbRef = useRef<HTMLInputElement>(null);
  const isFocusedRef = useRef(false);

  const parseValue = (val: string): [string, string] => {
    const trimmed = val.trim();
    if (trimmed === '[?:?]') {
      return ['', ''];
    }
    const match = trimmed.match(/^\[(\d+)(?::(\d+))?\]$/);
    if (match) {
      const msb = match[1];
      const lsb = match[2] ?? msb;
      return [msb, lsb];
    }
    return ['', ''];
  };

  useEffect(() => {
    const [m, l] = parseValue(value);
    setLocalMsb(m);
    setLocalLsb(l);
  }, [value]);

  const maxBit = registerSize ? registerSize - 1 : 31;

  const formatRange = (msb: string, lsb: string): string => {
    if (msb === '' && lsb === '') {
      return '[?:?]';
    }
    return `[${msb}:${lsb}]`;
  };

  const adjustValue = (isMsb: boolean, delta: number) => {
    const currentMsb = localMsbRef.current;
    const currentLsb = localLsbRef.current;
    const currentStr = isMsb ? currentMsb : currentLsb;
    let currentVal = currentStr === '' ? 0 : parseInt(currentStr, 10);
    if (Number.isNaN(currentVal)) {
      currentVal = 0;
    }

    const nextVal = Math.max(0, Math.min(currentVal + delta, maxBit));
    const nextStr = String(nextVal);

    if (isMsb) {
      setLocalMsb(nextStr);
      onInputRef.current(formatRange(nextStr, currentLsb));
    } else {
      setLocalLsb(nextStr);
      onInputRef.current(formatRange(currentMsb, nextStr));
    }
  };

  const localMsbRef = useRef(localMsb);
  localMsbRef.current = localMsb;
  const localLsbRef = useRef(localLsb);
  localLsbRef.current = localLsb;
  const adjustValueRef = useRef(adjustValue);
  adjustValueRef.current = adjustValue;
  const onInputRef = useRef(onInput);
  onInputRef.current = onInput;

  useEffect(() => {
    const msbEl = msbRef.current;
    const lsbEl = lsbRef.current;

    const preventTableNavAndStep = (e: KeyboardEvent, isMsb: boolean) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        adjustValueRef.current(isMsb, 1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        adjustValueRef.current(isMsb, -1);
        return;
      }

      const controlKeys = [
        'Backspace',
        'Tab',
        'ArrowLeft',
        'ArrowRight',
        'Delete',
        'Enter',
        'Escape',
      ];
      if (controlKeys.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (!/^\d$/.test(e.key)) {
        e.preventDefault();
      }
    };

    const handleMsbKeyDown = (e: KeyboardEvent) => preventTableNavAndStep(e, true);
    const handleLsbKeyDown = (e: KeyboardEvent) => preventTableNavAndStep(e, false);

    const handleWheel = (e: WheelEvent, isMsb: boolean) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      adjustValueRef.current(isMsb, delta);
    };

    const handleMsbWheel = (e: WheelEvent) => handleWheel(e, true);
    const handleLsbWheel = (e: WheelEvent) => handleWheel(e, false);

    msbEl?.addEventListener('keydown', handleMsbKeyDown);
    lsbEl?.addEventListener('keydown', handleLsbKeyDown);
    msbEl?.addEventListener('wheel', handleMsbWheel, { passive: false });
    lsbEl?.addEventListener('wheel', handleLsbWheel, { passive: false });

    return () => {
      msbEl?.removeEventListener('keydown', handleMsbKeyDown);
      lsbEl?.removeEventListener('keydown', handleLsbKeyDown);
      msbEl?.removeEventListener('wheel', handleMsbWheel);
      lsbEl?.removeEventListener('wheel', handleLsbWheel);
    };
  }, []);

  const handleMsbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const clean = e.target.value.replace(/\D/g, '');
    setLocalMsb(clean);
    onInput(formatRange(clean, localLsb));
  };

  const handleLsbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const clean = e.target.value.replace(/\D/g, '');
    setLocalLsb(clean);
    onInput(formatRange(localMsb, clean));
  };

  const handleFocus = () => {
    if (!isFocusedRef.current) {
      isFocusedRef.current = true;
      onFocus?.();
    }
  };

  const commitChanges = () => {
    if (cancelEditRef?.current) {
      return;
    }

    let mNum = localMsb === '' ? NaN : parseInt(localMsb, 10);
    let lNum = localLsb === '' ? NaN : parseInt(localLsb, 10);

    if (Number.isNaN(mNum) && Number.isNaN(lNum)) {
      onInput('[?:?]');
      return;
    }

    if (Number.isNaN(mNum)) {
      mNum = lNum;
    }
    if (Number.isNaN(lNum)) {
      lNum = mNum;
    }

    let clampedMsb = Math.max(0, Math.min(mNum, maxBit));
    let clampedLsb = Math.max(0, Math.min(lNum, maxBit));

    if (clampedMsb < clampedLsb) {
      const temp = clampedMsb;
      clampedMsb = clampedLsb;
      clampedLsb = temp;
    }

    const finalMsb = String(clampedMsb);
    const finalLsb = String(clampedLsb);

    setLocalMsb(finalMsb);
    setLocalLsb(finalLsb);

    onInput(`[${finalMsb}:${finalLsb}]`);
  };

  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (containerRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    isFocusedRef.current = false;
    commitChanges();
  };

  const mVal = localMsb === '' ? NaN : parseInt(localMsb, 10);
  const lVal = localLsb === '' ? NaN : parseInt(localLsb, 10);
  const localError =
    (!Number.isNaN(mVal) && mVal > maxBit) ||
    (!Number.isNaN(lVal) && lVal > maxBit) ||
    (!Number.isNaN(mVal) && !Number.isNaN(lVal) && mVal < lVal);

  const showError = hasError || localError;

  return (
    <div
      ref={containerRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
      data-edit-key={editKey}
      className={`
        inline-flex items-center justify-center
        h-[22px] px-1 bg-[var(--vscode-input-background)]
        border rounded font-mono text-xs select-none
        ${
          showError
            ? 'border-[var(--vscode-inputValidation-errorBorder)] focus-within:border-[var(--vscode-inputValidation-errorBorder)]'
            : 'border-[var(--vscode-input-border,transparent)] focus-within:border-[var(--vscode-focusBorder)]'
        }
        focus-within:ring-1 focus-within:ring-[var(--vscode-focusBorder)]
        ${className}
      `}
      style={{
        boxSizing: 'border-box',
        verticalAlign: 'middle',
      }}
    >
      <span className="opacity-80 px-0.5 select-none text-[var(--vscode-input-foreground)]">[</span>
      <input
        type="text"
        ref={msbRef}
        value={localMsb}
        onChange={handleMsbChange}
        placeholder="MSB"
        className="w-[24px] text-center bg-transparent border-none outline-none p-0 h-full font-mono text-xs text-[var(--vscode-input-foreground)] focus:bg-[var(--vscode-input-background)]"
        style={{
          boxSizing: 'border-box',
          lineHeight: '1',
        }}
      />
      <span className="opacity-80 px-0.5 select-none text-[var(--vscode-input-foreground)]">:</span>
      <input
        type="text"
        ref={lsbRef}
        value={localLsb}
        onChange={handleLsbChange}
        placeholder="LSB"
        className="w-[24px] text-center bg-transparent border-none outline-none p-0 h-full font-mono text-xs text-[var(--vscode-input-foreground)] focus:bg-[var(--vscode-input-background)]"
        style={{
          boxSizing: 'border-box',
          lineHeight: '1',
        }}
      />
      <span className="opacity-80 px-0.5 select-none text-[var(--vscode-input-foreground)]">]</span>
    </div>
  );
};
