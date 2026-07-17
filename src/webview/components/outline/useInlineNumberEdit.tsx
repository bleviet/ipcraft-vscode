import React, { useRef, useState } from 'react';
import type { YamlPath } from './types';

interface UseInlineNumberEditOptions {
  /** Writes the parsed value at `[...path, propertyKey]`. */
  onCommit: (path: YamlPath, value: number) => void;
  min?: number;
}

/**
 * Double-click-to-edit numeric field, for outline rows that need to edit a
 * plain integer property in place (e.g. a register array's count/stride) —
 * same interaction shape as OutlinePanel's renderBaseAddressOrEdit, but
 * generic over the property key and display formatting so it isn't
 * duplicated per field.
 */
export function useInlineNumberEdit({ onCommit, min = 1 }: UseInlineNumberEditOptions) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const start = (id: string, current: number) => {
    setEditingId(id);
    setValue(String(current));
    setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
  };

  const commit = (path: YamlPath, propertyKey: string) => {
    const parsed = parseInt(value, 10);
    if (!Number.isNaN(parsed) && parsed >= min) {
      onCommit([...path, propertyKey], parsed);
    }
    setEditingId(null);
    setValue('');
  };

  const cancel = () => {
    setEditingId(null);
    setValue('');
  };

  const render = (
    id: string,
    propertyKey: string,
    currentValue: number,
    path: YamlPath,
    formatDisplay: (v: number) => string,
    title: string
  ) => {
    if (editingId === id) {
      return (
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          className="outline-inline-edit px-1 py-0 text-[10px] font-mono border shrink-0"
          style={{
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            borderColor: 'var(--vscode-focusBorder)',
            width: `${Math.max(28, value.length * 8 + 8)}px`,
          }}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              commit(path, propertyKey);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          onBlur={() => commit(path, propertyKey)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        />
      );
    }
    return (
      <span
        className="cursor-pointer hover:underline"
        title={title}
        onDoubleClick={(e) => {
          e.stopPropagation();
          start(id, currentValue);
        }}
      >
        {formatDisplay(currentValue)}
      </span>
    );
  };

  return { render };
}
