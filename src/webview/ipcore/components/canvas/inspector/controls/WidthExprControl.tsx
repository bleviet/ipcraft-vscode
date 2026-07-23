import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { WidthFunctionHelpMenu } from '../../../../../shared/components';
import { evalWidthExpr } from '../../../../../shared/utils/evalWidthExpr';
import { getIdentifierTokenAtCursor } from '../../../../../shared/utils/widthExprToken';
import { WIDTH_FUNCTION_HELP } from '../../../../../shared/utils/widthFunctionHelp';

type WidthSuggestion =
  | { kind: 'function'; name: string; signature: string }
  | { kind: 'param'; name: string };

const MAX_WIDTH_SUGGESTIONS = 8;

function getWidthSuggestions(
  text: string,
  cursor: number,
  paramNames: string[]
): { token: { start: number; end: number }; items: WidthSuggestion[] } | null {
  const token = getIdentifierTokenAtCursor(text, cursor);
  if (!token) {
    return null;
  }
  const query = token.text.toLowerCase();
  const functionNames = (
    Object.keys(WIDTH_FUNCTION_HELP) as Array<keyof typeof WIDTH_FUNCTION_HELP>
  )
    .filter((name) => name.toLowerCase().startsWith(query))
    .sort();
  const paramMatches = paramNames.filter((name) => name.toLowerCase().startsWith(query)).sort();

  const items: WidthSuggestion[] = [
    ...functionNames.map(
      (name): WidthSuggestion => ({
        kind: 'function',
        name,
        signature: WIDTH_FUNCTION_HELP[name].signature,
      })
    ),
    ...paramMatches.map((name): WidthSuggestion => ({ kind: 'param', name })),
  ].slice(0, MAX_WIDTH_SUGGESTIONS);

  return items.length > 0 ? { token, items } : null;
}

interface WidthExprControlProps {
  value: number | string;
  /** Fallback for revert-to-number and empty-expr commit. Defaults to 1. */
  defaultWidth?: number;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onSave: (value: number | string) => void;
  /** Class for the wrapping row div — differs per call site's layout (compact
   *  row vs. labeled field row). */
  rowClassName: string;
  /** Base class for the input; an `--expr` modifier variant is appended in
   *  expr mode (a no-op unless the base class defines one). */
  inputClassName: string;
  /** Class for the mode-toggle and info buttons. */
  toggleClassName?: string;
  /** 'inline': resolved-value badge sits inside the row (compact rows).
   *  'below': resolved-value line sits below the row (labeled field). */
  previewStyle?: 'inline' | 'below';
}

