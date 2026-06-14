import React, { useState, useEffect, useRef } from 'react';

const STEP_COMMIT_DEBOUNCE_MS = 300;

export interface VectorBoundingInputProps {
  editKey: string;
  value: string;
  registerSize: number;
  maxWidth: number;
  hasError?: boolean;
  onInput: (value: string) => void;
  onBlur?: (value: string) => void;
  onFocus?: () => void;
  cancelEditRef?: React.MutableRefObject<boolean>;
  className?: string;
}

export const VectorBoundingInput: React.FC<VectorBoundingInputProps> = ({
  editKey,
  value,
  registerSize,
  maxWidth,
  hasError = false,
  onInput,
  onBlur,
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
  const localMsbRef = useRef(localMsb);
  const localLsbRef = useRef(localLsb);
  const onInputRef = useRef(onInput);
  const adjustValueRef = useRef<((isMsb: boolean, delta: number) => void) | null>(null);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isFocusedRef.current) {
      const [m, l] = parseValue(value);
      setLocalMsb(m);
      setLocalLsb(l);
    }
  }, [value]);

  useEffect(() => {
    localMsbRef.current = localMsb;
  }, [localMsb]);

  useEffect(() => {
    localLsbRef.current = localLsb;
  }, [localLsb]);

  useEffect(() => {
    onInputRef.current = onInput;
  }, [onInput]);

  useEffect(() => {
    return () => {
      if (commitTimerRef.current !== null) {
        clearTimeout(commitTimerRef.current);
        commitTimerRef.current = null;
      }
    };
  }, []);

  const parseValue = (val: string): [string, string] => {
    const trimmed = val.trim();
    if (trimmed === '[?:?]') {
      return ['', ''];
    }
    const match = trimmed.match(/^\[([0-9\?]+)(?::([0-9\?]+))?\]$/);
    if (match) {
      const msb = match[1] === '?' ? '' : match[1];
      const lsb = match[2] ? (match[2] === '?' ? '' : match[2]) : msb;
      return [msb, lsb];
    }
    return ['', ''];
  };

  const safeMaxBit = registerSize > 0 ? registerSize - 1 : 0;

  const formatRange = (msb: string, lsb: string): string => {
    if (msb === '' && lsb === '') {
      return '[?:?]';
    }
    if (msb !== '' && lsb !== '' && msb === lsb) {
      return `[${msb}]`;
    }
    const displayMsb = msb === '' ? '?' : msb;
    const displayLsb = lsb === '' ? '?' : lsb;
    return `[${displayMsb}:${displayLsb}]`;
  };

  const scheduleCommit = (range: string) => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
    }
    commitTimerRef.current = setTimeout(() => {
      commitTimerRef.current = null;
      onInputRef.current(range);
    }, STEP_COMMIT_DEBOUNCE_MS);
  };

  const adjustValue = (isMsb: boolean, delta: number) => {
    const currentMsb = localMsbRef.current;
    const currentLsb = localLsbRef.current;
    const currentStr = isMsb ? currentMsb : currentLsb;
    let currentVal = 0;
    if (currentStr !== '') {
      currentVal = parseInt(currentStr, 10);
    } else {
      const otherStr = isMsb ? currentLsb : currentMsb;
      if (otherStr !== '') {
        currentVal = parseInt(otherStr, 10);
      }
    }
    if (Number.isNaN(currentVal)) {
      currentVal = 0;
    }

    let nextVal = Math.max(0, Math.min(currentVal + delta, safeMaxBit));

    if (isMsb) {
      const lNum = currentLsb === '' ? 0 : parseInt(currentLsb, 10);
      if (!Number.isNaN(lNum)) {
        nextVal = Math.max(lNum, Math.min(nextVal, lNum + maxWidth - 1));
      }
    } else {
      const mNum = currentMsb === '' ? 0 : parseInt(currentMsb, 10);
      if (!Number.isNaN(mNum)) {
        nextVal = Math.max(0, Math.max(mNum - maxWidth + 1, Math.min(nextVal, mNum)));
      }
    }

    const nextStr = String(nextVal);

    if (isMsb) {
      setLocalMsb(nextStr);
      scheduleCommit(formatRange(nextStr, currentLsb));
    } else {
      setLocalLsb(nextStr);
      scheduleCommit(formatRange(currentMsb, nextStr));
    }
  };

  useEffect(() => {
    adjustValueRef.current = adjustValue;
  });

  useEffect(() => {
    const msbEl = msbRef.current;
    const lsbEl = lsbRef.current;

    const preventTableNavAndStep = (e: KeyboardEvent, isMsb: boolean) => {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        adjustValueRef.current?.(isMsb, 1);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        adjustValueRef.current?.(isMsb, -1);
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
      adjustValueRef.current?.(isMsb, delta);
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
    let finalMsb = clean;
    if (clean !== '') {
      let mNum = parseInt(clean, 10);
      if (mNum > safeMaxBit) {
        mNum = safeMaxBit;
        finalMsb = String(safeMaxBit);
      }
      if (localLsb !== '') {
        const lNum = parseInt(localLsb, 10);
        if (mNum >= lNum) {
          if (mNum - lNum + 1 > maxWidth) {
            finalMsb = String(lNum + maxWidth - 1);
          }
        } else {
          if (lNum - mNum + 1 > maxWidth) {
            finalMsb = String(lNum - maxWidth + 1);
          }
        }
      }
    }
    setLocalMsb(finalMsb);
    onInput(formatRange(finalMsb, localLsb));
  };

  const handleLsbChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const clean = e.target.value.replace(/\D/g, '');
    let finalLsb = clean;
    if (clean !== '') {
      let lNum = parseInt(clean, 10);
      if (lNum > safeMaxBit) {
        lNum = safeMaxBit;
        finalLsb = String(safeMaxBit);
      }
      if (localMsb !== '') {
        const mNum = parseInt(localMsb, 10);
        if (mNum >= lNum) {
          if (mNum - lNum + 1 > maxWidth) {
            finalLsb = String(Math.max(0, mNum - maxWidth + 1));
          }
        } else {
          if (lNum - mNum + 1 > maxWidth) {
            finalLsb = String(Math.max(0, mNum + maxWidth - 1));
          }
        }
      }
    }
    setLocalLsb(finalLsb);
    onInput(formatRange(localMsb, finalLsb));
  };

  const handleFocus = () => {
    if (!isFocusedRef.current) {
      isFocusedRef.current = true;
      onFocus?.();
    }
  };

  const commitChanges = () => {
    if (commitTimerRef.current !== null) {
      clearTimeout(commitTimerRef.current);
      commitTimerRef.current = null;
    }

    if (cancelEditRef?.current) {
      return;
    }

    let mNum = localMsb === '' ? NaN : parseInt(localMsb, 10);
    let lNum = localLsb === '' ? NaN : parseInt(localLsb, 10);

    if (Number.isNaN(mNum) && Number.isNaN(lNum)) {
      onInput('[?:?]');
      onBlur?.('[?:?]');
      return;
    }

    if (Number.isNaN(mNum)) {
      mNum = lNum;
    }
    if (Number.isNaN(lNum)) {
      lNum = mNum;
    }

    let clampedMsb = Math.max(0, Math.min(mNum, safeMaxBit));
    let clampedLsb = Math.max(0, Math.min(lNum, safeMaxBit));

    if (clampedMsb < clampedLsb) {
      const temp = clampedMsb;
      clampedMsb = clampedLsb;
      clampedLsb = temp;
    }

    if (clampedMsb - clampedLsb + 1 > maxWidth) {
      clampedMsb = clampedLsb + maxWidth - 1;
    }

    const finalMsb = String(clampedMsb);
    const finalLsb = String(clampedLsb);

    setLocalMsb(finalMsb);
    setLocalLsb(finalLsb);

    const rangeStr = formatRange(finalMsb, finalLsb);
    if (rangeStr !== value) {
      onInput(rangeStr);
      onBlur?.(rangeStr);
    }
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
    (!Number.isNaN(mVal) && mVal > safeMaxBit) ||
    (!Number.isNaN(lVal) && lVal > safeMaxBit) ||
    (!Number.isNaN(mVal) && !Number.isNaN(lVal) && mVal < lVal);

  const showError = hasError || localError;
  const inputWidth = `${Math.max(24, String(safeMaxBit).length * 8 + 8)}px`;

  return (
    <div
      ref={containerRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
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
        aria-label="Most Significant Bit"
        data-edit-key={editKey}
        className="text-center bg-transparent border-none outline-none p-0 h-full font-mono text-xs text-[var(--vscode-input-foreground)] focus:bg-[var(--vscode-input-background)]"
        style={{
          boxSizing: 'border-box',
          lineHeight: '1',
          width: inputWidth,
        }}
      />
      <span className="opacity-80 px-0.5 select-none text-[var(--vscode-input-foreground)]">:</span>
      <input
        type="text"
        ref={lsbRef}
        value={localLsb}
        onChange={handleLsbChange}
        placeholder="LSB"
        aria-label="Least Significant Bit"
        className="text-center bg-transparent border-none outline-none p-0 h-full font-mono text-xs text-[var(--vscode-input-foreground)] focus:bg-[var(--vscode-input-background)]"
        style={{
          boxSizing: 'border-box',
          lineHeight: '1',
          width: inputWidth,
        }}
      />
      <span className="opacity-80 px-0.5 select-none text-[var(--vscode-input-foreground)]">]</span>
    </div>
  );
};
