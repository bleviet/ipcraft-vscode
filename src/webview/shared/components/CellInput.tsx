import React, { useCallback, useEffect, useRef } from 'react';
import {
  VSCodeTextField,
  VSCodeTextArea,
  VSCodeDropdown,
  VSCodeOption,
} from '@vscode/webview-ui-toolkit/react';
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
   * revealed only in the open listbox via CSS (see
   * `vscode-option[data-option-detail]::after` in index.css).
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
  /** Dropdown popup position, passed through to `VSCodeDropdown`. */
  position?: 'above' | 'below';
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
  position,
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

  // The toolkit React wrapper forwards `ref` to the underlying
  // `<vscode-text-area>` element, which hosts the real <textarea> in its shadow
  // DOM. The declared ref type is misleading, so capture it as an HTMLElement.
  const textAreaRef = useRef<HTMLElement | null>(null);

  // Local draft keeps the caret stable for text/textarea inputs (see hook).
  const { draft, setDraft, markFocused, markBlurred } = useEditableDraft(value);

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

  // Size pre-filled textareas on mount and whenever the value changes. The
  // toolkit applies the value to the shadow <textarea> via an async template
  // binding, so defer one frame to measure after it has flushed (a synchronous
  // effect would measure an empty control). Typing is handled synchronously in
  // handleInput, where the browser has already updated the control.
  useEffect(() => {
    if (!isTextArea) {
      return;
    }
    const raf = requestAnimationFrame(() => autoGrowTextArea());
    return () => cancelAnimationFrame(raf);
  }, [draft, isTextArea, autoGrowTextArea]);

  const handleInput = (e: Event | React.FormEvent<HTMLElement>) => {
    const next = (e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    if (usesDraft) {
      setDraft(next);
    }
    onInput(next);
    if (isTextArea) {
      autoGrowTextArea();
    }
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
        ref={(el) => {
          // The `position` prop alone cannot force the popup direction: the
          // underlying fast-foundation Select latches
          // `forcedPosition = !!this.positionAttribute` once in
          // connectedCallback, but the React wrapper assigns `position` as a
          // property only after the element is connected, so forcing never
          // engages and the listbox keeps auto-flipping (upward when the row
          // sits in the lower half of the viewport, where the scroll
          // container clips it). Set both fields directly on the element to
          // make the forced position real.
          if (position && el) {
            const dropdown = el as unknown as {
              positionAttribute?: 'above' | 'below';
              forcedPosition?: boolean;
            };
            dropdown.positionAttribute = position;
            dropdown.forcedPosition = true;
          }
        }}
        data-edit-key={editKey}
        className={`vscode-field-bare ${className}`}
        style={pointerStyle}
        value={value}
        position={position}
        onFocus={onFocus}
        onChange={handleInput}
        onBlur={handleBlur}
      >
        {options.map((opt) => {
          const normalized = typeof opt === 'string' ? { value: opt, label: opt } : opt;
          return (
            <VSCodeOption
              key={normalized.value}
              value={normalized.value}
              data-option-detail={normalized.detail}
            >
              {normalized.label}
            </VSCodeOption>
          );
        })}
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
        className={`vscode-field-bare ${className}`}
        style={pointerStyle}
        rows={1}
        value={draft}
        onFocus={() => {
          markFocused();
          onFocus();
        }}
        onInput={handleInput}
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
    <VSCodeTextField
      data-edit-key={editKey}
      className={`vscode-field-bare ${className}`}
      style={pointerStyle}
      value={draft}
      onFocus={() => {
        markFocused();
        onFocus();
      }}
      onInput={handleInput}
      onBlur={(e) => {
        // Clearing focus first lets the draft re-adopt the canonical value
        // (e.g. after any normalization) once editing is done.
        markBlurred();
        handleBlur(e);
      }}
    />
  );
}
