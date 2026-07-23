import React, { useEffect, useId, useState } from 'react';
import { WidthExprControl } from './WidthExprControl';

interface PropCheckboxProps {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

export const PropCheckbox: React.FC<PropCheckboxProps> = ({ label, checked, onChange }) => {
  const id = useId();
  return (
    <div
      className="ci-field"
      style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0' }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ cursor: 'pointer', margin: 0 }}
      />
      <label
        htmlFor={id}
        className="ci-field__label"
        style={{ marginBottom: 0, cursor: 'pointer', userSelect: 'none' }}
      >
        {label}
      </label>
    </div>
  );
};

interface TagInputProps {
  label: string;
  values: Array<string | number>;
  onChange: (newValues: Array<string | number> | null) => void;
  isNumeric?: boolean;
  placeholder?: string;
}

export const TagInput: React.FC<TagInputProps> = ({
  label,
  values = [],
  onChange,
  isNumeric = false,
  placeholder,
}) => {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const defaultPlaceholder = isNumeric ? 'e.g. 8, 16, 32' : 'e.g. fast, slow, normal';
  const effectivePlaceholder = placeholder ?? defaultPlaceholder;

  const commit = () => {
    const val = input.trim();
    if (!val) {
      return;
    }

    if (isNumeric) {
      const parsed = Number(val);
      if (!Number.isFinite(parsed)) {
        setError('Must be a number');
        return;
      }
      if (!values.includes(parsed)) {
        onChange([...values, parsed]);
      }
    } else {
      if (!values.includes(val)) {
        onChange([...values, val]);
      }
    }
    setInput('');
    setError('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      setInput('');
      setError('');
    } else {
      setError('');
    }
  };

  const removeValue = (val: string | number) => {
    const next = values.filter((v) => v !== val);
    onChange(next.length ? next : null);
  };

  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <div className="ci-field__input-row">
        <input
          className="ci-field__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={effectivePlaceholder}
        />
        <button
          className="ci-pw-mode-toggle"
          style={{
            width: 'auto',
            padding: '0 6px',
            fontSize: 11,
            height: 'auto',
            alignSelf: 'stretch',
            opacity: input.trim() ? 1 : 0.4,
          }}
          onClick={commit}
          title="Add value"
        >
          Add
        </button>
      </div>
      {error && <div className="ci-field__error">{error}</div>}
      {!error && (
        <div className="ci-field__hint">
          {values.length === 0
            ? isNumeric
              ? 'Type a number and click Add or press Enter'
              : 'Type a value and click Add or press Enter'
            : 'Click × on a chip to remove it'}
        </div>
      )}
      {values.length > 0 && (
        <div className="ci-chips" style={{ marginTop: 4 }}>
          {values.map((val, i) => (
            <span
              key={i}
              className="ci-chip"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              {String(val)}
              <span
                className="codicon codicon-close"
                style={{ fontSize: 9, cursor: 'pointer', opacity: 0.6 }}
                onClick={() => removeValue(val)}
                title={`Remove ${val}`}
              />
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

interface PropWidthFieldProps {
  label: string;
  value: number | string;
  paramNames: string[];
  paramValues?: Record<string, number>;
  onSave: (value: number | string) => void;
}

export const PropWidthField: React.FC<PropWidthFieldProps> = ({
  label,
  value,
  paramNames,
  paramValues = {},
  onSave,
}) => {
  return (
    <div className="ci-field">
      <label className="ci-field__label">{label}</label>
      <WidthExprControl
        value={value}
        paramNames={paramNames}
        paramValues={paramValues}
        onSave={onSave}
        rowClassName="ci-field__input-row"
        inputClassName="ci-field__input"
        toggleClassName="ci-pw-mode-toggle ci-field__mode-toggle"
        previewStyle="below"
      />
    </div>
  );
};

interface PropFieldProps {
  label: string;
  value: string;
  onSave: (v: string) => void;
  validate?: (v: string) => string | null;
  placeholder?: string;
  hint?: string;
  mono?: boolean;
  hasError?: boolean;
  errorMsg?: string;
}

export const PropField: React.FC<PropFieldProps> = ({
  label,
  value,
  onSave,
  validate,
  placeholder,
  hint,
  mono = false,
  hasError = false,
  errorMsg,
}) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const controlId = React.useId();
  const descriptionId = `${controlId}-description`;

  useEffect(() => {
    if (!focused) {
      setDraft(value);
      setLiveError(null);
    }
  }, [value, focused]);

  const handleChange = (v: string) => {
    setDraft(v);
    if (liveError) {
      setLiveError(validate?.(v) ?? null);
    }
  };

  const commit = () => {
    const err = validate?.(draft) ?? null;
    if (err) {
      // Revert — invalid value discarded silently
      setDraft(value);
      setLiveError(null);
    } else if (draft !== value) {
      onSave(draft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(value);
      setLiveError(null);
      setFocused(false);
      e.currentTarget.blur();
    }
  };

  const showErr = liveError ?? (hasError ? errorMsg : null);

  return (
    <div className="ci-field">
      <label htmlFor={controlId} className="ci-field__label">
        {label}
      </label>
      <input
        id={controlId}
        className={`ci-field__input${showErr ? ' ci-field__input--error' : ''}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          commit();
        }}
        onKeyDown={handleKeyDown}
        aria-invalid={showErr ? true : undefined}
        aria-describedby={showErr || hint ? descriptionId : undefined}
        style={mono ? { fontFamily: 'var(--vscode-editor-font-family, monospace)' } : undefined}
      />
      {showErr ? (
        <div id={descriptionId} className="ci-field__error">
          {showErr}
        </div>
      ) : hint ? (
        <div id={descriptionId} className="ci-field__hint">
          {hint}
        </div>
      ) : null}
    </div>
  );
};

interface PropSelectProps {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onSave: (v: string) => void;
  emptyOption?: string;
  disabled?: boolean;
}

export const PropSelect: React.FC<PropSelectProps> = ({
  label,
  value,
  options,
  onSave,
  emptyOption,
  disabled,
}) => {
  const controlId = React.useId();
  return (
    <div className="ci-field">
      <label htmlFor={controlId} className="ci-field__label">
        {label}
      </label>
      <select
        id={controlId}
        className="ci-field__select"
        value={value}
        disabled={disabled}
        onChange={(e) => onSave(e.target.value)}
      >
        {emptyOption !== undefined && <option value="">{emptyOption}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
};

interface PropTextAreaProps {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}

export const PropTextArea: React.FC<PropTextAreaProps> = ({
  label,
  value,
  onSave,
  placeholder,
}) => {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const controlId = React.useId();

  useEffect(() => {
    if (!focused) {
      setDraft(value);
    }
  }, [value, focused]);

  return (
    <div className="ci-field">
      <label htmlFor={controlId} className="ci-field__label">
        {label}
      </label>
      <textarea
        id={controlId}
        className="ci-field__textarea"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) {
            onSave(draft);
          }
        }}
      />
    </div>
  );
};

export const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}> = ({ title, children, actions }) => (
  <div className="ci-section">
    <div className="ci-section__title">
      <span>{title}</span>
      {actions && <div className="ci-section__actions">{actions}</div>}
    </div>
    {children}
  </div>
);

export const EmptyState: React.FC<{ label: string }> = ({ label }) => (
  <div className="ci-empty-state">{label}</div>
);
