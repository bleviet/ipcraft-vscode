import React from 'react';
import type { SearchOptions } from './searchMatcher';

export interface SearchBoxProps {
  query: string;
  options: SearchOptions;
  /** The input, which Ctrl/Cmd+F focuses. */
  inputRef: React.Ref<HTMLInputElement>;
  counter: string;
  onQueryChange: (query: string) => void;
  onOptionsChange: (options: SearchOptions) => void;
  onStep: (direction: 1 | -1) => void;
  /** Up (-1) or Down (1) in the input: show an older or newer search; true when the query changed. */
  onHistory: (direction: -1 | 1) => boolean;
  /** The input lost focus: remember its query. */
  onBlur: () => void;
}

const OPTION_TOGGLES: { option: keyof SearchOptions; label: string; icon: string }[] = [
  { option: 'matchCase', label: 'Match Case', icon: 'case-sensitive' },
  { option: 'wholeWord', label: 'Match Whole Word', icon: 'whole-word' },
];

/** The Search instances box of the toolbar: the input, its option toggles and the match counter. */
export function SearchBox({
  query,
  options,
  inputRef,
  counter,
  onQueryChange,
  onOptionsChange,
  onStep,
  onHistory,
  onBlur,
}: SearchBoxProps) {
  return (
    <>
      <input
        ref={inputRef}
        type="search"
        className="sd-input w-[220px] min-w-0"
        placeholder="Search instances (⇅ for history)"
        aria-label="Search instances"
        title="Search instance names and types. * matches any characters, ? matches one"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            if (
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.shiftKey ||
              event.nativeEvent.isComposing
            ) {
              return;
            }
            if (onHistory(event.key === 'ArrowUp' ? -1 : 1)) {
              event.preventDefault();
            }
          } else if (event.key === 'Enter') {
            if (event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onQueryChange('');
            event.currentTarget.blur();
          }
        }}
      />
      <span className="sd-tool-group">
        {OPTION_TOGGLES.map(({ option, label, icon }) => (
          <button
            key={option}
            type="button"
            className={`canvas-view-toggle${options[option] ? ' canvas-view-toggle--active' : ''}`}
            aria-pressed={options[option]}
            aria-label={label}
            title={label}
            onClick={() => onOptionsChange({ ...options, [option]: !options[option] })}
          >
            <span aria-hidden="true" className={`codicon codicon-${icon}`} />
          </button>
        ))}
      </span>
      {query.trim() !== '' && (
        <span aria-live="polite" className="opacity-70">
          {counter}
        </span>
      )}
    </>
  );
}