export const WidthExprControl: React.FC<WidthExprControlProps> = ({
  value,
  defaultWidth = 1,
  paramNames,
  paramValues = {},
  onSave,
  rowClassName,
  inputClassName,
  toggleClassName = 'ci-pw-mode-toggle',
  previewStyle = 'inline',
}) => {
  const [mode, setMode] = useState<'number' | 'expr'>(() =>
    typeof value === 'string' ? 'expr' : 'number'
  );
  const [draft, setDraft] = useState<string>(() =>
    typeof value === 'string' ? value : String(value)
  );
  const [focused, setFocused] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpPosition, setHelpPosition] = useState<{ x: number; y: number } | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<WidthSuggestion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [activeToken, setActiveToken] = useState<{ start: number; end: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const comboboxRef = useRef<HTMLDivElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof value === 'string') {
      setMode('expr');
      if (!focused) {
        setDraft(value);
      }
    } else {
      setMode('number');
      if (!focused) {
        setDraft(String(value));
      }
    }
  }, [value, focused]);

  useEffect(() => {
    if (!suggestOpen) {
      return;
    }
    const onDocMouseDown = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [suggestOpen]);

  useLayoutEffect(() => {
    if (pendingCaretRef.current !== null && inputRef.current) {
      const pos = pendingCaretRef.current;
      pendingCaretRef.current = null;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(pos, pos);
    }
  }, [draft]);

  const hasParams = paramNames.length > 0;

  const coerceExpr = (raw: string): number | string => {
    const trimmed = raw.trim();
    if (!trimmed) {
      return defaultWidth;
    }
    const asInt = parseInt(trimmed, 10);
    if (!isNaN(asInt) && asInt > 0 && String(asInt) === trimmed) {
      return asInt;
    }
    return trimmed;
  };

  const commit = (raw: string) => {
    if (mode === 'expr') {
      onSave(coerceExpr(raw));
    } else {
      const n = parseInt(raw.trim(), 10);
      onSave(!isNaN(n) && n > 0 ? n : defaultWidth);
    }
  };

  const toggleMode = () => {
    if (mode === 'expr') {
      const fallback = resolved ?? defaultWidth;
      setMode('number');
      setDraft(String(fallback));
      onSave(fallback);
    } else {
      const initial = hasParams ? paramNames[0] : '';
      setMode('expr');
      setDraft(initial);
      onSave(initial || defaultWidth);
    }
    setSuggestOpen(false);
  };

  const valueDisplay = focused ? draft : typeof value === 'string' ? value : String(value);
  const resolved =
    mode === 'expr' && valueDisplay.trim() ? evalWidthExpr(valueDisplay, paramValues) : undefined;

  const acceptSuggestion = (item: WidthSuggestion) => {
    if (!activeToken) {
      return;
    }
    const insertText = item.kind === 'function' ? `${item.name}()` : item.name;
    const caretOffset = item.kind === 'function' ? item.name.length + 1 : item.name.length;
    const newValue = draft.slice(0, activeToken.start) + insertText + draft.slice(activeToken.end);
    pendingCaretRef.current = activeToken.start + caretOffset;
    setDraft(newValue);
    setSuggestOpen(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDraft(newValue);
    if (mode !== 'expr') {
      return;
    }
    const cursor = e.target.selectionStart ?? newValue.length;
    const result = getWidthSuggestions(newValue, cursor, paramNames);
    if (result) {
      setActiveToken(result.token);
      setSuggestions(result.items);
      setActiveSuggestion(0);
      setSuggestOpen(true);
    } else {
      setSuggestOpen(false);
    }
  };

  const displayValueForEdit = typeof value === 'string' ? value : String(value);

  return (
    <>
      <div className={rowClassName}>
        <div
          className={`ci-combobox${mode === 'expr' ? ' ci-combobox--expr' : ''}`}
          ref={comboboxRef}
        >
          <input
            ref={inputRef}
            className={`${inputClassName}${mode === 'expr' ? ` ${inputClassName}--expr` : ''}`}
            value={valueDisplay}
            placeholder={
              mode === 'expr' ? (hasParams ? paramNames[0] : 'expr…') : String(defaultWidth)
            }
            onChange={handleChange}
            onFocus={() => {
              setFocused(true);
              setDraft(displayValueForEdit);
            }}
            onBlur={() => {
              setFocused(false);
              setSuggestOpen(false);
              commit(draft);
            }}
            onKeyDown={(e) => {
              if (suggestOpen && suggestions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveSuggestion((i) => Math.min(i + 1, suggestions.length - 1));
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveSuggestion((i) => Math.max(i - 1, 0));
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  acceptSuggestion(suggestions[activeSuggestion]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setSuggestOpen(false);
                  return;
                }
              }
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(displayValueForEdit);
                setFocused(false);
                e.currentTarget.blur();
              }
            }}
            title={
              mode === 'expr' && resolved !== undefined
                ? `= ${resolved}`
                : mode === 'expr' && valueDisplay.trim()
                  ? '= ? (unresolved)'
                  : undefined
            }
            style={
              inputClassName === 'ci-field__input'
                ? { fontFamily: 'var(--vscode-editor-font-family, monospace)' }
                : undefined
            }
          />
          {suggestOpen && suggestions.length > 0 && (
            <div className="ci-combobox__list">
              {suggestions.map((item, i) => (
                <div
                  key={`${item.kind}-${item.name}`}
                  className={`ci-combobox__option${i === activeSuggestion ? ' ci-combobox__option--active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    acceptSuggestion(item);
                  }}
                  onMouseEnter={() => setActiveSuggestion(i)}
                >
                  {item.kind === 'function' ? item.signature : item.name}
                </div>
              ))}
            </div>
          )}
        </div>
        <button
          className={toggleClassName}
          onClick={toggleMode}
          title={mode === 'expr' ? 'Use a literal number' : 'Use a parameter or expression'}
          type="button"
        >
          {mode === 'expr' ? (
            '123'
          ) : (
            <span style={{ fontFamily: 'var(--vscode-editor-font-family, monospace)' }}>ƒ(x)</span>
          )}
        </button>
        {mode === 'expr' && (
          <button
            ref={helpButtonRef}
            type="button"
            className={toggleClassName}
            title="Show width expression functions"
            onClick={() => {
              const rect = helpButtonRef.current?.getBoundingClientRect();
              if (rect) {
                setHelpPosition({ x: rect.left, y: rect.bottom + 4 });
              }
              setHelpOpen((open) => !open);
            }}
          >
            <span className="codicon codicon-info" />
          </button>
        )}
        {previewStyle === 'inline' && mode === 'expr' && valueDisplay.trim() && (
          <span
            className={`ci-pw-expr-preview${resolved === undefined ? ' ci-pw-expr-preview--invalid' : ''}`}
          >
            ={resolved ?? '?'}
          </span>
        )}
      </div>
      <WidthFunctionHelpMenu
        position={helpOpen ? helpPosition : null}
        onClose={() => setHelpOpen(false)}
      />
      {previewStyle === 'below' && mode === 'expr' && valueDisplay.trim() && (
        <div
          className={`ci-field__expr-preview${resolved === undefined ? ' ci-field__expr-preview--invalid' : ''}`}
        >
          = {resolved ?? '?'}
        </div>
      )}
    </>
  );
};
