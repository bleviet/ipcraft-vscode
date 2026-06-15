import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  VSCodeTextField,
  VSCodeTextArea,
  VSCodeDropdown,
  VSCodeOption,
} from '@vscode/webview-ui-toolkit/react';

export interface CellInputProps {
  /** Edit key for data-edit-key attribute. */
  editKey: string;
  /** Current display value. */
  value: string;
  /** Called on every input. */
  onInput: (value: string) => void;
  /** Called on blur (commit). Optional -- not all cells use blur-commit. */
  onBlur?: (value: string) => void;
  /** Called on focus (snapshot). */
  onFocus: () => void;
  /** If true, blur-commit is skipped (ESC was pressed). */
  cancelEditRef?: React.MutableRefObject<boolean>;
  /** Variant: 'text' | 'textarea' | 'dropdown'. Default: 'text'. */
  variant?: 'text' | 'textarea' | 'dropdown';
  /** Additional class name. */
  className?: string;
  /** Inline style overrides. */
  style?: React.CSSProperties;
  /** Options for dropdown variant. */
  options?: readonly string[];
}

/**
 * Shared input component for editable cells.
 * Enforces the standardized onInput + guarded onBlur commit strategy.
 */
export function CellInput({
  editKey,
  value,
  onInput,
  onBlur,
  onFocus,
  cancelEditRef,
  variant = 'text',
  className = '',
  style,
  options = [],
}: CellInputProps) {
  const isTextArea = variant === 'textarea';

  // The toolkit React wrapper forwards `ref` to the underlying
  // `<vscode-text-area>` element, which hosts the real <textarea> in its shadow
  // DOM. The declared ref type is misleading, so capture it as an HTMLElement.
  const textAreaRef = useRef<HTMLElement | null>(null);

  // Local draft for the textarea. While the field is focused, the draft is the
  // source of truth so a lagging round-trip of `value` (parse -> serialize ->
  // re-parse) cannot rewrite the element's value and snap the caret to the end.
  const [draft, setDraft] = useState(value);
  const isFocusedRef = useRef(false);

  // Adopt external `value` changes only when the field is not being edited
  // (reloads, undo, programmatic updates).
  useEffect(() => {
    if (!isFocusedRef.current && draft !== value) {
      setDraft(value);
    }
  }, [value, draft]);

  // Auto-grow the textarea to fit its content so multi-line descriptions are
  // not clipped. minHeight (from `style`) acts as the floor.
  const autoGrowTextArea = useCallback(() => {
    const inner = textAreaRef.current?.shadowRoot?.querySelector('textarea');
    if (!inner) {
      return;
    }
    inner.style.overflowY = 'hidden';
    inner.style.height = 'auto';
    const computed = getComputedStyle(inner);
    const borders =
      parseFloat(computed.borderTopWidth || '0') + parseFloat(computed.borderBottomWidth || '0');
    const floor = parseFloat(String(style?.minHeight ?? '')) || 0;
    inner.style.height = `${Math.max(inner.scrollHeight + borders, floor)}px`;
  }, [style?.minHeight]);

  useLayoutEffect(() => {
    if (isTextArea) {
      autoGrowTextArea();
    }
  }, [draft, isTextArea, autoGrowTextArea]);

  const handleInput = (e: Event | React.FormEvent<HTMLElement>) => {
    const next = (e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    if (isTextArea) {
      setDraft(next);
    }
    onInput(next);
  };

  const handleBlur = (e: Event | React.FocusEvent<HTMLElement>) => {
    if (cancelEditRef?.current) {
      return;
    }
    if (onBlur) {
      onBlur((e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
    } else {
      // Fallback to onInput if no onBlur is provided, to ensure final commit
      onInput((e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
    }
  };

  if (variant === 'dropdown') {
    return (
      <VSCodeDropdown
        data-edit-key={editKey}
        className={className}
        style={style}
        value={value}
        onFocus={onFocus}
        onChange={handleInput}
        onBlur={handleBlur}
      >
        {options.map((opt) => (
          <VSCodeOption key={opt} value={opt}>
            {opt}
          </VSCodeOption>
        ))}
      </VSCodeDropdown>
    );
  }

  if (variant === 'textarea') {
    return (
      <VSCodeTextArea
        ref={(el) => {
          textAreaRef.current = el as unknown as HTMLElement | null;
        }}
        data-edit-key={editKey}
        className={className}
        style={style}
        rows={1}
        value={draft}
        onFocus={() => {
          isFocusedRef.current = true;
          onFocus();
        }}
        onInput={handleInput}
        onBlur={(e) => {
          // Clearing focus first lets the sync effect re-adopt the canonical
          // value (e.g. after any normalization) once editing is done.
          isFocusedRef.current = false;
          handleBlur(e);
        }}
      />
    );
  }

  return (
    <VSCodeTextField
      data-edit-key={editKey}
      className={className}
      style={style}
      value={value}
      onFocus={onFocus}
      onInput={handleInput}
      onBlur={handleBlur}
    />
  );
}
