import React, { useCallback, useEffect, useRef } from 'react';
import { useEditableDraft } from '../hooks/useEditableDraft';

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
  /**
   * Options for dropdown variant. A plain string is both the value and the
   * displayed label (existing behavior). An object lets the closed control
   * show a short `label` while `detail` (e.g. the full enum name) is
   * available as option metadata for callers and assistive descriptions.
   */
  options?: readonly (string | { value: string; label: string; detail?: string })[];
  /**
   * When false (default) pointer events are blocked so single click only
   * selects the row; double-click or keyboard (e/Enter) triggers editing.
   * The `dropdown` variant ignores this for pointer-event gating: opening a
   * listbox is non-destructive and cancellable (unlike dropping a caret into
   * text), so it always allows pointer events and opens on a single click.
   */
  isEditing?: boolean;
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
  isEditing = false,
}: CellInputProps) {
  // Dropdown cells always accept pointer events: opening a listbox is
  // non-destructive and cancellable (Esc/outside-click), unlike dropping a
  // caret into text, so it opens on a single click rather than requiring
  // double-click-to-edit first. Text/textarea keep the existing gating.
  const pointerStyle: React.CSSProperties = {
    ...style,
    pointerEvents: variant === 'dropdown' || isEditing ? 'auto' : 'none',
  };
  const isTextArea = variant === 'textarea';
  // Text and textarea inputs have a caret; the dropdown does not.
  const usesDraft = variant !== 'dropdown';

  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);

  // Local draft keeps the caret stable for text/textarea inputs (see hook).
  const { draft, setDraft, markFocused, markBlurred } = useEditableDraft(value);

  // Auto-grow the textarea to fit its content so multi-line descriptions are
  // not clipped. minHeight (from `style`) acts as the floor.
  const autoGrowTextArea = useCallback(() => {
    const textArea = textAreaRef.current;
    if (!textArea) {
      return;
    }
    textArea.style.overflowY = 'hidden';
    textArea.style.height = 'auto';
    const computed = getComputedStyle(textArea);
    const borders =
      parseFloat(computed.borderTopWidth || '0') + parseFloat(computed.borderBottomWidth || '0');
    const floor = parseFloat(String(style?.minHeight ?? '')) || 0;
    textArea.style.height = `${Math.max(textArea.scrollHeight + borders, floor)}px`;
  }, [style?.minHeight]);

  // Size pre-filled textareas on mount and whenever the value changes. The
  // Defer one frame so layout is available after React has applied the value.
  useEffect(() => {
    if (!isTextArea) {
      return;
    }
    const raf = requestAnimationFrame(() => autoGrowTextArea());
    return () => cancelAnimationFrame(raf);
  }, [draft, isTextArea, autoGrowTextArea]);

  const handleInput = (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const next = event.target.value;
    if (usesDraft) {
      setDraft(next);
    }
    onInput(next);
    if (isTextArea) {
      autoGrowTextArea();
    }
  };

  const handleBlur = (
    event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    if (cancelEditRef?.current) {
      return;
    }
    if (onBlur) {
      onBlur(event.target.value);
    } else {
      // Fallback to onInput if no onBlur is provided, to ensure final commit
      onInput(event.target.value);
    }
  };

  if (variant === 'dropdown') {
    return (
      <select
        data-edit-key={editKey}
        className={`vscode-control vscode-select vscode-field-bare ${className}`}
        style={pointerStyle}
        value={value}
        aria-label={editKey}
        onFocus={onFocus}
        onChange={handleInput}
        onBlur={handleBlur}
      >
        {options.map((opt) => {
          const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt;
          return (
            <option key={normalized.value} value={normalized.value} title={normalized.detail}>
              {normalized.label}
            </option>
          );
        })}
      </select>
    );
  }

  if (variant === 'textarea') {
    return (
      <textarea
        ref={textAreaRef}
        data-edit-key={editKey}
        className={`vscode-control vscode-field-bare ${className}`}
        style={pointerStyle}
        rows={1}
        value={draft}
        aria-label={editKey}
        onFocus={() => {
          markFocused();
          onFocus();
        }}
        onChange={handleInput}
        onBlur={(e) => {
          // Clearing focus first lets the draft re-adopt the canonical value
          // (e.g. after any normalization) once editing is done.
          markBlurred();
          handleBlur(e);
        }}
      />
    );
  }

  return (
    <input
      type="text"
      data-edit-key={editKey}
      className={`vscode-control vscode-field-bare ${className}`}
      style={pointerStyle}
      value={draft}
      aria-label={editKey}
      onFocus={() => {
        markFocused();
        onFocus();
      }}
      onChange={handleInput}
      onBlur={(e) => {
        // Clearing focus first lets the draft re-adopt the canonical value
        // (e.g. after any normalization) once editing is done.
        markBlurred();
        handleBlur(e);
      }}
    />
  );
}
