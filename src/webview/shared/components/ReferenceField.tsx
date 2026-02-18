import React, { useState, useRef, useEffect } from 'react';

export interface ReferenceFieldProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

/**
 * Reference field with autocomplete dropdown
 * Shows available references and validates selection
 */
export const ReferenceField: React.FC<ReferenceFieldProps> = ({
  label,
  value,
  options,
  onChange,
  error,
  required = false,
  disabled = false,
  placeholder = 'Select or type...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [filteredOptions, setFilteredOptions] = useState<string[]>(options);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setFilteredOptions(options.filter((opt) => opt.toLowerCase().includes(value.toLowerCase())));
  }, [value, options]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isValid = !value || options.includes(value);

  return (
    <div className="flex flex-col gap-1" ref={containerRef}>
      <label className="text-sm font-semibold flex items-center gap-1">
        {label}
        {required && <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>}
      </label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full px-3 py-2 rounded text-sm pr-8"
          style={{
            background: 'var(--vscode-input-background)',
            color: 'var(--vscode-input-foreground)',
            border:
              error || (!isValid && value)
                ? '1px solid var(--vscode-inputValidation-errorBorder)'
                : '1px solid var(--vscode-input-border)',
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        <span
          className="absolute right-2 top-1/2 transform -translate-y-1/2 text-xs"
          style={{ color: 'var(--vscode-descriptionForeground)' }}
        >
          ▼
        </span>

        {isOpen && filteredOptions.length > 0 && !disabled && (
          <div
            className="absolute z-10 w-full mt-1 rounded shadow-lg max-h-48 overflow-y-auto"
            style={{
              background: 'var(--vscode-dropdown-listBackground)',
              border: '1px solid var(--vscode-dropdown-border)',
            }}
          >
            {filteredOptions.map((option) => (
              <div
                key={option}
                onClick={() => {
                  onChange(option);
                  setIsOpen(false);
                }}
                className="px-3 py-2 cursor-pointer text-sm"
                style={{
                  background:
                    value === option
                      ? 'var(--vscode-list-activeSelectionBackground)'
                      : 'transparent',
                  color:
                    value === option
                      ? 'var(--vscode-list-activeSelectionForeground)'
                      : 'var(--vscode-dropdown-foreground)',
                }}
                onMouseEnter={(e) => {
                  if (value !== option) {
                    e.currentTarget.style.background = 'var(--vscode-list-hoverBackground)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (value !== option) {
                    e.currentTarget.style.background = 'transparent';
                  }
                }}
              >
                {option}
              </div>
            ))}
          </div>
        )}
      </div>
      {(error || (!isValid && value)) && (
        <span className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {error || `"${value}" is not a valid reference`}
        </span>
      )}
    </div>
  );
};
