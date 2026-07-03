import React, { useRef, useState } from 'react';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';
import { evalWidthExpr, normalizeFunctionNames } from '../utils/evalWidthExpr';
import { WidthFunctionHelpMenu } from './WidthFunctionHelpMenu';

const NUMERIC_PARAM_TYPES = new Set(['integer']);

export interface WidthParameter {
  name: string;
  dataType?: string;
}

export interface WidthFieldProps {
  /** Current width — a positive integer, a parameter name, or an arithmetic expression */
  value: number | string;
  onChange: (value: number | string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  /**
   * Called with the committed value directly — avoids stale-closure issues
   * when the caller needs to act on the new value immediately.  If provided it
   * is called INSTEAD of `onSave`.
   */
  onSaveWithValue?: (value: number | string) => void;
  /** Available parameters to offer as width references */
  parameters?: WidthParameter[];
  /** Parameter name→value map used for live expression preview */
  paramValues?: Record<string, number>;
  /** The library default width, used when reverting from expr mode to number mode */
  defaultWidth?: number;
  label?: string;
  disabled?: boolean;
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * Two-mode width input:
 *   - Number mode: plain positive integer
 *   - Expression mode: free-text arithmetic expression or bare parameter name
 *     (e.g. "AxiDataWidth_g/8"), with live resolved-value preview
 *
 * The toggle button switches between modes.  When switching back to number mode
 * the field resets to `defaultWidth ?? 1`.
 */
export const WidthField: React.FC<WidthFieldProps> = ({
  value,
  onChange,
  onSave,
  onCancel,
  onSaveWithValue,
  parameters = [],
  paramValues = {},
  defaultWidth = 1,
  label,
  disabled = false,
  className,
}) => {
  const numericParams = parameters.filter(
    (p) => !p.dataType || NUMERIC_PARAM_TYPES.has(p.dataType.toLowerCase())
  );

  const [mode, setMode] = useState<'number' | 'expr'>(() =>
    typeof value === 'string' ? 'expr' : 'number'
  );

  // Ref for synchronous read on blur (VSCodeTextField shadow-DOM blur ordering)
  const numericRef = useRef<string>(
    typeof value === 'number' ? String(value) : String(defaultWidth)
  );
  const exprRef = useRef<string>(typeof value === 'string' ? value : '');

  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [helpMenuPosition, setHelpMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement>(null);

  const commit = (v: number | string) => {
    if (onSaveWithValue) {
      onSaveWithValue(v);
    } else {
      onSave?.();
    }
  };

  // Resolved preview for current expr value
  const exprDisplay = typeof value === 'string' ? value : exprRef.current;
  const resolved = exprDisplay.trim() ? evalWidthExpr(exprDisplay, paramValues) : undefined;

  /** Coerce an expression string to a number if it is a pure positive integer. */
  const coerceExpr = (expr: string): number | string => {
    const trimmed = expr.trim();
    if (!trimmed) {
      return defaultWidth;
    }
    const asInt = parseInt(trimmed, 10);
    if (!isNaN(asInt) && asInt > 0 && String(asInt) === trimmed) {
      return asInt;
    }
    // Canonicalize predefined function names (CLOG2 -> clog2) so persisted YAML
    // stays consistent; parameter names and literals are left untouched.
    return normalizeFunctionNames(trimmed);
  };

  /** Save when focus leaves the entire WidthField component. */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (mode === 'number') {
        const num = parseInt(numericRef.current, 10);
        commit(!isNaN(num) && num > 0 ? num : defaultWidth);
      } else {
        commit(coerceExpr(exprRef.current));
      }
    }
  };

  const toggleMode = () => {
    if (mode === 'expr') {
      // Use resolved value when available so the number starts at the meaningful value
      const numericFallback = resolved ?? defaultWidth;
      setMode('number');
      numericRef.current = String(numericFallback);
      onChange(numericFallback);
    } else {
      setMode('expr');
      const initial = numericParams.length > 0 ? numericParams[0].name : '';
      exprRef.current = initial;
      onChange(initial || defaultWidth);
    }
  };

  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`} onBlur={handleBlur}>
      {label && <label className="text-sm font-semibold">{label}</label>}

      <div className="flex items-center gap-1">
        {mode === 'expr' ? (
          <VSCodeTextField
            value={typeof value === 'string' ? value : exprRef.current}
            disabled={disabled}
            placeholder={numericParams[0]?.name ?? 'expression…'}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onInput={(e: any) => {
              const raw: string = (e as React.ChangeEvent<HTMLInputElement>).target.value ?? '';
              exprRef.current = raw;
              onChange(coerceExpr(raw));
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onKeyDown={(e: any) => {
              const key = (e as KeyboardEvent).key;
              if (key === 'Enter') {
                commit(coerceExpr(exprRef.current));
              } else if (key === 'Escape') {
                onCancel?.();
              }
            }}
            style={{ flexGrow: 1 }}
          />
        ) : (
          <VSCodeTextField
            value={typeof value === 'number' ? String(value) : String(defaultWidth)}
            disabled={disabled}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onInput={(e: any) => {
              const ev = e as React.ChangeEvent<HTMLInputElement>;
              const raw = ev.target.value ?? '';
              numericRef.current = raw;
              const num = parseInt(raw, 10);
              if (!isNaN(num) && num > 0) {
                onChange(num);
              }
            }}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onKeyDown={(e: any) => {
              const key = (e as KeyboardEvent).key;
              if (key === 'Enter') {
                const num = parseInt(numericRef.current, 10);
                commit(!isNaN(num) && num > 0 ? num : defaultWidth);
              } else if (key === 'Escape') {
                onCancel?.();
              }
            }}
            style={{ flexGrow: 1 }}
          />
        )}

        <button
          type="button"
          title={
            mode === 'expr' ? 'Switch to literal number' : 'Use a parameter or expression as width'
          }
          onClick={toggleMode}
          // Prevent shadow-DOM blur from firing with relatedTarget=null when
          // clicking this button while the text field is focused.
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-mono transition-opacity"
          style={{
            background:
              mode === 'expr'
                ? 'var(--vscode-button-background)'
                : 'var(--vscode-button-secondaryBackground)',
            color:
              mode === 'expr'
                ? 'var(--vscode-button-foreground)'
                : 'var(--vscode-button-secondaryForeground)',
            border: '1px solid var(--vscode-button-border, transparent)',
          }}
        >
          {mode === 'expr' ? '123' : 'ƒ(x)'}
        </button>

        {mode === 'expr' && (
          <button
            ref={helpButtonRef}
            type="button"
            title="Show width expression functions"
            onClick={() => {
              const rect = helpButtonRef.current?.getBoundingClientRect();
              if (rect) {
                setHelpMenuPosition({ x: rect.left, y: rect.bottom + 4 });
              }
              setHelpMenuOpen((open) => !open);
            }}
            // Same guard as the mode-toggle button: without it, opening the popover
            // would fire handleBlur's commit-on-blur before the click is processed.
            onMouseDown={(e) => e.preventDefault()}
            disabled={disabled}
            className="shrink-0 rounded px-1 py-0.5 text-xs transition-opacity vscode-muted hover:opacity-100"
            style={{ opacity: 0.7 }}
          >
            <span className="codicon codicon-info" />
          </button>
        )}
      </div>

      {/* Mounted inside the wrapper (not a portal/sibling) so handleBlur's
          e.currentTarget.contains(e.relatedTarget) check treats interacting with
          the popover as focus staying within the field, avoiding a spurious
          commit/cancel of the in-progress width edit. */}
      <WidthFunctionHelpMenu
        position={helpMenuOpen ? helpMenuPosition : null}
        onClose={() => setHelpMenuOpen(false)}
      />

      {mode === 'expr' && exprDisplay.trim() && (
        <div
          className="text-xs font-mono"
          style={{
            color:
              resolved !== undefined
                ? 'var(--vscode-descriptionForeground)'
                : 'var(--vscode-errorForeground)',
            opacity: resolved !== undefined ? 0.8 : 0.55,
          }}
        >
          = {resolved ?? '?'}
        </div>
      )}
    </div>
  );
};
